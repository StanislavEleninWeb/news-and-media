import { count, eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Db } from './client';
import { articleLocalizations, articles, articleTopics, sources, topics, users } from './schema';
import { defaultTopics, seedDevelopment, seedTopics } from './seed';
import { createTestDb } from './testing';

let db: Db;
let close: () => Promise<void>;

beforeAll(async () => {
  ({ db, close } = await createTestDb());
});
afterAll(async () => close());

describe('migrations', () => {
  it('create every table', async () => {
    const result = await db.execute(
      sql`select table_name from information_schema.tables where table_schema = 'public'`,
    );
    // postgres.js returns an array of rows, PGlite an object with `rows`.
    const rows = (Array.isArray(result) ? result : (result as { rows: unknown[] }).rows) as {
      table_name: string;
    }[];
    const names = rows.map((r) => r.table_name);
    for (const table of [
      'sources',
      'topics',
      'articles',
      'article_localizations',
      'article_corrections',
      'users',
      'sessions',
      'jobs',
      'ad_slots',
      'llm_usage',
    ]) {
      expect(names).toContain(table);
    }
  });
});

describe('seed', () => {
  it('inserts the default topics idempotently', async () => {
    await seedTopics(db);
    await seedTopics(db);
    const [row] = await db.select({ n: count() }).from(topics);
    expect(row?.n).toBe(defaultTopics.length);
    const slugs = (await db.select({ slug: topics.slug }).from(topics)).map((t) => t.slug);
    expect(slugs).toEqual(expect.arrayContaining(['politics', 'tech', 'sport']));
  });

  it('refuses to load development data outside development', async () => {
    await expect(seedDevelopment(db, 'production')).rejects.toThrow(/Refusing/);
    await expect(seedDevelopment(db, 'staging')).rejects.toThrow(/Refusing/);
  });

  it('loads sources and bilingual sample articles in development', async () => {
    await seedDevelopment(db, 'development');
    await seedDevelopment(db, 'development'); // idempotent
    const [sourceCount] = await db.select({ n: count() }).from(sources);
    expect(sourceCount?.n).toBeGreaterThanOrEqual(4);
    const published = await db.select().from(articles).where(eq(articles.status, 'published'));
    expect(published).toHaveLength(2);
    const localizations = await db.select().from(articleLocalizations);
    expect(new Set(localizations.map((l) => l.locale))).toEqual(new Set(['bg', 'en']));
    const tagged = await db.select().from(articleTopics);
    expect(tagged.length).toBe(2);
  });
});

describe('constraints', () => {
  it('keeps source URLs unique', async () => {
    const [source] = await db.select().from(sources).limit(1);
    await expect(db.insert(sources).values({ name: 'dup', url: source!.url })).rejects.toThrow();
  });

  it('treats e-mail addresses case-insensitively', async () => {
    await db.insert(users).values({ email: 'Reader@Example.com' });
    await expect(db.insert(users).values({ email: 'reader@example.com' })).rejects.toThrow();
  });

  it('deletes localizations with their article', async () => {
    const [article] = await db.select().from(articles).limit(1);
    await db.delete(articles).where(eq(articles.id, article!.id));
    const left = await db
      .select()
      .from(articleLocalizations)
      .where(eq(articleLocalizations.articleId, article!.id));
    expect(left).toHaveLength(0);
  });

  it('prevents deleting a source that still has articles', async () => {
    const [article] = await db.select().from(articles).limit(1);
    await expect(db.delete(sources).where(eq(sources.id, article!.sourceId))).rejects.toThrow();
  });
});
