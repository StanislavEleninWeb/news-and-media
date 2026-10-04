import { getDb } from '@nm/db';
import { getPreferences } from '@nm/services/auth/preferences';
import { json, problem } from '@/lib/http';
import { getUser } from '@/lib/viewer';

export const dynamic = 'force-dynamic';

/** GET /api/v1/me — the signed-in reader and their followed topics/sources. */
export async function GET(request: Request) {
  const user = await getUser(request);
  if (!user) return problem(401, 'unauthenticated');
  const { topics, sourceIds } = await getPreferences(getDb(), user.id);
  return json({ user, preferences: { topics, sourceIds } });
}
