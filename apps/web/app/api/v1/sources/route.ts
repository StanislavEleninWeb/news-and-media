import { getDb } from '@nm/db';
import { listFollowableSources } from '@nm/services/auth/preferences';
import { json } from '@/lib/http';

export const dynamic = 'force-dynamic';

/** GET /api/v1/sources — outlets readers can follow. */
export async function GET() {
  return json(
    { sources: await listFollowableSources(getDb()) },
    { headers: { 'Cache-Control': 'public, max-age=300' } },
  );
}
