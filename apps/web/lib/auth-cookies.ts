import { SESSION_COOKIE, SESSION_TTL_DAYS } from '@nm/services/auth/session';
import { serializeCookie } from './http';

export const sessionCookie = (token: string) =>
  serializeCookie(SESSION_COOKIE, token, { maxAgeSeconds: SESSION_TTL_DAYS * 86_400 });

export const clearSessionCookie = () => serializeCookie(SESSION_COOKIE, '', { maxAgeSeconds: 0 });

/** Only same-site relative paths are accepted as post-login redirect targets. */
export function safeNextPath(next: string | null | undefined, fallback = '/'): string {
  if (!next || !next.startsWith('/') || next.startsWith('//') || next.startsWith('/\\'))
    return fallback;
  return next;
}
