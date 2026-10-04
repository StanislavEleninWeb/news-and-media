import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Db } from '@nm/db';
import { adSlots, articleCorrections, articleViewBuckets, topics, users } from '@nm/db/schema';
import { seedTopics } from '@nm/db/seed';
import { createTestDb } from '@nm/db/testing';
import { createPublishedArticle, createSource } from '../testing/content';
import { pickAd } from './ads';
import { getArticle } from './article';
import { articleCardSchema, articleDetailSchema, feedResponseSchema } from './contracts';
import {
  getReactionSummary,
  getTrending,
  listSaved,
  recordView,
  removeReaction,
  saveArticle,
  setReaction,
  unsaveArticle,
} from './engagement';
import { getFeed } from './feed';
import { listTopics } from './topics';

let db: Db;
let close: () => Promise<void>;
let sourceA: string;
let sourceB: string;
const hoursAgo = (h: number) => new Date(Date.now() - h * 3_600_000);

beforeAll(async () => {
  ({ db, close } = await createTestDb());
  await seedTopics(db);
  sourceA = (await createSource(db, { name: 'Source A' })).id;
  sourceB = (await createSource(db, { name: 'Source B' })).id;
});
afterAll(async () => close());

describe('getFeed', () => {
  let fresh: string,
    older: string,
    urgent: string,
    expired: string,
    unapproved: string,
    bgOnly: string,
    draft: string;

  beforeAll(async () => {
    fresh = (
      await createPublishedArticle(db, {
        sourceId: sourceA,
        publishedAt: hoursAgo(1),
        topicSlugs: ['tech'],
      })
    ).id;
    older = (
      await createPublishedArticle(db, {
        sourceId: sourceB,
        publishedAt: hoursAgo(5),
        topicSlugs: ['sport'],
      })
    ).id;
    urgent = (
      await createPublishedArticle(db, {
        sourceId: sourceA,
        publishedAt: hoursAgo(10),
        isUrgent: true,
        urgentApprovedAt: hoursAgo(1),
        urgentExpiresAt: new Date(Date.now() + 3_600_000),
      })
    ).id;
    expired = (
      await createPublishedArticle(db, {
        sourceId: sourceA,
        publishedAt: hoursAgo(20),
        isUrgent: true,
        urgentApprovedAt: hoursAgo(9),
        urgentExpiresAt: hoursAgo(3),
      })
    ).id;
    unapproved = (
      await createPublishedArticle(db, {
        sourceId: sourceA,
        publishedAt: hoursAgo(30),
        isUrgent: true,
      })
    ).id;
    bgOnly = (
      await createPublishedArticle(db, {
        sourceId: sourceA,
        publishedAt: hoursAgo(2),
        texts: { bg: { title: 'Само на български' } },
      })
    ).id;
    draft = (await createPublishedArticle(db, { sourceId: sourceA, status: 'needs_review' })).id;
  });

  it('puts approved, unexpired urgent stories first, then newest', async () => {
    const feed = await getFeed(db, { locale: 'bg' });
    expect(feedResponseSchema.parse(feed)).toBeTruthy();
    const ids = feed.items.map((i) => i.id);
    expect(ids.slice(0, 4)).toEqual([urgent, fresh, bgOnly, older]);
    expect(ids.indexOf(expired)).toBeLessThan(ids.indexOf(unapproved)); // plain recency for both
    expect(ids).not.toContain(draft);
    expect(feed.items[0]!.isUrgent).toBe(true);
    expect(feed.items.find((i) => i.id === unapproved)!.isUrgent).toBe(false);
  });

  it('only lists articles available in the requested language', async () => {
    const en = await getFeed(db, { locale: 'en' });
    expect(en.items.map((i) => i.id)).not.toContain(bgOnly);
    expect(en.items[0]!.path).toMatch(/^\/en\/a\//);
  });

  it('filters by topic and source', async () => {
    expect((await getFeed(db, { locale: 'bg', topic: 'sport' })).items.map((i) => i.id)).toEqual([
      older,
    ]);
    expect((await getFeed(db, { locale: 'bg', sourceId: sourceB })).items.map((i) => i.id)).toEqual(
      [older],
    );
  });

  it("lifts the reader's topics and sources above equally fresh stories", async () => {
    const sportId = (await db.select().from(topics).where(eq(topics.slug, 'sport')))[0]!.id;
    const feed = await getFeed(db, {
      locale: 'bg',
      personalization: { topicIds: [sportId], sourceIds: [] },
    });
    expect(feed.personalized).toBe(true);
    // 5h-old sport story (boosted by 12h) now ranks above the 1h-old tech story; urgent stays first.
    expect(feed.items.map((i) => i.id).slice(0, 3)).toEqual([urgent, older, fresh]);
    const bySource = await getFeed(db, {
      locale: 'bg',
      personalization: { topicIds: [], sourceIds: [sourceB] },
    });
    expect(bySource.items[1]!.id).toBe(older);
  });

  it('paginates', async () => {
    const first = await getFeed(db, { locale: 'bg', perPage: 2 });
    const second = await getFeed(db, { locale: 'bg', perPage: 2, page: 2 });
    expect(first.hasMore).toBe(true);
    expect(second.items[0]!.id).not.toBe(first.items[0]!.id);
  });
});

describe('getArticle', () => {
  it('returns the reading view with alternates, corrections and related stories', async () => {
    const main = await createPublishedArticle(db, { sourceId: sourceA, topicSlugs: ['culture'] });
    await createPublishedArticle(db, { sourceId: sourceB, topicSlugs: ['culture'] });
    await db.insert(articleCorrections).values([
      { articleId: main.id, locale: 'bg', note: 'Поправено име' },
      { articleId: main.id, locale: 'en', note: 'Fixed name' },
    ]);
    const detail = (await getArticle(db, main.id, 'bg'))!;
    expect(articleDetailSchema.parse(detail)).toBeTruthy();
    expect(detail.body).toHaveLength(2);
    expect(detail.alternates).toEqual([
      { locale: 'en', path: expect.stringMatching(/^\/en\/a\//) },
    ]);
    expect(detail.corrections.map((c) => c.note)).toEqual(['Поправено име']);
    expect(detail.related).toHaveLength(1);
    expect(detail.isAiRewritten).toBe(true);
    expect(detail.source.name).toBe('Source A');
  });

  it('hides unpublished articles', async () => {
    const hidden = await createPublishedArticle(db, { sourceId: sourceA, status: 'rejected' });
    expect(await getArticle(db, hidden.id, 'bg')).toBeNull();
  });
});

describe('engagement', () => {
  it('keeps one reaction per reader and counts them', async () => {
    const article = await createPublishedArticle(db, { sourceId: sourceA });
    await setReaction(db, article.id, 'a:1', 'like');
    await setReaction(db, article.id, 'a:2', 'like');
    await setReaction(db, article.id, 'a:1', 'insightful'); // change of mind
    let summary = await getReactionSummary(db, article.id, 'a:1');
    expect(summary.counts).toMatchObject({ like: 1, insightful: 1, sad: 0 });
    expect(summary.mine).toBe('insightful');
    await removeReaction(db, article.id, 'a:1');
    summary = await getReactionSummary(db, article.id, 'a:1');
    expect(summary).toMatchObject({ mine: null, counts: { insightful: 0, like: 1 } });
  });

  it('manages the reading list, newest first', async () => {
    const [user] = await db.insert(users).values({ email: 'reader@test.bg' }).returning();
    const a = await createPublishedArticle(db, { sourceId: sourceA });
    const b = await createPublishedArticle(db, { sourceId: sourceA });
    await saveArticle(db, user!.id, a.id);
    await new Promise((r) => setTimeout(r, 5));
    await saveArticle(db, user!.id, b.id);
    await saveArticle(db, user!.id, b.id); // idempotent
    expect((await listSaved(db, user!.id, 'bg')).map((c) => c.id)).toEqual([b.id, a.id]);
    await unsaveArticle(db, user!.id, a.id);
    expect((await listSaved(db, user!.id, 'en')).map((c) => c.id)).toEqual([b.id]);
  });

  it('ranks trending stories by recent, decayed views', async () => {
    const hot = await createPublishedArticle(db, { sourceId: sourceA });
    const warm = await createPublishedArticle(db, { sourceId: sourceA });
    const stale = await createPublishedArticle(db, { sourceId: sourceA });
    for (let i = 0; i < 5; i += 1) await recordView(db, hot.id);
    await recordView(db, warm.id);
    await db
      .insert(articleViewBuckets)
      .values({ articleId: stale.id, bucket: hoursAgo(60), views: 500 });
    const trending = await getTrending(db, 'bg');
    expect(trending.map((c) => c.id).slice(0, 2)).toEqual([hot.id, warm.id]);
    expect(trending.map((c) => c.id)).not.toContain(stale.id);
    expect(articleCardSchema.parse(trending[0])).toBeTruthy();
  });
});

describe('pickAd', () => {
  it('prefers direct-sold creatives in their window and locale, weighted', async () => {
    const base = {
      placement: 'feed_inline' as const,
      imageUrl: '/media/ad.webp',
      targetUrl: 'https://advertiser.bg',
      altText: 'Ad',
      width: 728,
      height: 90,
    };
    await db.insert(adSlots).values([
      { ...base, name: 'house', kind: 'house' },
      { ...base, name: 'en-only', kind: 'direct', locale: 'en' },
      { ...base, name: 'future', kind: 'direct', startsAt: new Date(Date.now() + 86_400_000) },
      { ...base, name: 'bg-a', kind: 'direct', locale: 'bg', weight: 1 },
      { ...base, name: 'bg-b', kind: 'direct', weight: 3 },
    ]);
    const names = async (random: number) => {
      const ad = await pickAd(db, 'feed_inline', 'bg', { random: () => random });
      return (await db.select().from(adSlots).where(eq(adSlots.id, ad!.id)))[0]!.name;
    };
    expect(await names(0.1)).toBe('bg-a');
    expect(await names(0.9)).toBe('bg-b');
    expect(await pickAd(db, 'home_top', 'bg')).toBeNull();
    await db.update(adSlots).set({ isActive: false }).where(eq(adSlots.kind, 'direct'));
    expect((await pickAd(db, 'feed_inline', 'bg'))!.kind).toBe('house');
  });
});

describe('listTopics', () => {
  it('returns active topics in order with localized names', async () => {
    const bg = await listTopics(db, 'bg');
    expect(bg[0]).toMatchObject({ slug: 'general', name: 'Общи новини' });
    expect((await listTopics(db, 'en')).map((t) => t.name)).toContain('Politics');
  });
});
