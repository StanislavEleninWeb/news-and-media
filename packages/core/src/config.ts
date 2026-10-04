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
    /** Connections per process (web and worker each have their own pool). */
    DATABASE_POOL_MAX: z.coerce.number().int().min(1).max(100).default(10),

    // Ingestion -------------------------------------------------------------
    INGEST_USER_AGENT: optionalString,
    INGEST_CONCURRENCY: z.coerce.number().int().min(1).max(16).default(4),
    INGEST_TIMEOUT_MS: z.coerce.number().int().min(1000).default(15_000),
    /** Minimum extracted article length (characters); shorter items are skipped. */
    INGEST_MIN_TEXT_LENGTH: z.coerce.number().int().min(0).default(400),
    /** Only for tests/local experiments: allows fetching private-network addresses. */
    ALLOW_PRIVATE_NETWORK_FETCH: booleanFromEnv.default('false'),

    // AI rewrite & translation ----------------------------------------------
    /** anthropic (default: Claude Haiku) or openai (any OpenAI-compatible API: DeepSeek, Groq, ...). */
    LLM_PROVIDER: z.enum(['anthropic', 'openai']).default('anthropic'),
    LLM_MODEL: z.string().default('claude-haiku-4-5-20251001'),
    /** Optional second provider used when the primary one is down. */
    LLM_FALLBACK_PROVIDER: z.enum(['anthropic', 'openai']).optional(),
    ANTHROPIC_API_KEY: optionalString,
    ANTHROPIC_BASE_URL: z.string().url().default('https://api.anthropic.com'),
    OPENAI_COMPAT_BASE_URL: optionalString,
    OPENAI_COMPAT_API_KEY: optionalString,
    OPENAI_COMPAT_MODEL: optionalString,
    /** USD per million tokens for the primary model (defaults: Claude Haiku 4.5). */
    LLM_INPUT_PRICE_PER_MTOK: z.coerce.number().min(0).default(1),
    LLM_OUTPUT_PRICE_PER_MTOK: z.coerce.number().min(0).default(5),
    LLM_CACHE_READ_PRICE_PER_MTOK: z.coerce.number().min(0).default(0.1),
    OPENAI_COMPAT_INPUT_PRICE_PER_MTOK: z.coerce.number().min(0).default(0),
    OPENAI_COMPAT_OUTPUT_PRICE_PER_MTOK: z.coerce.number().min(0).default(0),
    /** Spend guards. Defaults are generous in production and tiny everywhere else. */
    LLM_MAX_ARTICLES_PER_RUN: z.coerce.number().int().min(0).optional(),
    LLM_MONTHLY_BUDGET_USD: z.coerce.number().min(0).optional(),
    /** Share of 8-word sequences a rewrite may reuse from its source before it goes to review. */
    LLM_SIMILARITY_THRESHOLD: z.coerce.number().min(0).max(1).default(0.2),
    /** Optional: DeepL for translating flagship articles. Free keys end in ":fx". */
    DEEPL_API_KEY: optionalString,
    DEEPL_API_URL: optionalString,

    // Search ----------------------------------------------------------------
    /** Typesense URL. When unset, search falls back to PostgreSQL (fine for development). */
    TYPESENSE_URL: optionalString,
    TYPESENSE_API_KEY: optionalString,
    /** Namespaces collections per environment, e.g. "staging_articles". Defaults to "<APP_ENV>_". */
    TYPESENSE_COLLECTION_PREFIX: optionalString,

    // Accounts & e-mail -----------------------------------------------------
    /** Optional "Sign in with Google". Redirect URI: <APP_URL>/api/v1/auth/google/callback */
    GOOGLE_CLIENT_ID: optionalString,
    GOOGLE_CLIENT_SECRET: optionalString,
    /** smtp(s)://user:pass@host:port — any provider (Resend, Postmark, Brevo, own server). */
    SMTP_URL: optionalString,
    MAIL_FROM: optionalString,
    /**
     * Outside production, e-mail and push are delivered ONLY to these addresses
     * (comma-separated), so nothing sent from dev/staging can reach real readers.
     */
    NOTIFY_ALLOWLIST: z
      .string()
      .optional()
      .transform((value) =>
        (value ?? '')
          .split(',')
          .map((item) => item.trim().toLowerCase())
          .filter(Boolean),
      ),

    // Notifications -----------------------------------------------------------
    /** Web Push (VAPID) keys — generate once with `cli generate-vapid-keys`. */
    VAPID_PUBLIC_KEY: optionalString,
    VAPID_PRIVATE_KEY: optionalString,
    VAPID_SUBJECT: optionalString,
    /** Daily briefing send time (local hour) and time zone. */
    DIGEST_HOUR: z.coerce.number().int().min(0).max(23).default(7),
    DIGEST_TIMEZONE: z.string().default('Europe/Sofia'),
    DIGEST_SIZE: z.coerce.number().int().min(3).max(20).default(8),

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
    LLM_MAX_ARTICLES_PER_RUN:
      env.LLM_MAX_ARTICLES_PER_RUN ?? (env.APP_ENV === 'production' ? 50 : 5),
    LLM_MONTHLY_BUDGET_USD: env.LLM_MONTHLY_BUDGET_USD ?? (env.APP_ENV === 'production' ? 50 : 5),
    DEEPL_API_URL:
      env.DEEPL_API_URL ??
      (env.DEEPL_API_KEY?.endsWith(':fx')
        ? 'https://api-free.deepl.com/v2'
        : 'https://api.deepl.com/v2'),
    TYPESENSE_COLLECTION_PREFIX: env.TYPESENSE_COLLECTION_PREFIX ?? `${env.APP_ENV}_`,
    MAIL_FROM: env.MAIL_FROM ?? `${env.SITE_NAME} <no-reply@${new URL(env.APP_URL).hostname}>`,
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
      if (!env.TYPESENSE_URL || !env.TYPESENSE_API_KEY) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['TYPESENSE_URL'],
          message: 'TYPESENSE_URL and TYPESENSE_API_KEY are required outside development',
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
