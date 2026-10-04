import { z } from 'zod';
import { getDb } from '@nm/db';
import { listTopics } from '@nm/services/content/topics';
import { localeParam } from '@/lib/api-schemas';
import { json, parseQuery } from '@/lib/http';

export const dynamic = 'force-dynamic';

/** GET /api/v1/topics?locale=bg */
export async function GET(request: Request) {
  const params = parseQuery(request, z.object(localeParam));
  if (params instanceof Response) return params;
  return json(
    { topics: await listTopics(getDb(), params.locale) },
    { headers: { 'Cache-Control': 'public, max-age=300' } },
  );
}
