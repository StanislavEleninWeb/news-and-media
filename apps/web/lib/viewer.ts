import { randomUUID } from 'node:crypto';
import { getDb } from '@nm/db';
import { getSessionUser, SESSION_COOKIE, type SessionUser } from '@nm/services/auth/session';
import { readCookie, serializeCookie } from './http';

export const ANON_COOKIE = 'nm_aid';

export interface Viewer {
  user: SessionUser | null;
  /** Identity for reactions: the user, or a random anonymous id kept in a cookie. */
  actorKey: string;
  /** Cookies the response must set (e.g. a new anonymous id). */
  cookies: string[];
}

export async function getUser(request: Request): Promise<SessionUser | null> {
  return getSessionUser(getDb(), readCookie(request, SESSION_COOKIE));
}

export async function getViewer(
  request: Request,
  options: { createAnonymousId?: boolean } = {},
): Promise<Viewer> {
  const user = await getUser(request);
  if (user) return { user, actorKey: `u:${user.id}`, cookies: [] };
  const existing = readCookie(request, ANON_COOKIE);
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
