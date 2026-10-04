import { z } from 'zod';
import { getDb } from '@nm/db';
import {
  getNotificationSettings,
  setNotificationSettings,
} from '@nm/services/notifications/preferences';
import { json, parseBody, problem, rejectCrossSite } from '@/lib/http';
import { getUser } from '@/lib/viewer';

export const dynamic = 'force-dynamic';

/** GET /api/v1/me/notifications */
export async function GET(request: Request) {
  const user = await getUser(request);
  if (!user) return problem(401, 'unauthenticated');
  return json({ settings: await getNotificationSettings(getDb(), user.id) });
}

/** PUT /api/v1/me/notifications {emailDigest?, pushDigest?, pushUrgent?} */
export async function PUT(request: Request) {
  const blocked = rejectCrossSite(request);
  if (blocked) return blocked;
  const user = await getUser(request);
  if (!user) return problem(401, 'unauthenticated');
  const body = await parseBody(
    request,
    z.object({
      emailDigest: z.boolean().optional(),
      pushDigest: z.boolean().optional(),
      pushUrgent: z.boolean().optional(),
    }),
  );
  if (body instanceof Response) return body;
  return json({ settings: await setNotificationSettings(getDb(), user.id, body) });
}
