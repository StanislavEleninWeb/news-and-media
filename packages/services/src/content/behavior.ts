import { and, desc, eq, gte, lt, sql } from 'drizzle-orm';
import type { Db } from '@nm/db';
import { articles, articleTopics, engagementEvents, type EngagementKind } from '@nm/db/schema';

/**
 * Behavioural personalisation: what a reader opens, how long they read, and
 * what they react to or save becomes a small topic/source affinity profile
 * that nudges the feed ranking (see getFeed). Recorded only with consent.
 */

export interface EngagementInput {
  articleId: string;
  kind: EngagementKind;
  dwellMs?: number;
}

/** Reading time beyond this adds nothing (and protects against tabs left open). */
export const MAX_DWELL_MS = 10 * 60_000;
/** Signal weights. Dwell earns up to 3 points (one per 30 s of reading). */
export const SIGNAL_WEIGHTS: Record<Exclude<EngagementKind, 'dwell'>, number> = {
  click: 1,
  reaction: 3,
  share: 3,
  save: 4,
};
/** Older signals count less: weight halves every HALF_LIFE_DAYS. */
export const HALF_LIFE_DAYS = 14;
const PROFILE_WINDOW_DAYS = 60;

export async function recordEngagement(
  db: Db,
  actor: { actorKey: string; userId?: string | null },
  events: EngagementInput[],
): Promise<number> {
  if (!actor.actorKey || events.length === 0) return 0;
  const rows = events.map((event) => ({
    actorKey: actor.actorKey,
    userId: actor.userId ?? null,
    articleId: event.articleId,
    kind: event.kind,
    dwellMs:
      event.kind === 'dwell'
        ? Math.max(0, Math.min(MAX_DWELL_MS, Math.round(event.dwellMs ?? 0)))
        : null,
  }));
  // Only published articles; unknown ids are dropped silently.
  const published = new Set(
    (
      await db
        .select({ id: articles.id })
        .from(articles)
        .where(
          and(
            eq(articles.status, 'published'),
            sql`${articles.id} in (${sql.join(
              rows.map((r) => sql`${r.articleId}::uuid`),
              sql`, `,
            )})`,
          ),
        )
    ).map((r) => r.id),
  );
  const valid = rows.filter((r) => published.has(r.articleId));
  if (valid.length) await db.insert(engagementEvents).values(valid);
  return valid.length;
}

/** "Forget my reading history" — also used when consent is withdrawn. */
export async function forgetEngagement(db: Db, actorKey: string): Promise<void> {
  await db.delete(engagementEvents).where(eq(engagementEvents.actorKey, actorKey));
}

export async function pruneEngagement(db: Db, retentionDays: number, now = new Date()) {
  const cutoff = new Date(now.getTime() - retentionDays * 86_400_000);
  const deleted = await db
    .delete(engagementEvents)
    .where(lt(engagementEvents.createdAt, cutoff))
    .returning({ id: engagementEvents.id });
  return deleted.length;
}

export interface BehaviorProfile {
  /** topic id → affinity 0..1 (1 = the reader's strongest topic). */
  topics: Record<string, number>;
  /** source id → affinity 0..1. */
  sources: Record<string, number>;
  /** Articles opened in the last 3 days — gently pushed down so the feed stays fresh. */
  seen: string[];
}

export const emptyProfile = (): BehaviorProfile => ({ topics: {}, sources: {}, seen: [] });

export const isEmptyProfile = (p: BehaviorProfile | null | undefined) =>
  !p ||
  (Object.keys(p.topics).length === 0 &&
    Object.keys(p.sources).length === 0 &&
    p.seen.length === 0);

function signal(kind: EngagementKind, dwellMs: number | null): number {
  if (kind === 'dwell') return Math.min(3, (dwellMs ?? 0) / 30_000);
  return SIGNAL_WEIGHTS[kind];
}

function normalise(scores: Map<string, number>, keep: number): Record<string, number> {
  const top = [...scores.entries()].sort((a, b) => b[1] - a[1]).slice(0, keep);
  const max = top[0]?.[1] ?? 0;
  if (max <= 0) return {};
  return Object.fromEntries(
    top.map(([id, score]) => [id, Math.round((score / max) * 1000) / 1000]),
  );
}

export async function getBehaviorProfile(
  db: Db,
  actorKey: string,
  now = new Date(),
): Promise<BehaviorProfile> {
  if (!actorKey) return emptyProfile();
  const since = new Date(now.getTime() - PROFILE_WINDOW_DAYS * 86_400_000);
  const events = await db
    .select({
      articleId: engagementEvents.articleId,
      kind: engagementEvents.kind,
      dwellMs: engagementEvents.dwellMs,
      createdAt: engagementEvents.createdAt,
      sourceId: articles.sourceId,
    })
    .from(engagementEvents)
    .innerJoin(articles, eq(articles.id, engagementEvents.articleId))
    .where(and(eq(engagementEvents.actorKey, actorKey), gte(engagementEvents.createdAt, since)))
    .orderBy(desc(engagementEvents.createdAt))
    .limit(2_000);
  if (events.length === 0) return emptyProfile();

  const articleIds = [...new Set(events.map((e) => e.articleId))];
  const topicRows = await db
    .select({ articleId: articleTopics.articleId, topicId: articleTopics.topicId })
    .from(articleTopics)
    .where(
      sql`${articleTopics.articleId} in (${sql.join(
        articleIds.map((id) => sql`${id}::uuid`),
        sql`, `,
      )})`,
    );
  const topicsOf = new Map<string, string[]>();
  for (const row of topicRows)
    topicsOf.set(row.articleId, [...(topicsOf.get(row.articleId) ?? []), row.topicId]);

  const topicScores = new Map<string, number>();
  const sourceScores = new Map<string, number>();
  const seen = new Set<string>();
  const seenSince = now.getTime() - 3 * 86_400_000;
  for (const event of events) {
    const ageDays = Math.max(0, (now.getTime() - event.createdAt.getTime()) / 86_400_000);
    const weight = signal(event.kind, event.dwellMs) * 0.5 ** (ageDays / HALF_LIFE_DAYS);
    for (const topicId of topicsOf.get(event.articleId) ?? [])
      topicScores.set(topicId, (topicScores.get(topicId) ?? 0) + weight);
    sourceScores.set(event.sourceId, (sourceScores.get(event.sourceId) ?? 0) + weight);
    if (
      (event.kind === 'click' || event.kind === 'dwell') &&
      event.createdAt.getTime() >= seenSince
    )
      seen.add(event.articleId);
  }
  return {
    topics: normalise(topicScores, 20),
    sources: normalise(sourceScores, 50),
    seen: [...seen].slice(0, 200),
  };
}
