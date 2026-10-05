import { z } from 'zod';
import { getDb } from '@nm/db';
import { deviceTokenInputSchema } from '@nm/contracts';
import { removeDeviceToken, saveDeviceToken } from '@nm/services/notifications/native-push';
import { noContent, parseBody, problem, rejectCrossSite } from '@/lib/http';
import { getUser } from '@/lib/viewer';

export const dynamic = 'force-dynamic';

/** POST /api/v1/push/devices {token, platform} — register the mobile app for native push. */
export async function POST(request: Request) {
  const blocked = rejectCrossSite(request);
  if (blocked) return blocked;
  const user = await getUser(request);
  if (!user) return problem(401, 'unauthenticated');
  const body = await parseBody(request, deviceTokenInputSchema);
  if (body instanceof Response) return body;
  await saveDeviceToken(getDb(), user.id, body);
  return noContent();
}

/** DELETE /api/v1/push/devices {token} — e.g. on sign-out or when push is switched off. */
export async function DELETE(request: Request) {
  const blocked = rejectCrossSite(request);
  if (blocked) return blocked;
  const user = await getUser(request);
  if (!user) return problem(401, 'unauthenticated');
  const body = await parseBody(request, z.object({ token: z.string().max(200) }));
  if (body instanceof Response) return body;
  await removeDeviceToken(getDb(), user.id, body.token);
  return noContent();
}
