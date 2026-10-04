import { and, desc, eq, exists, inArray, sql, type SQL } from 'drizzle-orm';
import type { Db } from '@nm/db';
import { articleLocalizations, articles, articleTopics, topics, type Locale } from '@nm/db/schema';
import { loadCards } from './cards';
import type { FeedResponse } from './contracts';

export interface FeedPersonalization {
  topicIds: string[];
  sourceIds: string[];
}

export interface FeedQuery {
  locale: Locale;
  topic?: string;
  sourceId?: string;
  page?: number;
  perPage?: number;
  personalization?: FeedPersonalization | null;
  now?: Date;
}

/** How far ahead (in recency) a story matching the reader's topics/sources is ranked. */
export const PREFERENCE_BOOST_HOURS = 12;

/**
 * The home/topic feed: approved urgent stories first, then newest first —
 * with stories from the reader's followed topics and sources lifted by
 * PREFERENCE_BOOST_HOURS so they rank above equally fresh ones.
 */
export async function getFeed(db: Db, query: FeedQuery): Promise<FeedResponse> {
  const page = Math.max(1, Math.floor(query.page ?? 1));
  const perPage = Math.min(50, Math.max(1, Math.floor(query.perPage ?? 20)));
  const now = query.now ?? new Date();

  const conditions: SQL[] = [eq(articles.status, 'published')];
  if (query.sourceId) conditions.push(eq(articles.sourceId, query.sourceId));
  if (query.topic) {
    conditions.push(
      exists(
        db
          .select({ one: sql`1` })
          .from(articleTopics)
          .innerJoin(topics, eq(topics.id, articleTopics.topicId))
          .where(and(eq(articleTopics.articleId, articles.id), eq(topics.slug, query.topic))),
      ),
    );
  }

  // Dates inside raw sql`` must be passed as ISO strings with a cast: postgres.js cannot
  // serialise a bare Date parameter without column type information.
  const nowParam = sql`${now.toISOString()}::timestamptz`;
  const urgentActive = sql`(${articles.isUrgent} and ${articles.urgentApprovedAt} is not null and (${articles.urgentExpiresAt} is null or ${articles.urgentExpiresAt} > ${nowParam}))`;

  const prefs = query.personalization;
  const personalized = !!prefs && (prefs.topicIds.length > 0 || prefs.sourceIds.length > 0);
  let rankTime: SQL = sql`${articles.publishedAt}`;
  if (personalized) {
    const matches: SQL[] = [];
    if (prefs.topicIds.length) {
      matches.push(
        exists(
          db
            .select({ one: sql`1` })
            .from(articleTopics)
            .where(
              and(
                eq(articleTopics.articleId, articles.id),
                inArray(articleTopics.topicId, prefs.topicIds),
              ),
            ),
        ),
      );
    }
    if (prefs.sourceIds.length) matches.push(inArray(articles.sourceId, prefs.sourceIds));
    const preferred = sql.join(matches, sql` or `);
    rankTime = sql`${articles.publishedAt} + case when (${preferred}) then interval '${sql.raw(String(PREFERENCE_BOOST_HOURS))} hours' else interval '0 hours' end`;
  }

  const rows = await db
    .select({ id: articles.id })
    .from(articles)
    .innerJoin(
      articleLocalizations,
      and(
        eq(articleLocalizations.articleId, articles.id),
        eq(articleLocalizations.locale, query.locale),
      ),
    )
    .where(and(...conditions))
    .orderBy(desc(urgentActive), desc(rankTime), desc(articles.id))
    .limit(perPage + 1)
    .offset((page - 1) * perPage);

  const ids = rows.slice(0, perPage).map((r) => r.id);
  return {
    items: await loadCards(db, ids, query.locale, now),
    page,
    perPage,
    hasMore: rows.length > perPage,
    personalized,
  };
}
