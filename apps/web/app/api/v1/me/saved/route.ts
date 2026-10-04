import { z } from 'zod';
import { getDb } from '@nm/db';
import { listSaved } from '@nm/services/content/engagement';
import { localeParam } from '@/lib/api-schemas';
import { json, parseQuery, problem } from '@/lib/http';
import { getUser } from '@/lib/viewer';

export const dynamic = 'force-dynamic';

/** GET /api/v1/me/saved?locale=bg — the signed-in reader's reading list. */
export async function GET(request: Request) {
  const user = await getUser(request);
  if (!user) return problem(401, 'unauthenticated');
  const params = parseQuery(request, z.object(localeParam));
  if (params instanceof Response) return params;
  return json({ items: await listSaved(getDb(), user.id, params.locale) });
}
