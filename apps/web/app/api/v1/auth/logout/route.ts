import { getDb } from '@nm/db';
import { deleteSession } from '@nm/services/auth/accounts';
import { SESSION_COOKIE } from '@nm/services/auth/session';
import { clearSessionCookie } from '@/lib/auth-cookies';
import { bearerToken, noContent, readCookie, rejectCrossSite } from '@/lib/http';

export const dynamic = 'force-dynamic';

/** POST /api/v1/auth/logout — ends the cookie session (web) or the bearer session (app). */
export async function POST(request: Request) {
  const blocked = rejectCrossSite(request);
  if (blocked) return blocked;
  const token = bearerToken(request) ?? readCookie(request, SESSION_COOKIE);
  if (token) await deleteSession(getDb(), token);
  return noContent([clearSessionCookie()]);
}
