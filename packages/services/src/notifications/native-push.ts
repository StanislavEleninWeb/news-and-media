import { eq, sql } from 'drizzle-orm';
import { getConfig, type AppConfig } from '@nm/core/config';
import type { DeviceTokenInput } from '@nm/contracts';
import type { Db } from '@nm/db';
import { devicePushTokens } from '@nm/db/schema';

/**
 * Native push for the mobile app. Messages go to the Expo push service, which
 * relays them to FCM (Android) and APNs (iOS) with the credentials stored in
 * EAS — the server never holds Apple/Google push keys itself.
 */

export interface NativePushMessage {
  token: string;
  title: string;
  body: string;
  data: { url: string; tag?: string };
  urgency: 'normal' | 'high';
}

export type NativePushResult =
  | { ok: true }
  | {
      ok: false;
      /** The app was uninstalled or the token rotated: drop it. */ unregistered: boolean;
      error: string;
    };

/** Sends a batch; results are in the same order as the messages. */
export type NativePushSender = (messages: NativePushMessage[]) => Promise<NativePushResult[]>;

/** Expo accepts at most 100 messages per request. */
const BATCH = 100;

interface ExpoTicket {
  status: 'ok' | 'error';
  message?: string;
  details?: { error?: string };
}

export function createExpoPushSender(
  config: AppConfig = getConfig(),
  fetchImpl: typeof fetch = fetch,
): NativePushSender | null {
  if (!config.NATIVE_PUSH_ENABLED) return null;
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Accept: 'application/json',
  };
  if (config.EXPO_ACCESS_TOKEN) headers.Authorization = `Bearer ${config.EXPO_ACCESS_TOKEN}`;

  return async (messages) => {
    const results: NativePushResult[] = [];
    for (let i = 0; i < messages.length; i += BATCH) {
      const chunk = messages.slice(i, i + BATCH);
      const body = chunk.map((m) => ({
        to: m.token,
        title: m.title,
        body: m.body,
        data: m.data,
        sound: 'default',
        // "high" wakes the device immediately (FCM high priority / APNs priority 10).
        priority: m.urgency === 'high' ? 'high' : 'normal',
        channelId: m.urgency === 'high' ? 'breaking' : 'default',
        ttl: 6 * 3_600,
      }));
      let tickets: ExpoTicket[] = [];
      let failure: string | null = null;
      try {
        const response = await fetchImpl(config.EXPO_PUSH_URL, {
          method: 'POST',
          headers,
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(15_000),
        });
        if (!response.ok) failure = `Expo push HTTP ${response.status}`;
        else tickets = ((await response.json()) as { data?: ExpoTicket[] }).data ?? [];
      } catch (error) {
        failure = (error as Error).message;
      }
      chunk.forEach((_, index) => {
        const ticket = tickets[index];
        if (failure || !ticket) {
          results.push({ ok: false, unregistered: false, error: failure ?? 'missing ticket' });
        } else if (ticket.status === 'ok') {
          results.push({ ok: true });
        } else {
          results.push({
            ok: false,
            unregistered: ticket.details?.error === 'DeviceNotRegistered',
            error: ticket.details?.error ?? ticket.message ?? 'error',
          });
        }
      });
    }
    return results;
  };
}

export async function saveDeviceToken(db: Db, userId: string, input: DeviceTokenInput) {
  await db
    .insert(devicePushTokens)
    .values({ userId, token: input.token, platform: input.platform })
    .onConflictDoUpdate({
      target: devicePushTokens.token,
      set: { userId, platform: input.platform, failureCount: 0 },
    });
}

export async function removeDeviceToken(db: Db, userId: string, token: string) {
  await db
    .delete(devicePushTokens)
    .where(sql`${devicePushTokens.token} = ${token} and ${devicePushTokens.userId} = ${userId}`);
}

export async function listDeviceTokens(db: Db, userId: string) {
  return db.select().from(devicePushTokens).where(eq(devicePushTokens.userId, userId));
}
