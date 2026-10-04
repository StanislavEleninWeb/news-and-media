import { getConfig } from './config';
import { getLogger } from './logger';
import { buildEnvelope, parseDsn, sendEnvelope, type SentryTarget } from './sentry-lite';

let target: SentryTarget | null = null;
let serviceName = 'app';
const pending = new Set<Promise<void>>();

/**
 * Error tracking. Every error is logged as structured JSON; when SENTRY_DSN is
 * set it is also sent to Sentry (or self-hosted GlitchTip), tagged with the
 * environment, service and release (commit SHA).
 */
export async function initErrorReporting(service: 'web' | 'worker'): Promise<void> {
  serviceName = service;
  const dsn = getConfig().SENTRY_DSN;
  if (!dsn) return;
  try {
    target = parseDsn(dsn);
  } catch (error) {
    getLogger({ service }).warn({ err: error }, 'SENTRY_DSN is invalid; error tracking disabled');
  }
}

export function reportError(error: unknown, context: Record<string, unknown> = {}): void {
  getLogger({ service: context.service ?? serviceName }).error(
    { err: error, ...context },
    'error reported',
  );
  if (!target) return;
  const config = getConfig();
  const tags = Object.fromEntries(
    Object.entries({ service: serviceName, ...context })
      .filter(([, v]) => typeof v === 'string' || typeof v === 'number')
      .map(([k, v]) => [k, String(v)]),
  );
  const envelope = buildEnvelope(target, error, {
    environment: config.APP_ENV,
    release: process.env.GIT_SHA,
    serverName: serviceName,
    tags,
    extra: context,
  });
  const delivery = sendEnvelope(target, envelope)
    .catch(() => {})
    .finally(() => pending.delete(delivery));
  pending.add(delivery);
}

/** Waits for in-flight error reports (call before the process exits). */
export async function flushErrorReporting(timeoutMs = 2_000): Promise<void> {
  await Promise.race([
    Promise.allSettled([...pending]),
    new Promise((resolve) => setTimeout(resolve, timeoutMs)),
  ]);
}
