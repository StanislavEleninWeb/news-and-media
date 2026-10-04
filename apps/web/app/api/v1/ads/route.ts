import { z } from 'zod';
import { getDb } from '@nm/db';
import { pickAd } from '@nm/services/content/ads';
import { adPlacementSchema } from '@nm/services/content/contracts';
import { localeParam } from '@/lib/api-schemas';
import { json, parseQuery } from '@/lib/http';

export const dynamic = 'force-dynamic';

/** GET /api/v1/ads?placement=feed_inline&locale=bg — one creative or null. */
export async function GET(request: Request) {
  const params = parseQuery(request, z.object({ ...localeParam, placement: adPlacementSchema }));
  if (params instanceof Response) return params;
  return json({ ad: await pickAd(getDb(), params.placement, params.locale) });
}
