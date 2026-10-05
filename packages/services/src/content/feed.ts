import { and, desc, eq, exists, inArray, sql, type SQL } from 'drizzle-orm';
import type { Db } from '@nm/db';
import { articleLocalizations, articles, articleTopics, topics, type Locale } from '@nm/db/schema';
import { loadCards } from './cards';
import { isEmptyProfile, type BehaviorProfile } from './behavior';
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
  /** Reading-behaviour profile (only for readers who consented). */
  behavior?: BehaviorProfile | null;
  now?: Date;
}

/** How far ahead (in recency) a story matching the reader's topics/sources is ranked. */
export const PREFERENCE_BOOST_HOURS = 12;
/** Maximum lift from reading behaviour: strongest topic / strongest source. */
export const BEHAVIOR_TOPIC_BOOST_HOURS = 8;
export const BEHAVIOR_SOURCE_BOOST_HOURS = 4;
/** Stories the reader already opened recently sink by this much. */
export const SEEN_PENALTY_HOURS = 6;

/**
 * The home/topic feed: approved urgent stories first, then newest first —
 * with stories from the reader's followed topics and sources lifted by
 * PREFERENCE_BOOST_HOURS so they rank above equally fresh ones, and (with
 * consent) a smaller, graded lift from what they actually read: up to
 * BEHAVIOR_TOPIC_BOOST_HOURS for their most-read topic, BEHAVIOR_SOURCE_BOOST_HOURS
 * for their most-read source, minus SEEN_PENALTY_HOURS for stories already opened.
 * Every boost is bounded, so fresh news always wins over old favourites.
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

  const behavior = query.behavior;
  const behavioral = !isEmptyProfile(behavior);
  if (behavior && behavioral) {
    const parts: SQL[] = [];
    const topicEntries = Object.entries(behavior.topics);
    if (topicEntries.length) {
      const weights = sql.join(
        topicEntries.map(([id, w]) => sql`(${id}::uuid, ${w}::float8)`),
        sql`, `,
      );
      parts.push(
        sql`${BEHAVIOR_TOPIC_BOOST_HOURS}::float8 * coalesce((select max(w.weight) from ${articleTopics} join (values ${weights}) as w(topic_id, weight) on w.topic_id = ${articleTopics.topicId} where ${articleTopics.articleId} = ${articles.id}), 0)`,
      );
    }
    const sourceEntries = Object.entries(behavior.sources);
    if (sourceEntries.length) {
      const cases = sql.join(
        sourceEntries.map(([id, w]) => sql`when ${id}::uuid then ${w}::float8`),
        sql` `,
      );
      parts.push(
        sql`${BEHAVIOR_SOURCE_BOOST_HOURS}::float8 * (case ${articles.sourceId} ${cases} else 0 end)`,
      );
    }
    if (behavior.seen.length) {
      const seen = sql.join(
        behavior.seen.map((id) => sql`${id}::uuid`),
        sql`, `,
      );
      parts.push(
        sql`(case when ${articles.id} in (${seen}) then -${SEEN_PENALTY_HOURS}::float8 else 0 end)`,
      );
    }
    if (parts.length)
      rankTime = sql`${rankTime} + interval '1 hour' * (${sql.join(parts, sql` + `)})`;
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
    personalized: personalized || behavioral,
  };
}
