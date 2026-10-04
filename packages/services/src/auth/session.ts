import { createHash, randomBytes } from 'node:crypto';
import { and, eq, gt } from 'drizzle-orm';
import type { Db } from '@nm/db';
import { sessions, users, type Locale, type UserRole } from '@nm/db/schema';

export const SESSION_COOKIE = 'nm_session';
export const SESSION_TTL_DAYS = 30;

export interface SessionUser {
  id: string;
  email: string;
  name: string | null;
  role: UserRole;
  locale: Locale;
}

/** Session ids in the database are SHA-256 hashes; a stolen DB dump cannot be replayed. */
export const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');

export const newToken = () => randomBytes(32).toString('base64url');

export async function getSessionUser(
  db: Db,
  token: string | null | undefined,
  now = new Date(),
): Promise<SessionUser | null> {
  if (!token || token.length < 20 || token.length > 100) return null;
  const [row] = await db
    .select({
      id: users.id,
      email: users.email,
      name: users.name,
      role: users.role,
      locale: users.locale,
    })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(and(eq(sessions.id, hashToken(token)), gt(sessions.expiresAt, now)));
  return row ?? null;
}
