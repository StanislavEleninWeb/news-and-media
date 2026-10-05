import { randomUUID } from 'node:crypto';
import { getDb } from '@nm/db';
import { getSessionUser, SESSION_COOKIE, type SessionUser } from '@nm/services/auth/session';
import { bearerToken, readCookie, serializeCookie } from './http';

export const ANON_COOKIE = 'nm_aid';
/** The mobile app keeps its anonymous id on the device and sends it in this header. */
export const ANON_HEADER = 'x-nm-anon-id';

export interface Viewer {
  user: SessionUser | null;
  /** Identity for reactions: the user, or a random anonymous id kept in a cookie. */
  actorKey: string;
  /** Cookies the response must set (e.g. a new anonymous id). */
  cookies: string[];
}

/**
 * The signed-in reader: a bearer token (mobile app) or the session cookie
 * (web). When a bearer header is present the cookie is ignored.
 */
export async function getUser(request: Request): Promise<SessionUser | null> {
  const token = request.headers.has('authorization')
    ? bearerToken(request)
    : readCookie(request, SESSION_COOKIE);
  return getSessionUser(getDb(), token);
}

export async function getViewer(
  request: Request,
  options: { createAnonymousId?: boolean } = {},
): Promise<Viewer> {
  const user = await getUser(request);
  if (user) return { user, actorKey: `u:${user.id}`, cookies: [] };
  const existing = readCookie(request, ANON_COOKIE) ?? request.headers.get(ANON_HEADER);
  if (existing && /^[0-9a-f-]{36}$/.test(existing))
    return { user: null, actorKey: `a:${existing}`, cookies: [] };
  if (!options.createAnonymousId) return { user: null, actorKey: '', cookies: [] };
  const id = randomUUID();
  return {
    user: null,
    actorKey: `a:${id}`,
    cookies: [serializeCookie(ANON_COOKIE, id, { maxAgeSeconds: 365 * 86_400 })],
  };
}
