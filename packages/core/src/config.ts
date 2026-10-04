import { z } from 'zod';

/**
 * Central, typed runtime configuration.
 *
 * Every service (web, worker, CLI) reads configuration through `getConfig()` so
 * that dev, staging and production differ only by environment variables — the
 * same Docker image is promoted between environments unchanged.
 *
 * Parsing is lazy: nothing is validated at import time, which keeps
 * `next build` and unit tests independent of a real environment.
 */

const booleanFromEnv = z
  .enum(['true', 'false', '1', '0', 'yes', 'no'])
  .transform((value) => value === 'true' || value === '1' || value === 'yes');

const optionalString = z
  .string()
  .optional()
  .transform((value) => (value === undefined || value.trim() === '' ? undefined : value.trim()));

export const appEnvironments = ['development', 'test', 'staging', 'production'] as const;
export type AppEnvironment = (typeof appEnvironments)[number];

export const envSchema = z
  .object({
    APP_ENV: z.enum(appEnvironments).default('development'),
    APP_URL: z.string().url().default('http://localhost:3000'),
    SITE_NAME: z.string().min(1).default('Newsmedia'),
    LOG_LEVEL: z
      .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
      .default('info'),

    /** Automatic schedules (ingestion, processing, digests). Production only by default. */
    SCHEDULER_ENABLED: booleanFromEnv.optional(),

    DATABASE_URL: optionalString,

    // Ingestion -------------------------------------------------------------
    INGEST_USER_AGENT: optionalString,
    INGEST_CONCURRENCY: z.coerce.number().int().min(1).max(16).default(4),
    INGEST_TIMEOUT_MS: z.coerce.number().int().min(1000).default(15_000),
    /** Minimum extracted article length (characters); shorter items are skipped. */
    INGEST_MIN_TEXT_LENGTH: z.coerce.number().int().min(0).default(400),
    /** Only for tests/local experiments: allows fetching private-network addresses. */
    ALLOW_PRIVATE_NETWORK_FETCH: booleanFromEnv.default('false'),

    // Media storage ---------------------------------------------------------
    STORAGE_LOCAL_DIR: z.string().default('./data/media'),
    MEDIA_BASE_URL: z.string().default('/media'),
  })
  .transform((env) => ({
    ...env,
    SCHEDULER_ENABLED: env.SCHEDULER_ENABLED ?? env.APP_ENV === 'production',
    INGEST_USER_AGENT:
      env.INGEST_USER_AGENT ??
      `${env.SITE_NAME.replace(/[^A-Za-z0-9]/g, '') || 'News'}Bot/1.0 (+${env.APP_URL.replace(/\/$/, '')}/bot)`,
    isProduction: env.APP_ENV === 'production',
  }))
  .superRefine((env, ctx) => {
    if (env.APP_ENV === 'production' || env.APP_ENV === 'staging') {
      if (!env.DATABASE_URL) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['DATABASE_URL'],
          message: 'DATABASE_URL is required outside development',
        });
      }
      if (env.APP_URL.startsWith('http://localhost')) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['APP_URL'],
          message: 'APP_URL must be the public URL outside development',
        });
      }
    }
  });

export type AppConfig = z.infer<typeof envSchema>;

export class ConfigError extends Error {
  constructor(public readonly issues: z.ZodIssue[]) {
    super(
      `Invalid configuration:\n${issues
        .map((issue) => `  - ${issue.path.join('.') || '(root)'}: ${issue.message}`)
        .join('\n')}`,
    );
    this.name = 'ConfigError';
  }
}

export function parseConfig(env: Record<string, string | undefined>): AppConfig {
  const result = envSchema.safeParse(env);
  if (!result.success) throw new ConfigError(result.error.issues);
  return result.data;
}

let cached: AppConfig | undefined;

/** Returns the validated configuration for the current process (memoised). */
export function getConfig(): AppConfig {
  cached ??= parseConfig(process.env);
  return cached;
}

/** Test helper: forget the memoised configuration. */
export function resetConfig(): void {
  cached = undefined;
}
