import { z } from 'zod';
import { getDb } from '@nm/db';
import { pickAd } from '@nm/services/content/ads';
import { adPlacementSchema } from '@nm/services/content/contracts';
import { localeParam } from '@/lib/api-schemas';
import { json, parseQuery } from '@/lib/http';

export const dynamic = 'force-dynamic';

const exclude = z
  .string()
  .optional()
  .transform((v) => (v ? v.split(',').slice(0, 20) : []))
  .pipe(z.array(z.string().uuid()));

/**
 * GET /api/v1/ads?placement=feed_inline&locale=bg[&exclude=<id>,<id>] — one
 * built-in creative or null. `exclude` lists ads this browser already showed
 * up to their daily frequency cap.
 */
export async function GET(request: Request) {
  const params = parseQuery(
    request,
    z.object({ ...localeParam, placement: adPlacementSchema, exclude }),
  );
  if (params instanceof Response) return params;
  return json({
    ad: await pickAd(getDb(), params.placement, params.locale, { exclude: params.exclude }),
  });
}
