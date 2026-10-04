import { z } from 'zod';
import { getDb } from '@nm/db';
import { AccountError, resetPassword } from '@nm/services/auth/accounts';
import { noContent, parseBody, problem, rejectCrossSite } from '@/lib/http';

export const dynamic = 'force-dynamic';

/** POST /api/v1/auth/password-reset/confirm {token, password} */
export async function POST(request: Request) {
  const blocked = rejectCrossSite(request);
  if (blocked) return blocked;
  const input = await parseBody(
    request,
    z.object({ token: z.string().min(20).max(100), password: z.string().max(200) }),
  );
  if (input instanceof Response) return input;
  try {
    await resetPassword(getDb(), input.token, input.password);
    return noContent();
  } catch (error) {
    if (error instanceof AccountError) return problem(400, error.code);
    if (error instanceof z.ZodError)
      return problem(400, 'weak_password', error.issues.map((i) => i.message).join('; '));
    throw error;
  }
}
