import { z } from 'zod';
import { getDb } from '@nm/db';
import { getFeed } from '@nm/services/content/feed';
import { idParam, localeParam, pageParams, slugParam } from '@/lib/api-schemas';
import { json, parseQuery } from '@/lib/http';

export const dynamic = 'force-dynamic';

const query = z.object({
  ...localeParam,
  ...pageParams,
  topic: slugParam.optional(),
  source: idParam.optional(),
});

/** GET /api/v1/feed?locale=bg&topic=tech&page=1 — urgent first, then newest. */
export async function GET(request: Request) {
  const params = parseQuery(request, query);
  if (params instanceof Response) return params;
  const feed = await getFeed(getDb(), {
    locale: params.locale,
    topic: params.topic,
    sourceId: params.source,
    page: params.page,
    perPage: params.perPage,
  });
  return json(feed);
}
