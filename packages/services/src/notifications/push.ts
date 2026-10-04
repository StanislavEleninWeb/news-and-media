import { eq, inArray, sql } from 'drizzle-orm';
import * as webpush from 'web-push';
import { getConfig, type AppConfig } from '@nm/core/config';
import type { Db } from '@nm/db';
import { pushSubscriptions } from '@nm/db/schema';
import { isDeliveryAllowed } from '../mail/mailer';

export interface PushPayload {
  title: string;
  body: string;
  url: string;
  /** Same tag = the device replaces the previous notification instead of stacking. */
  tag?: string;
}

export interface PushSubscriptionInput {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}

/** Sends one Web Push message; resolves with the push service's HTTP status. */
export type PushSender = (
  subscription: PushSubscriptionInput,
  payload: string,
  urgency: 'normal' | 'high',
) => Promise<number>;

export function createWebPushSender(config: AppConfig = getConfig()): PushSender | null {
  if (!config.VAPID_PUBLIC_KEY || !config.VAPID_PRIVATE_KEY) return null;
  const vapidDetails = {
    subject: config.VAPID_SUBJECT ?? `mailto:no-reply@${new URL(config.APP_URL).hostname}`,
    publicKey: config.VAPID_PUBLIC_KEY,
    privateKey: config.VAPID_PRIVATE_KEY,
  };
  return async (subscription, payload, urgency) => {
    const result = await webpush.sendNotification(subscription, payload, {
      vapidDetails,
      TTL: 6 * 3_600,
      urgency,
    });
    return result.statusCode;
  };
}

export async function savePushSubscription(
  db: Db,
  userId: string,
  input: PushSubscriptionInput,
  userAgent?: string | null,
) {
  await db
    .insert(pushSubscriptions)
    .values({
      userId,
      endpoint: input.endpoint,
      p256dh: input.keys.p256dh,
      auth: input.keys.auth,
      userAgent: userAgent?.slice(0, 300) ?? null,
    })
    .onConflictDoUpdate({
      target: pushSubscriptions.endpoint,
      set: { userId, p256dh: input.keys.p256dh, auth: input.keys.auth, failureCount: 0 },
    });
}

export async function removePushSubscription(db: Db, userId: string, endpoint: string) {
  await db
    .delete(pushSubscriptions)
    .where(
      sql`${pushSubscriptions.endpoint} = ${endpoint} and ${pushSubscriptions.userId} = ${userId}`,
    );
}

/**
 * Delivers a push to every device of a user. Expired subscriptions (404/410)
 * are removed; other failures are counted and the subscription dropped after 5.
 * Outside production only NOTIFY_ALLOWLIST users receive anything.
 */
export async function pushToUser(
  db: Db,
  send: PushSender,
  user: { id: string; email: string },
  payload: PushPayload,
  urgency: 'normal' | 'high' = 'normal',
): Promise<{ sent: number; removed: number; skipped: boolean }> {
  if (!isDeliveryAllowed(user.email)) return { sent: 0, removed: 0, skipped: true };
  const subscriptions = await db
    .select()
    .from(pushSubscriptions)
    .where(eq(pushSubscriptions.userId, user.id));
  let sent = 0;
  const gone: string[] = [];
  for (const sub of subscriptions) {
    try {
      await send(
        { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
        JSON.stringify(payload),
        urgency,
      );
      sent += 1;
      await db
        .update(pushSubscriptions)
        .set({ lastSuccessAt: new Date(), failureCount: 0 })
        .where(eq(pushSubscriptions.id, sub.id));
    } catch (error) {
      const status = (error as { statusCode?: number }).statusCode;
      if (status === 404 || status === 410 || sub.failureCount >= 4) gone.push(sub.id);
      else
        await db
          .update(pushSubscriptions)
          .set({ failureCount: sub.failureCount + 1 })
          .where(eq(pushSubscriptions.id, sub.id));
    }
  }
  if (gone.length) await db.delete(pushSubscriptions).where(inArray(pushSubscriptions.id, gone));
  return { sent, removed: gone.length, skipped: false };
}
