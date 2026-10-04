import { eq } from 'drizzle-orm';
import { getDb } from '@nm/db';
import { adSlots } from '@nm/db/schema';
import { countAdEvent } from '@nm/services/content/ads';
import { idParam } from '@/lib/api-schemas';
import { hasAdConsent } from '@/lib/consent';
import { problem } from '@/lib/http';

export const dynamic = 'force-dynamic';

/**
 * GET /api/v1/ads/:id/click — counts the click (with consent) and redirects to
 * the advertiser URL stored for this creative. The target is never taken from
 * the request, so this cannot be abused as an open redirect.
 */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!idParam.safeParse(id).success) return problem(404, 'not_found');
  const [ad] = await getDb()
    .select({ targetUrl: adSlots.targetUrl })
    .from(adSlots)
    .where(eq(adSlots.id, id));
  if (!ad || !/^https?:\/\//.test(ad.targetUrl)) return problem(404, 'not_found');
  if (hasAdConsent(request.headers.get('cookie'))) await countAdEvent(getDb(), id, 'click');
  return new Response(null, {
    status: 302,
    headers: { Location: ad.targetUrl, 'Cache-Control': 'no-store' },
  });
}
