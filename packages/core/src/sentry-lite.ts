import { randomUUID } from 'node:crypto';

/**
 * Minimal Sentry-protocol client (also accepted by self-hosted GlitchTip).
 * Sends one envelope per error over HTTPS — no SDK, no native or OpenTelemetry
 * dependencies, so it bundles cleanly into the worker and the Next.js server.
 */
export interface SentryTarget {
  endpoint: string;
  auth: string;
  dsn: string;
}

export function parseDsn(dsn: string): SentryTarget {
  const url = new URL(dsn);
  const projectId = url.pathname.split('/').filter(Boolean).pop();
  const prefix = url.pathname.slice(0, url.pathname.lastIndexOf('/'));
  if (!url.username || !projectId) throw new Error('Invalid SENTRY_DSN');
  return {
    endpoint: `${url.protocol}//${url.host}${prefix}/api/${projectId}/envelope/`,
    auth: `Sentry sentry_version=7, sentry_key=${url.username}, sentry_client=newsmedia-lite/1.0`,
    dsn,
  };
}

interface Frame {
  function?: string;
  filename?: string;
  lineno?: number;
  colno?: number;
  in_app?: boolean;
}

/** V8 stack lines → Sentry frames (oldest call first, as Sentry expects). */
export function parseStack(stack: string | undefined): Frame[] {
  if (!stack) return [];
  const frames: Frame[] = [];
  for (const line of stack.split('\n').slice(1)) {
    const match = /^\s*at (?:(.+?) \()?(.+?):(\d+):(\d+)\)?$/.exec(line);
    if (!match) continue;
    const filename = match[2]!;
    frames.push({
      function: match[1] ?? '<anonymous>',
      filename,
      lineno: Number(match[3]),
      colno: Number(match[4]),
      in_app: !filename.includes('node_modules') && !filename.startsWith('node:'),
    });
  }
  return frames.reverse().slice(-50);
}

export function buildEnvelope(
  target: SentryTarget,
  error: unknown,
  meta: {
    environment: string;
    release?: string;
    serverName: string;
    tags?: Record<string, string>;
    extra?: Record<string, unknown>;
  },
): string {
  const err = error instanceof Error ? error : new Error(String(error));
  const eventId = randomUUID().replace(/-/g, '');
  const event = {
    event_id: eventId,
    timestamp: Date.now() / 1000,
    platform: 'node',
    level: 'error',
    environment: meta.environment,
    release: meta.release,
    server_name: meta.serverName,
    tags: meta.tags,
    extra: meta.extra,
    exception: {
      values: [
        { type: err.name, value: err.message, stacktrace: { frames: parseStack(err.stack) } },
      ],
    },
  };
  return [
    JSON.stringify({ event_id: eventId, sent_at: new Date().toISOString(), dsn: target.dsn }),
    JSON.stringify({ type: 'event' }),
    JSON.stringify(event),
  ].join('\n');
}

export async function sendEnvelope(target: SentryTarget, envelope: string): Promise<void> {
  await fetch(target.endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-sentry-envelope', 'X-Sentry-Auth': target.auth },
    body: envelope,
    signal: AbortSignal.timeout(5_000),
  });
}
