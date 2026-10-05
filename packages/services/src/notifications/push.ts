import { eq, inArray, sql } from 'drizzle-orm';
import * as webpushModule from 'web-push';
import { getConfig, type AppConfig } from '@nm/core/config';
import type { Db } from '@nm/db';
import { devicePushTokens, pushSubscriptions } from '@nm/db/schema';
import { isDeliveryAllowed } from '../mail/mailer';
import { createExpoPushSender, type NativePushSender } from './native-push';

// web-push is CommonJS: under native ESM (tsx, node) its functions live only on
// `default`, while bundlers also expose them as named exports. Accept both.
const webpush: typeof webpushModule =
  (webpushModule as { default?: typeof webpushModule }).default ?? webpushModule;

/** A new VAPID key pair (one per environment). */
export function generateVapidKeys(): { publicKey: string; privateKey: string } {
  return webpush.generateVAPIDKeys();
}

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

/** Every way a push can leave the server; a channel is null when not configured. */
export interface PushChannels {
  /** Browsers (VAPID Web Push). */
  web: PushSender | null;
  /** The mobile app (Expo push → FCM / APNs). */
  native: NativePushSender | null;
}

export function createPushChannels(config: AppConfig = getConfig()): PushChannels {
  return { web: createWebPushSender(config), native: createExpoPushSender(config) };
}

export const hasPushChannel = (channels: PushChannels | null): channels is PushChannels =>
  Boolean(channels && (channels.web || channels.native));

/**
 * Delivers a push to every device of a user — browsers and installed apps.
 * Expired web subscriptions (404/410) and unregistered app tokens are removed;
 * other failures are counted and the device dropped after 5 in a row.
 * Outside production only NOTIFY_ALLOWLIST users receive anything.
 */
export async function pushToUser(
  db: Db,
  channels: PushChannels,
  user: { id: string; email: string },
  payload: PushPayload,
  urgency: 'normal' | 'high' = 'normal',
): Promise<{ sent: number; removed: number; skipped: boolean }> {
  if (!isDeliveryAllowed(user.email)) return { sent: 0, removed: 0, skipped: true };
  let sent = 0;
  let removed = 0;

  if (channels.web) {
    const send = channels.web;
    const subscriptions = await db
      .select()
      .from(pushSubscriptions)
      .where(eq(pushSubscriptions.userId, user.id));
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
    removed += gone.length;
  }

  if (channels.native) {
    const devices = await db
      .select()
      .from(devicePushTokens)
      .where(eq(devicePushTokens.userId, user.id));
    if (devices.length) {
      const results = await channels.native(
        devices.map((device) => ({
          token: device.token,
          title: payload.title,
          body: payload.body,
          data: { url: payload.url, tag: payload.tag },
          urgency,
        })),
      );
      const gone: string[] = [];
      for (const [index, device] of devices.entries()) {
        const result = results[index];
        if (result?.ok) {
          sent += 1;
          await db
            .update(devicePushTokens)
            .set({ lastSuccessAt: new Date(), failureCount: 0 })
            .where(eq(devicePushTokens.id, device.id));
        } else if (result?.unregistered || device.failureCount >= 4) {
          gone.push(device.id);
        } else {
          await db
            .update(devicePushTokens)
            .set({ failureCount: device.failureCount + 1 })
            .where(eq(devicePushTokens.id, device.id));
        }
      }
      if (gone.length) await db.delete(devicePushTokens).where(inArray(devicePushTokens.id, gone));
      removed += gone.length;
    }
  }
  return { sent, removed, skipped: false };
}
