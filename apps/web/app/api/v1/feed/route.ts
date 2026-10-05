import { z } from 'zod';
import { getDb } from '@nm/db';
import { getPreferences } from '@nm/services/auth/preferences';
import { getBehaviorProfile } from '@nm/services/content/behavior';
import { getFeed } from '@nm/services/content/feed';
import { hasPersonalizationConsent } from '@/lib/consent';
import { idParam, localeParam, pageParams, slugParam } from '@/lib/api-schemas';
import { json, parseQuery } from '@/lib/http';
import { getViewer } from '@/lib/viewer';

export const dynamic = 'force-dynamic';

const query = z.object({
  ...localeParam,
  ...pageParams,
  topic: slugParam.optional(),
  source: idParam.optional(),
});

/**
 * GET /api/v1/feed?locale=bg&topic=tech&page=1 — urgent first, then newest.
 * Signed-in readers get stories from their topics and sources lifted ("for you");
 * readers who consented also get a graded lift from what they actually read.
 */
export async function GET(request: Request) {
  const params = parseQuery(request, query);
  if (params instanceof Response) return params;
  const viewer = await getViewer(request);
  const user = viewer.user;
  const personalization = user ? await getPreferences(getDb(), user.id) : null;
  const behavior =
    viewer.actorKey && hasPersonalizationConsent(request)
      ? await getBehaviorProfile(getDb(), viewer.actorKey)
      : null;
  const feed = await getFeed(getDb(), {
    personalization,
    behavior,
    locale: params.locale,
    topic: params.topic,
    sourceId: params.source,
    page: params.page,
    perPage: params.perPage,
  });
  return json(feed);
}
