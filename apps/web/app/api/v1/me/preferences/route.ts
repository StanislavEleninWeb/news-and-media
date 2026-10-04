import { z } from 'zod';
import { getDb } from '@nm/db';
import { getPreferences, setPreferences } from '@nm/services/auth/preferences';
import { slugParam } from '@/lib/api-schemas';
import { json, parseBody, problem, rejectCrossSite } from '@/lib/http';
import { getUser } from '@/lib/viewer';

export const dynamic = 'force-dynamic';

const body = z.object({
  topics: z.array(slugParam).max(50).optional(),
  sourceIds: z.array(z.string().uuid()).max(200).optional(),
});

/** PUT /api/v1/me/preferences {topics?: string[], sourceIds?: string[]} — replaces the given lists. */
export async function PUT(request: Request) {
  const blocked = rejectCrossSite(request);
  if (blocked) return blocked;
  const user = await getUser(request);
  if (!user) return problem(401, 'unauthenticated');
  const input = await parseBody(request, body);
  if (input instanceof Response) return input;
  await setPreferences(getDb(), user.id, input);
  const { topics, sourceIds } = await getPreferences(getDb(), user.id);
  return json({ preferences: { topics, sourceIds } });
}
