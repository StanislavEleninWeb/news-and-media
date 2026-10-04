import { and, eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Db } from '@nm/db';
import { articleLocalizations, articles } from '@nm/db/schema';
import { seedTopics } from '@nm/db/seed';
import { createTestDb } from '@nm/db/testing';
import { createPublishedArticle, createSource } from '../testing/content';
import type { ArticleDocument } from './documents';
import { PostgresSearch, type SearchIndex } from './search';
import { rebuildSearchIndex, syncSearchIndex } from './sync';

class MemoryIndex implements SearchIndex {
  docs = new Map<string, ArticleDocument>();
  resets = 0;
  async ensure() {}
  async reset() {
    this.resets += 1;
    this.docs.clear();
  }
  async upsert(documents: ArticleDocument[]) {
    for (const d of documents) this.docs.set(d.id, d);
  }
  async removeArticles(ids: string[]) {
    for (const [key, d] of this.docs) if (ids.includes(d.article_id)) this.docs.delete(key);
  }
}

let db: Db;
let close: () => Promise<void>;
let sourceId: string;
beforeAll(async () => {
  ({ db, close } = await createTestDb());
  await seedTopics(db);
  sourceId = (await createSource(db, { name: 'Дневник' })).id;
});
afterAll(async () => close());

describe('syncSearchIndex', () => {
  const index = new MemoryIndex();

  it('indexes every locale of published articles only', async () => {
    const published = await createPublishedArticle(db, { sourceId, topicSlugs: ['tech'] });
    await createPublishedArticle(db, { sourceId, status: 'ingested' });
    await createPublishedArticle(db, { sourceId, status: 'needs_review' });

    expect(await syncSearchIndex(db, index)).toEqual({ indexed: 1, removed: 0 });
    expect([...index.docs.keys()].sort()).toEqual([`${published.id}_bg`, `${published.id}_en`]);
    const doc = index.docs.get(`${published.id}_bg`)!;
    expect(doc).toMatchObject({
      locale: 'bg',
      topics: ['tech'],
      source: 'Дневник',
      is_urgent: false,
    });
    expect(doc.published_at).toBe(Math.floor(published.publishedAt!.getTime() / 1000));
  });

  it('is idempotent', async () => {
    expect(await syncSearchIndex(db, index)).toEqual({ indexed: 0, removed: 0 });
  });

  it('re-indexes edited articles and removes hidden ones', async () => {
    const [first] = await db.select().from(articles).where(eq(articles.status, 'published'));
    await db
      .update(articleLocalizations)
      .set({ title: 'Коригирано заглавие' })
      .where(
        and(eq(articleLocalizations.articleId, first!.id), eq(articleLocalizations.locale, 'bg')),
      );
    // Editors' changes touch the article so the sync notices them.
    await db
      .update(articles)
      .set({ updatedAt: sql`now() + interval '1 second'` })
      .where(eq(articles.id, first!.id));
    expect(await syncSearchIndex(db, index)).toEqual({ indexed: 1, removed: 0 });
    expect(index.docs.get(`${first!.id}_bg`)!.title).toBe('Коригирано заглавие');

    await db
      .update(articles)
      .set({ status: 'rejected', updatedAt: sql`now() + interval '2 seconds'` })
      .where(eq(articles.id, first!.id));
    expect(await syncSearchIndex(db, index)).toEqual({ indexed: 0, removed: 1 });
    expect(index.docs.size).toBe(0);
  });

  it('rebuilds the whole collection from the database', async () => {
    await createPublishedArticle(db, { sourceId });
    await createPublishedArticle(db, { sourceId });
    const result = await rebuildSearchIndex(db, index);
    expect(index.resets).toBe(1);
    expect(result.indexed).toBe(2);
    expect(index.docs.size).toBe(4);
  });
});

describe('PostgresSearch (development fallback)', () => {
  it('finds Cyrillic text case-insensitively, per locale and topic', async () => {
    await createPublishedArticle(db, {
      sourceId,
      texts: {
        bg: { title: 'Енергийната стратегия до 2050 г.' },
        en: { title: 'Energy strategy to 2050' },
      },
      topicSlugs: ['business'],
    });
    const search = new PostgresSearch(db);
    const bg = await search.search({ q: 'енергийната', locale: 'bg' });
    expect(bg.found).toBe(1);
    expect(bg.hits[0]).toMatchObject({
      title: 'Енергийната стратегия до 2050 г.',
      topics: ['business'],
      source: 'Дневник',
    });
    expect((await search.search({ q: 'енергийната', locale: 'en' })).found).toBe(0);
    expect((await search.search({ q: 'strategy', locale: 'en', topic: 'business' })).found).toBe(1);
    expect((await search.search({ q: 'strategy', locale: 'en', topic: 'sport' })).found).toBe(0);
  });

  it('treats SQL wildcards in the query literally and paginates', async () => {
    const search = new PostgresSearch(db);
    expect((await search.search({ q: '%', locale: 'bg' })).found).toBe(0);
    const page = await search.search({ q: '', locale: 'en', perPage: 2, page: 2 });
    expect(page.hits.length).toBeLessThanOrEqual(2);
    expect(page.page).toBe(2);
  });
});
