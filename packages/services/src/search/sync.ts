import { and, eq, gt, inArray, isNotNull, isNull, or, sql } from 'drizzle-orm';
import type { Db } from '@nm/db';
import { articles } from '@nm/db/schema';
import { buildDocuments } from './documents';
import type { SearchIndex } from './search';

/**
 * Brings the search index in line with the database. Picks up articles that
 * were published but never indexed, and indexed articles changed since
 * (edited, rejected, un-published). Safe to run as often as needed.
 */
export async function syncSearchIndex(
  db: Db,
  index: SearchIndex,
  options: { batchSize?: number; maxBatches?: number } = {},
): Promise<{ indexed: number; removed: number }> {
  const batchSize = options.batchSize ?? 200;
  const maxBatches = options.maxBatches ?? 50;
  await index.ensure();
  let indexed = 0;
  let removed = 0;

  for (let batch = 0; batch < maxBatches; batch += 1) {
    const changed = await db
      .select({ id: articles.id, status: articles.status })
      .from(articles)
      .where(
        or(
          and(isNull(articles.indexedAt), eq(articles.status, 'published')),
          and(isNotNull(articles.indexedAt), gt(articles.updatedAt, articles.indexedAt)),
        ),
      )
      .limit(batchSize);
    if (changed.length === 0) break;

    const publishedIds = changed.filter((a) => a.status === 'published').map((a) => a.id);
    const hiddenIds = changed.filter((a) => a.status !== 'published').map((a) => a.id);
    const documents = await buildDocuments(db, publishedIds);
    await index.upsert(documents);
    await index.removeArticles(hiddenIds);
    indexed += publishedIds.length;
    removed += hiddenIds.length;

    // Keep updated_at as it was, and never let indexed_at fall behind it (clock skew
    // between app and database), so the article does not immediately look "changed" again.
    await db
      .update(articles)
      .set({
        indexedAt: sql`greatest(now(), ${articles.updatedAt})`,
        updatedAt: sql`${articles.updatedAt}`,
      })
      .where(
        inArray(
          articles.id,
          changed.map((a) => a.id),
        ),
      );
  }
  return { indexed, removed };
}

/** Drops and rebuilds the whole collection from PostgreSQL (e.g. a fresh environment). */
export async function rebuildSearchIndex(db: Db, index: SearchIndex): Promise<{ indexed: number }> {
  await index.reset();
  await db.update(articles).set({ indexedAt: null, updatedAt: sql`${articles.updatedAt}` });
  const { indexed } = await syncSearchIndex(db, index, { maxBatches: 10_000 });
  return { indexed };
}
