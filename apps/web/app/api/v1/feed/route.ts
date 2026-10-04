import { z } from 'zod';
import { getDb } from '@nm/db';
import { getPreferences } from '@nm/services/auth/preferences';
import { getFeed } from '@nm/services/content/feed';
import { idParam, localeParam, pageParams, slugParam } from '@/lib/api-schemas';
import { json, parseQuery } from '@/lib/http';
import { getUser } from '@/lib/viewer';

export const dynamic = 'force-dynamic';

const query = z.object({
  ...localeParam,
  ...pageParams,
  topic: slugParam.optional(),
  source: idParam.optional(),
});

/**
 * GET /api/v1/feed?locale=bg&topic=tech&page=1 — urgent first, then newest.
 * Signed-in readers get stories from their topics and sources lifted ("for you").
 */
export async function GET(request: Request) {
  const params = parseQuery(request, query);
  if (params instanceof Response) return params;
  const user = await getUser(request);
  const personalization = user ? await getPreferences(getDb(), user.id) : null;
  const feed = await getFeed(getDb(), {
    personalization,
    locale: params.locale,
    topic: params.topic,
    sourceId: params.source,
    page: params.page,
    perPage: params.perPage,
  });
  return json(feed);
}
