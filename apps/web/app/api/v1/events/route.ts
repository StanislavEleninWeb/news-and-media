import { getDb } from '@nm/db';
import { engagementBatchSchema } from '@nm/contracts';
import { forgetEngagement, recordEngagement } from '@nm/services/content/behavior';
import { hasPersonalizationConsent } from '@/lib/consent';
import { clientIp, noContent, problem, rejectCrossSite } from '@/lib/http';
import { rateLimit } from '@/lib/rate-limit';
import { getViewer } from '@/lib/viewer';

export const dynamic = 'force-dynamic';

/**
 * POST /api/v1/events {events:[{articleId, kind, dwellMs?}]} — reading signals
 * (open, reading time, share). Accepts text/plain so browsers can use
 * navigator.sendBeacon on page hide. Without consent nothing is stored.
 */
export async function POST(request: Request) {
  const blocked = rejectCrossSite(request);
  if (blocked) return blocked;
  if (!hasPersonalizationConsent(request)) return noContent();
  if (!rateLimit(`events:${clientIp(request)}`, 120, 60_000)) return problem(429, 'rate_limited');
  let body: unknown;
  try {
    const text = await request.text();
    if (text.length > 8_000) return problem(413, 'too_large');
    body = JSON.parse(text);
  } catch {
    return problem(400, 'invalid_json');
  }
  const parsed = engagementBatchSchema.safeParse(body);
  if (!parsed.success) return problem(400, 'invalid_body');
  const viewer = await getViewer(request, { createAnonymousId: true });
  await recordEngagement(
    getDb(),
    { actorKey: viewer.actorKey, userId: viewer.user?.id },
    parsed.data.events,
  );
  return noContent(viewer.cookies);
}

/** DELETE /api/v1/events — forget this reader's reading history (also on consent withdrawal). */
export async function DELETE(request: Request) {
  const blocked = rejectCrossSite(request);
  if (blocked) return blocked;
  const viewer = await getViewer(request);
  if (viewer.actorKey) await forgetEngagement(getDb(), viewer.actorKey);
  return noContent();
}
