import { and, asc, eq, inArray } from 'drizzle-orm';
import type { Db } from '@nm/db';
import { sources, topics, userSourceFollows, userTopicPreferences } from '@nm/db/schema';
import type { FeedPersonalization } from '../content/feed';

export interface ReaderPreferences {
  topics: string[];
  sourceIds: string[];
}

export async function getPreferences(
  db: Db,
  userId: string,
): Promise<ReaderPreferences & FeedPersonalization> {
  const [topicRows, sourceRows] = await Promise.all([
    db
      .select({ id: topics.id, slug: topics.slug })
      .from(userTopicPreferences)
      .innerJoin(topics, eq(topics.id, userTopicPreferences.topicId))
      .where(and(eq(userTopicPreferences.userId, userId), eq(topics.isActive, true)))
      .orderBy(asc(topics.sortOrder)),
    db
      .select({ id: userSourceFollows.sourceId })
      .from(userSourceFollows)
      .where(eq(userSourceFollows.userId, userId)),
  ]);
  return {
    topics: topicRows.map((t) => t.slug),
    topicIds: topicRows.map((t) => t.id),
    sourceIds: sourceRows.map((s) => s.id),
  };
}

/** Replaces the reader's followed topics (by slug) and sources (by id); unknown values are ignored. */
export async function setPreferences(
  db: Db,
  userId: string,
  input: { topics?: string[]; sourceIds?: string[] },
): Promise<void> {
  await db.transaction(async (tx) => {
    if (input.topics) {
      await tx.delete(userTopicPreferences).where(eq(userTopicPreferences.userId, userId));
      const rows = input.topics.length
        ? await tx
            .select({ id: topics.id })
            .from(topics)
            .where(and(inArray(topics.slug, input.topics), eq(topics.isActive, true)))
        : [];
      if (rows.length)
        await tx.insert(userTopicPreferences).values(rows.map((t) => ({ userId, topicId: t.id })));
    }
    if (input.sourceIds) {
      await tx.delete(userSourceFollows).where(eq(userSourceFollows.userId, userId));
      const rows = input.sourceIds.length
        ? await tx
            .select({ id: sources.id })
            .from(sources)
            .where(and(inArray(sources.id, input.sourceIds), eq(sources.isActive, true)))
        : [];
      if (rows.length)
        await tx.insert(userSourceFollows).values(rows.map((s) => ({ userId, sourceId: s.id })));
    }
  });
}

/** Sources readers can follow (active ones). */
export async function listFollowableSources(db: Db) {
  return db
    .select({
      id: sources.id,
      name: sources.name,
      language: sources.language,
      homepageUrl: sources.homepageUrl,
    })
    .from(sources)
    .where(eq(sources.isActive, true))
    .orderBy(asc(sources.name));
}
