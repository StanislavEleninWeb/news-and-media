import { z } from 'zod';
import { getDb } from '@nm/db';
import { removePushSubscription, savePushSubscription } from '@nm/services/notifications/push';
import { noContent, parseBody, problem, rejectCrossSite } from '@/lib/http';
import { getUser } from '@/lib/viewer';

export const dynamic = 'force-dynamic';

const subscription = z.object({
  endpoint: z
    .string()
    .url()
    .max(2000)
    .refine((url) => url.startsWith('https://'), 'push endpoints are https'),
  keys: z.object({ p256dh: z.string().min(10).max(200), auth: z.string().min(8).max(100) }),
});

/** POST /api/v1/push/subscriptions — register this device for push (signed-in readers). */
export async function POST(request: Request) {
  const blocked = rejectCrossSite(request);
  if (blocked) return blocked;
  const user = await getUser(request);
  if (!user) return problem(401, 'unauthenticated');
  const body = await parseBody(request, subscription);
  if (body instanceof Response) return body;
  await savePushSubscription(getDb(), user.id, body, request.headers.get('user-agent'));
  return noContent();
}

/** DELETE /api/v1/push/subscriptions {endpoint} */
export async function DELETE(request: Request) {
  const blocked = rejectCrossSite(request);
  if (blocked) return blocked;
  const user = await getUser(request);
  if (!user) return problem(401, 'unauthenticated');
  const body = await parseBody(request, z.object({ endpoint: z.string().max(2000) }));
  if (body instanceof Response) return body;
  await removePushSubscription(getDb(), user.id, body.endpoint);
  return noContent();
}
