import { and, count, desc, eq, gt, inArray, sql } from 'drizzle-orm';
import type { Db } from '@nm/db';
import {
  articleReactions,
  articles,
  articleViewBuckets,
  userSavedArticles,
  articleLocalizations,
  type Locale,
} from '@nm/db/schema';
import { loadCards } from './cards';
import { reactionKinds, type ArticleCard, type Reaction, type ReactionSummary } from './contracts';

// Reactions -------------------------------------------------------------------

export async function setReaction(
  db: Db,
  articleId: string,
  actorKey: string,
  reaction: Reaction,
): Promise<void> {
  await db
    .insert(articleReactions)
    .values({ articleId, actorKey, reaction })
    .onConflictDoUpdate({
      target: [articleReactions.articleId, articleReactions.actorKey],
      set: { reaction, createdAt: new Date() },
    });
}

export async function removeReaction(db: Db, articleId: string, actorKey: string): Promise<void> {
  await db
    .delete(articleReactions)
    .where(and(eq(articleReactions.articleId, articleId), eq(articleReactions.actorKey, actorKey)));
}

export async function getReactionSummary(
  db: Db,
  articleId: string,
  actorKey?: string | null,
): Promise<ReactionSummary> {
  const rows = await db
    .select({ reaction: articleReactions.reaction, n: count() })
    .from(articleReactions)
    .where(eq(articleReactions.articleId, articleId))
    .groupBy(articleReactions.reaction);
  const counts = Object.fromEntries(reactionKinds.map((k) => [k, 0])) as Record<Reaction, number>;
  for (const row of rows)
    if ((reactionKinds as readonly string[]).includes(row.reaction))
      counts[row.reaction as Reaction] = row.n;
  let mine: Reaction | null = null;
  if (actorKey) {
    const [own] = await db
      .select({ reaction: articleReactions.reaction })
      .from(articleReactions)
      .where(
        and(eq(articleReactions.articleId, articleId), eq(articleReactions.actorKey, actorKey)),
      );
    mine = (own?.reaction as Reaction | undefined) ?? null;
  }
  return { counts, mine };
}

// Reading list ------------------------------------------------------------------

export async function isPublished(db: Db, articleId: string): Promise<boolean> {
  const [row] = await db
    .select({ id: articles.id })
    .from(articles)
    .where(and(eq(articles.id, articleId), eq(articles.status, 'published')));
  return !!row;
}

export async function saveArticle(db: Db, userId: string, articleId: string): Promise<void> {
  await db.insert(userSavedArticles).values({ userId, articleId }).onConflictDoNothing();
}

export async function unsaveArticle(db: Db, userId: string, articleId: string): Promise<void> {
  await db
    .delete(userSavedArticles)
    .where(and(eq(userSavedArticles.userId, userId), eq(userSavedArticles.articleId, articleId)));
}

export async function listSaved(
  db: Db,
  userId: string,
  locale: Locale,
  limit = 100,
): Promise<ArticleCard[]> {
  const rows = await db
    .select({ id: userSavedArticles.articleId })
    .from(userSavedArticles)
    .where(eq(userSavedArticles.userId, userId))
    .orderBy(desc(userSavedArticles.createdAt))
    .limit(limit);
  return loadCards(
    db,
    rows.map((r) => r.id),
    locale,
  );
}

export async function savedIds(db: Db, userId: string, articleIds: string[]): Promise<Set<string>> {
  if (articleIds.length === 0) return new Set();
  const rows = await db
    .select({ id: userSavedArticles.articleId })
    .from(userSavedArticles)
    .where(
      and(eq(userSavedArticles.userId, userId), inArray(userSavedArticles.articleId, articleIds)),
    );
  return new Set(rows.map((r) => r.id));
}

// Views & trending --------------------------------------------------------------

export async function recordView(db: Db, articleId: string): Promise<void> {
  await db
    .insert(articleViewBuckets)
    .values({ articleId, bucket: sql`date_trunc('hour', now())`, views: 1 })
    .onConflictDoUpdate({
      target: [articleViewBuckets.articleId, articleViewBuckets.bucket],
      set: { views: sql`${articleViewBuckets.views} + 1` },
    });
}

/** Most-read stories of the last 48 h; a view loses half its weight every 6 hours. */
export async function getTrending(db: Db, locale: Locale, limit = 8): Promise<ArticleCard[]> {
  const score = sql<number>`sum(${articleViewBuckets.views} * power(0.5, extract(epoch from (now() - ${articleViewBuckets.bucket})) / 21600.0))`;
  const rows = await db
    .select({ id: articleViewBuckets.articleId, score })
    .from(articleViewBuckets)
    .innerJoin(articles, eq(articles.id, articleViewBuckets.articleId))
    .innerJoin(
      articleLocalizations,
      and(eq(articleLocalizations.articleId, articles.id), eq(articleLocalizations.locale, locale)),
    )
    .where(
      and(
        eq(articles.status, 'published'),
        gt(articleViewBuckets.bucket, sql`now() - interval '48 hours'`),
      ),
    )
    .groupBy(articleViewBuckets.articleId)
    .orderBy(desc(score))
    .limit(limit);
  return loadCards(
    db,
    rows.map((r) => r.id),
    locale,
  );
}
