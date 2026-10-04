import { z } from 'zod';
import { getDb } from '@nm/db';
import { getTrending } from '@nm/services/content/engagement';
import { localeParam } from '@/lib/api-schemas';
import { json, parseQuery } from '@/lib/http';

export const dynamic = 'force-dynamic';

/** GET /api/v1/trending?locale=bg — most-read stories, time-decayed. */
export async function GET(request: Request) {
  const params = parseQuery(
    request,
    z.object({ ...localeParam, limit: z.coerce.number().int().min(1).max(20).default(8) }),
  );
  if (params instanceof Response) return params;
  return json(
    { items: await getTrending(getDb(), params.locale, params.limit) },
    { headers: { 'Cache-Control': 'public, max-age=60' } },
  );
}
