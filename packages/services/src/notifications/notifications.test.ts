import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { resetConfig } from '@nm/core/config';
import type { Db } from '@nm/db';
import {
  devicePushTokens,
  jobs,
  pushSubscriptions,
  topics,
  userTopicPreferences,
  users,
} from '@nm/db/schema';
import { seedTopics } from '@nm/db/seed';
import { createTestDb } from '@nm/db/testing';
import { approveUrgent } from '../admin/articles';
import { resetMailer, useTestOutbox } from '../mail/mailer';
import { createPublishedArticle, createSource } from '../testing/content';
import { renderDigestEmail } from './digest-email';
import { localClock, scheduleDigests, sendDigest, sendUrgentPush } from './fanout';
import { setNotificationSettings } from './preferences';
import {
  createExpoPushSender,
  saveDeviceToken,
  type NativePushMessage,
  type NativePushSender,
} from './native-push';
import { pushToUser, savePushSubscription, type PushChannels, type PushSender } from './push';
import { envSchema } from '@nm/core/config';

let db: Db;
let close: () => Promise<void>;
let sourceId: string;
let topicIds: Record<string, string>;
const deliveries: { endpoint: string; payload: Record<string, string>; urgency: string }[] = [];
const sender: PushSender = async (subscription, payload, urgency) => {
  if (subscription.endpoint.includes('gone'))
    throw Object.assign(new Error('Gone'), { statusCode: 410 });
  deliveries.push({ endpoint: subscription.endpoint, payload: JSON.parse(payload), urgency });
  return 201;
};
const nativeDeliveries: NativePushMessage[] = [];
const nativeSender: NativePushSender = async (messages) =>
  messages.map((m) => {
    if (m.token.includes('Gone'))
      return { ok: false, unregistered: true, error: 'DeviceNotRegistered' };
    nativeDeliveries.push(m);
    return { ok: true };
  });
const channels: PushChannels = { web: sender, native: nativeSender };

async function reader(
  email: string,
  options: {
    topics?: string[];
    locale?: 'bg' | 'en';
    pushUrgent?: boolean;
    device?: boolean;
    app?: boolean;
  } = {},
) {
  const [user] = await db
    .insert(users)
    .values({ email, locale: options.locale ?? 'bg' })
    .returning();
  for (const slug of options.topics ?? [])
    await db.insert(userTopicPreferences).values({ userId: user!.id, topicId: topicIds[slug]! });
  await setNotificationSettings(db, user!.id, { pushUrgent: options.pushUrgent ?? true });
  if (options.device !== false) {
    await savePushSubscription(db, user!.id, {
      endpoint: `https://push.example/${email}`,
      keys: { p256dh: 'p256dh-key-value', auth: 'auth-key' },
    });
  }
  if (options.app) {
    await saveDeviceToken(db, user!.id, {
      token: `ExponentPushToken[${email.replace(/[^a-z]/g, '')}]`,
      platform: 'android',
    });
  }
  return user!;
}

beforeAll(async () => {
  process.env.APP_ENV = 'production';
  process.env.APP_URL = 'https://news.example.bg';
  process.env.DATABASE_URL = 'postgres://unused';
  process.env.TYPESENSE_URL = 'http://unused';
  process.env.TYPESENSE_API_KEY = 'unused';
  resetConfig();
  ({ db, close } = await createTestDb());
  await seedTopics(db);
  topicIds = Object.fromEntries((await db.select().from(topics)).map((t) => [t.slug, t.id]));
  sourceId = (await createSource(db)).id;
});
afterAll(async () => {
  for (const key of ['APP_ENV', 'APP_URL', 'DATABASE_URL', 'TYPESENSE_URL', 'TYPESENSE_API_KEY'])
    delete process.env[key];
  resetConfig();
  resetMailer();
  await close();
});
beforeEach(() => {
  deliveries.length = 0;
  nativeDeliveries.length = 0;
});

describe('breaking-news push', () => {
  it('reaches readers of the topic and readers without topic filters, in their language', async () => {
    const techFan = await reader('tech@example.bg', { topics: ['tech'], locale: 'en' });
    await reader('sport@example.bg', { topics: ['sport'] });
    const everything = await reader('all@example.bg');
    await reader('muted@example.bg', { pushUrgent: false });
    await reader('nodevice@example.bg', { device: false });
    const appOnly = await reader('app@example.bg', { device: false, app: true, locale: 'en' });
    const editor = (
      await db.insert(users).values({ email: 'ed@example.bg', role: 'editor' }).returning()
    )[0]!;

    const article = await createPublishedArticle(db, {
      sourceId,
      topicSlugs: ['tech'],
      texts: {
        bg: { title: 'Голям срив в мрежата', tldr: 'Хиляди без интернет.' },
        en: { title: 'Major network outage', tldr: 'Thousands offline.' },
      },
    });
    expect(await sendUrgentPush(db, channels, article.id)).toMatchObject({
      recipients: 0,
      reason: expect.stringContaining('not'),
    });

    await approveUrgent(db, article.id, editor.id);
    const result = await sendUrgentPush(db, channels, article.id);
    expect(result).toMatchObject({ recipients: 3, sent: 3 });
    const byEndpoint = Object.fromEntries(deliveries.map((d) => [d.endpoint, d]));
    expect(byEndpoint[`https://push.example/${techFan.email}`]!.payload).toMatchObject({
      title: 'Breaking: Major network outage',
      url: expect.stringMatching(/^\/en\/a\//),
      tag: `urgent-${article.id}`,
    });
    expect(byEndpoint[`https://push.example/${everything.email}`]!.payload.title).toBe(
      'Извънредно: Голям срив в мрежата',
    );
    expect(deliveries.every((d) => d.urgency === 'high')).toBe(true);
    // The app-only reader got a native push that opens the English story.
    expect(nativeDeliveries).toEqual([
      expect.objectContaining({
        token: 'ExponentPushToken[appexamplebg]',
        title: 'Breaking: Major network outage',
        urgency: 'high',
        data: { url: expect.stringMatching(/^\/en\/a\//), tag: `urgent-${article.id}` },
      }),
    ]);
    expect(appOnly.locale).toBe('en');
  });

  it('does nothing without any push channel', async () => {
    for (const none of [null, { web: null, native: null }]) {
      expect(await sendUrgentPush(db, none, crypto.randomUUID())).toMatchObject({
        sent: 0,
        reason: 'push not configured',
      });
    }
  });
});

describe('pushToUser', () => {
  it('removes subscriptions the push service reports as gone', async () => {
    const user = await reader('twodevices@example.bg');
    await savePushSubscription(db, user.id, {
      endpoint: 'https://push.example/gone-device',
      keys: { p256dh: 'p256dh-key-value', auth: 'auth-key' },
    });
    const result = await pushToUser(db, channels, user, { title: 't', body: 'b', url: '/bg' });
    expect(result).toEqual({ sent: 1, removed: 1, skipped: false });
    expect(
      await db
        .select()
        .from(pushSubscriptions)
        .where(eq(pushSubscriptions.endpoint, 'https://push.example/gone-device')),
    ).toHaveLength(0);
  });

  it('delivers to installed apps and drops uninstalled ones', async () => {
    const user = await reader('phones@example.bg', { device: false, app: true });
    await saveDeviceToken(db, user.id, { token: 'ExponentPushToken[Gone1]', platform: 'ios' });
    const result = await pushToUser(db, channels, user, { title: 't', body: 'b', url: '/bg' });
    expect(result).toEqual({ sent: 1, removed: 1, skipped: false });
    const left = await db
      .select({ token: devicePushTokens.token })
      .from(devicePushTokens)
      .where(eq(devicePushTokens.userId, user.id));
    expect(left).toEqual([{ token: 'ExponentPushToken[phonesexamplebg]' }]);
  });
});

describe('Expo push sender', () => {
  const config = (extra: Record<string, string> = {}) =>
    envSchema.parse({ APP_ENV: 'development', ...extra });

  it('maps tickets to results, flags DeviceNotRegistered and sends the access token', async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const fakeFetch = (async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return new Response(
        JSON.stringify({
          data: [
            { status: 'ok', id: 'a' },
            { status: 'error', message: 'x', details: { error: 'DeviceNotRegistered' } },
            {
              status: 'error',
              message: 'Rate exceeded',
              details: { error: 'MessageRateExceeded' },
            },
          ],
        }),
        { status: 200 },
      );
    }) as unknown as typeof fetch;
    const send = createExpoPushSender(config({ EXPO_ACCESS_TOKEN: 'expo-secret' }), fakeFetch)!;
    const message = (token: string): NativePushMessage => ({
      token,
      title: 'T',
      body: 'B',
      data: { url: '/bg' },
      urgency: 'high',
    });
    const results = await send([message('t1'), message('t2'), message('t3')]);
    expect(results).toEqual([
      { ok: true },
      { ok: false, unregistered: true, error: 'DeviceNotRegistered' },
      { ok: false, unregistered: false, error: 'MessageRateExceeded' },
    ]);
    expect(calls[0]!.url).toBe('https://exp.host/--/api/v2/push/send');
    expect((calls[0]!.init.headers as Record<string, string>).Authorization).toBe(
      'Bearer expo-secret',
    );
    const body = JSON.parse(String(calls[0]!.init.body));
    expect(body[0]).toMatchObject({ to: 't1', priority: 'high', channelId: 'breaking' });
  });

  it('reports every message as failed (not unregistered) when Expo is down', async () => {
    const down = (async () => new Response('', { status: 503 })) as unknown as typeof fetch;
    const send = createExpoPushSender(config(), down)!;
    expect(
      await send([{ token: 't', title: 'T', body: 'B', data: { url: '/' }, urgency: 'normal' }]),
    ).toEqual([{ ok: false, unregistered: false, error: 'Expo push HTTP 503' }]);
  });

  it('can be switched off', () => {
    expect(createExpoPushSender(config({ NATIVE_PUSH_ENABLED: 'false' }))).toBeNull();
  });
});

describe('daily briefing', () => {
  it('uses the configured local hour (Europe/Sofia, 07:00)', () => {
    expect(localClock(new Date('2026-10-05T04:30:00Z'), 'Europe/Sofia')).toEqual({
      date: '2026-10-05',
      hour: 7,
    });
    expect(localClock(new Date('2026-12-05T05:10:00Z'), 'Europe/Sofia')).toEqual({
      date: '2026-12-05',
      hour: 7,
    });
  });

  it('queues exactly one digest per opted-in reader per day', async () => {
    const subscriber = await reader('digest@example.bg', { topics: ['politics'] });
    await setNotificationSettings(db, subscriber.id, { emailDigest: true });
    expect(await scheduleDigests(db, new Date('2026-10-05T09:00:00Z'))).toBe(0); // 12:00 local
    expect(await scheduleDigests(db, new Date('2026-10-05T04:05:00Z'))).toBe(1);
    expect(await scheduleDigests(db, new Date('2026-10-05T04:35:00Z'))).toBe(0);
    const [job] = await db.select().from(jobs).where(eq(jobs.kind, 'digest'));
    expect(job!.payload).toEqual({ userId: subscriber.id, date: '2026-10-05' });
  });

  it("e-mails the reader's top stories of the last 24 hours with an unsubscribe link", async () => {
    const outbox = useTestOutbox();
    const [subscriber] = await db.select().from(users).where(eq(users.email, 'digest@example.bg'));
    await createPublishedArticle(db, {
      sourceId,
      topicSlugs: ['politics'],
      texts: { bg: { title: 'Парламентът прие бюджета' } },
    });
    await createPublishedArticle(db, {
      sourceId,
      publishedAt: new Date(Date.now() - 3 * 86_400_000),
      texts: { bg: { title: 'Стара новина' } },
    });
    const result = await sendDigest(db, channels, subscriber!.id);
    expect(result).toMatchObject({ sent: true, channels: ['email'] });
    expect(outbox[0]!.to).toBe('digest@example.bg');
    expect(outbox[0]!.subject).toMatch(/^Вашият дневен бюлетин/);
    expect(outbox[0]!.text).toContain('Парламентът прие бюджета');
    expect(outbox[0]!.text).not.toContain('Стара новина');
    expect(outbox[0]!.headers?.['List-Unsubscribe']).toBe('<https://news.example.bg/bg/account>');
  });

  it('escapes article text in the HTML e-mail', () => {
    const { html } = renderDigestEmail({
      locale: 'en',
      siteName: 'News',
      siteUrl: 'https://n.bg',
      dateLabel: 'Monday',
      items: [
        {
          id: crypto.randomUUID(),
          locale: 'en',
          title: '<script>alert(1)</script>',
          tldr: 'a & b',
          slug: 's',
          path: '/en/a/x/s',
          imageUrl: null,
          imageThumbUrl: null,
          source: { id: crypto.randomUUID(), name: 'S' },
          topics: [],
          publishedAt: new Date().toISOString(),
          isUrgent: false,
        },
      ],
    });
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
    expect(html).toContain('a &amp; b');
  });
});
