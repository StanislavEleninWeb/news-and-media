import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Db } from '@nm/db';
import { engagementEvents, topics } from '@nm/db/schema';
import { seedTopics } from '@nm/db/seed';
import { createTestDb } from '@nm/db/testing';
import { createPublishedArticle, createSource } from '../testing/content';
import {
  forgetEngagement,
  getBehaviorProfile,
  pruneEngagement,
  recordEngagement,
} from './behavior';
import { getFeed } from './feed';

let db: Db;
let close: () => Promise<void>;
let sportSource: string;
let newsSource: string;
let topicIds: Record<string, string>;
const hoursAgo = (h: number) => new Date(Date.now() - h * 3_600_000);
const actor = { actorKey: 'a:3f1c2a4e-9b7d-4c1e-8a2f-0b6d5e4c3a21' };

beforeAll(async () => {
  ({ db, close } = await createTestDb());
  await seedTopics(db);
  topicIds = Object.fromEntries((await db.select().from(topics)).map((t) => [t.slug, t.id]));
  sportSource = (await createSource(db, { name: 'Sport Daily' })).id;
  newsSource = (await createSource(db, { name: 'General News' })).id;
});
afterAll(async () => close());

describe('behavioural feed ranking', () => {
  let politicsNew: string, sportOlder: string, sportRead: string, sportOld: string;

  beforeAll(async () => {
    politicsNew = (
      await createPublishedArticle(db, {
        sourceId: newsSource,
        topicSlugs: ['politics'],
        publishedAt: hoursAgo(1),
      })
    ).id;
    sportOlder = (
      await createPublishedArticle(db, {
        sourceId: sportSource,
        topicSlugs: ['sport'],
        publishedAt: hoursAgo(4),
      })
    ).id;
    sportRead = (
      await createPublishedArticle(db, {
        sourceId: sportSource,
        topicSlugs: ['sport'],
        publishedAt: hoursAgo(30),
      })
    ).id;
    // A week old: no amount of interest lifts it above today's news.
    sportOld = (
      await createPublishedArticle(db, {
        sourceId: sportSource,
        topicSlugs: ['sport'],
        publishedAt: hoursAgo(24 * 7),
      })
    ).id;
  });

  const order = async (behavior?: Awaited<ReturnType<typeof getBehaviorProfile>>) =>
    (await getFeed(db, { locale: 'bg', perPage: 10, behavior })).items.map((i) => i.id);

  it('shifts the order after simulated engagement', async () => {
    const before = await order();
    expect(before.indexOf(politicsNew)).toBeLessThan(before.indexOf(sportOlder));

    // The reader opens sport stories, reads one for two minutes and saves it.
    expect(
      await recordEngagement(db, actor, [
        { articleId: sportRead, kind: 'click' },
        { articleId: sportRead, kind: 'dwell', dwellMs: 120_000 },
        { articleId: sportRead, kind: 'save' },
        { articleId: sportOld, kind: 'click' },
      ]),
    ).toBe(4);
    const profile = await getBehaviorProfile(db, actor.actorKey);
    expect(profile.topics[topicIds.sport!]).toBe(1);
    expect(profile.sources[sportSource]).toBe(1);
    expect(profile.seen).toEqual(expect.arrayContaining([sportRead, sportOld]));

    const after = await order(profile);
    // Unread sport story (4 h old) now ranks above the 1 h old politics story…
    expect(after.indexOf(sportOlder)).toBeLessThan(after.indexOf(politicsNew));
    // …the week-old one stays below today's news, and already-read stories sink.
    expect(after.indexOf(sportOld)).toBeGreaterThan(after.indexOf(politicsNew));
    expect(after.indexOf(sportRead)).toBeGreaterThan(after.indexOf(politicsNew));

    const feed = await getFeed(db, { locale: 'bg', behavior: profile });
    expect(feed.personalized).toBe(true);
  });

  it('weights recent signals more than old ones', async () => {
    const key = 'u:decay-test';
    await recordEngagement(db, { actorKey: key }, [{ articleId: politicsNew, kind: 'save' }]);
    await recordEngagement(db, { actorKey: key }, [{ articleId: sportOlder, kind: 'save' }]);
    // Make the politics save 60 days old.
    await db.execute(
      `update engagement_events set created_at = now() - interval '59 days' where actor_key = '${key}' and article_id = '${politicsNew}'`,
    );
    const profile = await getBehaviorProfile(db, key);
    expect(profile.topics[topicIds.sport!]).toBe(1);
    expect(profile.topics[topicIds.politics!]).toBeLessThan(0.1);
  });

  it('ignores unknown or unpublished articles and caps dwell time', async () => {
    const draft = await createPublishedArticle(db, {
      sourceId: newsSource,
      status: 'needs_review',
    });
    const stored = await recordEngagement(db, { actorKey: 'a:cap' }, [
      { articleId: draft.id, kind: 'click' },
      { articleId: '00000000-0000-4000-8000-000000000000', kind: 'click' },
      { articleId: politicsNew, kind: 'dwell', dwellMs: 99_999_999 },
    ]);
    expect(stored).toBe(1);
    const rows = await db.select().from(engagementEvents);
    expect(rows.find((r) => r.actorKey === 'a:cap')!.dwellMs).toBe(600_000);
  });

  it('forgets on request and prunes old events', async () => {
    await forgetEngagement(db, actor.actorKey);
    expect(await getBehaviorProfile(db, actor.actorKey)).toEqual({
      topics: {},
      sources: {},
      seen: [],
    });
    await db.execute(`update engagement_events set created_at = now() - interval '100 days'`);
    expect(await pruneEngagement(db, 90)).toBeGreaterThan(0);
    expect(await db.select().from(engagementEvents)).toHaveLength(0);
  });
});
