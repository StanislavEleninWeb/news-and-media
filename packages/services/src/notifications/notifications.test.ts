import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { resetConfig } from '@nm/core/config';
import type { Db } from '@nm/db';
import { jobs, pushSubscriptions, topics, userTopicPreferences, users } from '@nm/db/schema';
import { seedTopics } from '@nm/db/seed';
import { createTestDb } from '@nm/db/testing';
import { approveUrgent } from '../admin/articles';
import { resetMailer, useTestOutbox } from '../mail/mailer';
import { createPublishedArticle, createSource } from '../testing/content';
import { renderDigestEmail } from './digest-email';
import { localClock, scheduleDigests, sendDigest, sendUrgentPush } from './fanout';
import { setNotificationSettings } from './preferences';
import { pushToUser, savePushSubscription, type PushSender } from './push';

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

async function reader(
  email: string,
  options: { topics?: string[]; locale?: 'bg' | 'en'; pushUrgent?: boolean; device?: boolean } = {},
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
});

describe('breaking-news push', () => {
  it('reaches readers of the topic and readers without topic filters, in their language', async () => {
    const techFan = await reader('tech@example.bg', { topics: ['tech'], locale: 'en' });
    await reader('sport@example.bg', { topics: ['sport'] });
    const everything = await reader('all@example.bg');
    await reader('muted@example.bg', { pushUrgent: false });
    await reader('nodevice@example.bg', { device: false });
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
    expect(await sendUrgentPush(db, sender, article.id)).toMatchObject({
      recipients: 0,
      reason: expect.stringContaining('not'),
    });

    await approveUrgent(db, article.id, editor.id);
    const result = await sendUrgentPush(db, sender, article.id);
    expect(result).toMatchObject({ recipients: 2, sent: 2 });
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
  });

  it('does nothing without VAPID keys', async () => {
    expect(await sendUrgentPush(db, null, crypto.randomUUID())).toMatchObject({
      sent: 0,
      reason: 'VAPID keys not configured',
    });
  });
});

describe('pushToUser', () => {
  it('removes subscriptions the push service reports as gone', async () => {
    const user = await reader('twodevices@example.bg');
    await savePushSubscription(db, user.id, {
      endpoint: 'https://push.example/gone-device',
      keys: { p256dh: 'p256dh-key-value', auth: 'auth-key' },
    });
    const result = await pushToUser(db, sender, user, { title: 't', body: 'b', url: '/bg' });
    expect(result).toEqual({ sent: 1, removed: 1, skipped: false });
    expect(
      await db
        .select()
        .from(pushSubscriptions)
        .where(eq(pushSubscriptions.endpoint, 'https://push.example/gone-device')),
    ).toHaveLength(0);
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
    const result = await sendDigest(db, sender, subscriber!.id);
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
