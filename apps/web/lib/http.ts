import type { z } from 'zod';
import { getConfig } from '@nm/core/config';

export function json(data: unknown, init: ResponseInit & { cookies?: string[] } = {}): Response {
  const headers = new Headers(init.headers);
  headers.set('Content-Type', 'application/json; charset=utf-8');
  if (!headers.has('Cache-Control')) headers.set('Cache-Control', 'private, no-store');
  for (const cookie of init.cookies ?? []) headers.append('Set-Cookie', cookie);
  return new Response(JSON.stringify(data), { ...init, headers });
}

export function problem(
  status: number,
  code: string,
  message?: string,
  cookies?: string[],
): Response {
  return json({ error: { code, message: message ?? code } }, { status, cookies });
}

export function noContent(cookies: string[] = []): Response {
  const headers = new Headers({ 'Cache-Control': 'no-store' });
  for (const cookie of cookies) headers.append('Set-Cookie', cookie);
  return new Response(null, { status: 204, headers });
}

/** Validates query parameters; returns a 400 response on failure. */
export function parseQuery<T extends z.ZodTypeAny>(
  request: Request,
  schema: T,
): z.infer<T> | Response {
  const params = Object.fromEntries(new URL(request.url).searchParams);
  const result = schema.safeParse(params);
  if (!result.success) {
    return problem(
      400,
      'invalid_query',
      result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '),
    );
  }
  return result.data;
}

export async function parseBody<T extends z.ZodTypeAny>(
  request: Request,
  schema: T,
): Promise<z.infer<T> | Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return problem(400, 'invalid_json');
  }
  const result = schema.safeParse(body);
  if (!result.success) {
    return problem(
      400,
      'invalid_body',
      result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '),
    );
  }
  return result.data;
}

/** The token of an `Authorization: Bearer …` header (mobile app sessions). */
export function bearerToken(request: Request): string | null {
  const header = request.headers.get('authorization');
  const match = header?.match(/^Bearer\s+([A-Za-z0-9_-]{20,100})$/);
  return match ? match[1]! : null;
}

/**
 * CSRF protection for cookie-authenticated, state-changing requests: the
 * browser's Origin (or Referer) must be this site. Combined with SameSite=Lax
 * cookies this blocks cross-site form posts and fetches.
 *
 * Native clients (the mobile app) send neither cookies nor an Origin header;
 * they authenticate with a bearer token that a browser never attaches on its
 * own, so such requests cannot ride on a victim's ambient credentials.
 * Browsers always send Origin on cross-site writes, so those are still checked.
 */
export function rejectCrossSite(request: Request): Response | null {
  const origin = request.headers.get('origin') ?? request.headers.get('referer');
  if (!origin && !request.headers.get('cookie')) return null;
  if (!origin) return problem(403, 'origin_required');
  let originHost: string;
  try {
    originHost = new URL(origin).host;
  } catch {
    return problem(403, 'bad_origin');
  }
  const allowed = new Set([new URL(getConfig().APP_URL).host]);
  const host = request.headers.get('x-forwarded-host') ?? request.headers.get('host');
  if (host) allowed.add(host);
  return allowed.has(originHost) ? null : problem(403, 'cross_site_request');
}

export function readCookie(request: Request, name: string): string | null {
  const header = request.headers.get('cookie');
  if (!header) return null;
  for (const part of header.split(';')) {
    const [key, ...rest] = part.trim().split('=');
    if (key === name) return decodeURIComponent(rest.join('='));
  }
  return null;
}

export function serializeCookie(
  name: string,
  value: string,
  options: { maxAgeSeconds?: number; httpOnly?: boolean; path?: string } = {},
): string {
  const secure = getConfig().APP_URL.startsWith('https://');
  return [
    `${name}=${encodeURIComponent(value)}`,
    `Path=${options.path ?? '/'}`,
    options.maxAgeSeconds !== undefined ? `Max-Age=${options.maxAgeSeconds}` : '',
    options.httpOnly === false ? '' : 'HttpOnly',
    'SameSite=Lax',
    secure ? 'Secure' : '',
  ]
    .filter(Boolean)
    .join('; ');
}

export function clientIp(request: Request): string {
  return (
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    request.headers.get('x-real-ip') ||
    'unknown'
  );
}
