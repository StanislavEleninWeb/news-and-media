import { z } from 'zod';
import { getDb } from '@nm/db';
import { AccountError, createSession, registerUser } from '@nm/services/auth/accounts';
import { localeSchema } from '@nm/services/content/contracts';
import { sessionCookie } from '@/lib/auth-cookies';
import { clientIp, json, parseBody, problem, rejectCrossSite } from '@/lib/http';
import { rateLimit } from '@/lib/rate-limit';

export const dynamic = 'force-dynamic';

const body = z.object({
  email: z.string().max(254),
  password: z.string().max(200),
  name: z.string().max(100).optional(),
  locale: localeSchema.optional(),
});

/** POST /api/v1/auth/register — creates the account and signs it in. */
export async function POST(request: Request) {
  const blocked = rejectCrossSite(request);
  if (blocked) return blocked;
  if (!rateLimit(`register:${clientIp(request)}`, 10, 3_600_000))
    return problem(429, 'rate_limited');
  const input = await parseBody(request, body);
  if (input instanceof Response) return input;
  const db = getDb();
  try {
    const user = await registerUser(db, input);
    const session = await createSession(db, user.id, request.headers.get('user-agent'));
    return json({ user }, { status: 201, cookies: [sessionCookie(session.token)] });
  } catch (error) {
    if (error instanceof AccountError) return problem(409, error.code);
    if (error instanceof z.ZodError)
      return problem(400, 'invalid_body', error.issues.map((i) => i.message).join('; '));
    throw error;
  }
}
