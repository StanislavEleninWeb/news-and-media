import { z } from 'zod';
import { getDb } from '@nm/db';
import { AccountError, authenticate, createSession } from '@nm/services/auth/accounts';
import { sessionCookie } from '@/lib/auth-cookies';
import { clientIp, json, parseBody, problem, rejectCrossSite } from '@/lib/http';
import { rateLimit } from '@/lib/rate-limit';

export const dynamic = 'force-dynamic';

/** POST /api/v1/auth/login {email, password} */
export async function POST(request: Request) {
  const blocked = rejectCrossSite(request);
  if (blocked) return blocked;
  const input = await parseBody(
    request,
    z.object({ email: z.string().max(254), password: z.string().max(200) }),
  );
  if (input instanceof Response) return input;
  // Brute-force protection per IP and per account.
  if (
    !rateLimit(`login:${clientIp(request)}`, 20, 15 * 60_000) ||
    !rateLimit(`login:${input.email.trim().toLowerCase()}`, 10, 15 * 60_000)
  ) {
    return problem(429, 'rate_limited');
  }
  const db = getDb();
  try {
    const user = await authenticate(db, input.email, input.password);
    const session = await createSession(db, user.id, request.headers.get('user-agent'));
    return json({ user }, { cookies: [sessionCookie(session.token)] });
  } catch (error) {
    if (error instanceof AccountError) return problem(401, 'invalid_credentials');
    throw error;
  }
}
