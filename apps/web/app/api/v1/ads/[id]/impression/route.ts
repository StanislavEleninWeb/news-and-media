import { getDb } from '@nm/db';
import { countAdEvent } from '@nm/services/content/ads';
import { idParam } from '@/lib/api-schemas';
import { hasAdConsent } from '@/lib/consent';
import { clientIp, noContent } from '@/lib/http';
import { rateLimit } from '@/lib/rate-limit';

export const dynamic = 'force-dynamic';

/** POST /api/v1/ads/:id/impression — counted only with consent, once per IP and ad per minute. */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!idParam.safeParse(id).success || !hasAdConsent(request.headers.get('cookie')))
    return noContent();
  if (rateLimit(`ad-imp:${clientIp(request)}:${id}`, 1, 60_000))
    await countAdEvent(getDb(), id, 'impression');
  return noContent();
}
