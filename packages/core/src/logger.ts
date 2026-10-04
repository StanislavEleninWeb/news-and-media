import { pino, type Logger } from 'pino';
import { getConfig } from './config';

let root: Logger | undefined;

/**
 * Structured JSON logger. In production the output goes to stdout and is
 * collected by `docker compose logs`; no log shipping agent is required.
 */
export function getLogger(bindings?: Record<string, unknown>): Logger {
  if (!root) {
    const config = getConfig();
    root = pino({
      level: config.APP_ENV === 'test' ? 'silent' : config.LOG_LEVEL,
      base: { env: config.APP_ENV },
      timestamp: pino.stdTimeFunctions.isoTime,
      redact: {
        paths: ['*.password', '*.passwordHash', '*.token', '*.apiKey', 'headers.authorization'],
        censor: '[redacted]',
      },
    });
  }
  return bindings ? root.child(bindings) : root;
}
