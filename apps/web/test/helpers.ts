import { resetConfig } from '@nm/core/config';
import { setDbForTesting, type Db } from '@nm/db';
import { sessions, users } from '@nm/db/schema';
import { seedTopics } from '@nm/db/seed';
import { createTestDb } from '@nm/db/testing';
import { hashToken, newToken, SESSION_COOKIE } from '@nm/services/auth/session';
import { resetRateLimits } from '@/lib/rate-limit';

export const ORIGIN = 'http://localhost:3000';

export async function setupApiTest() {
  delete process.env.TYPESENSE_URL;
  resetConfig();
  resetRateLimits();
  const { db, close } = await createTestDb();
  await seedTopics(db);
  setDbForTesting(db);
  return {
    db,
    close: async () => {
      setDbForTesting(undefined);
      await close();
    },
  };
}

export function request(
  path: string,
  init: RequestInit & { cookie?: string; origin?: string | null } = {},
) {
  const headers = new Headers(init.headers);
  if (init.cookie) headers.set('cookie', init.cookie);
  if (init.origin !== null && init.method && init.method !== 'GET')
    headers.set('origin', init.origin ?? ORIGIN);
  if (init.body && !headers.has('content-type')) headers.set('content-type', 'application/json');
  return new Request(`${ORIGIN}${path}`, { ...init, headers });
}

export const params = <T extends Record<string, string>>(value: T) => ({
  params: Promise.resolve(value),
});

/** Creates a user with a live session and returns the cookie header to use. */
export async function signedInCookie(db: Db, email = `u${Date.now()}${Math.random()}@test.bg`) {
  const [user] = await db.insert(users).values({ email }).returning();
  const token = newToken();
  await db.insert(sessions).values({
    id: hashToken(token),
    userId: user!.id,
    expiresAt: new Date(Date.now() + 86_400_000),
  });
  return { user: user!, cookie: `${SESSION_COOKIE}=${token}` };
}
