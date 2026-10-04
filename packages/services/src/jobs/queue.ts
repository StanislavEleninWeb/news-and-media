import { and, asc, eq, inArray, lte, sql } from 'drizzle-orm';
import type { Db } from '@nm/db';
import { jobs } from '@nm/db/schema';
import { errorMessage } from '../util';

export type JobKind = 'ingest_sources' | 'process_articles' | 'reindex' | 'urgent_push' | 'digest';
export type Job = typeof jobs.$inferSelect;

/**
 * Durable job queue in PostgreSQL. Producers (admin actions, schedules) insert
 * rows; the worker claims them with FOR UPDATE SKIP LOCKED, so several workers
 * could run safely and a crash never loses a job (it is retried after 10 min).
 */
export async function enqueueJob(
  db: Db,
  kind: JobKind,
  payload: Record<string, unknown> = {},
  options: { dedupeKey?: string; runAfter?: Date; maxAttempts?: number } = {},
): Promise<number | null> {
  const [row] = await db
    .insert(jobs)
    .values({
      kind,
      payload,
      dedupeKey: options.dedupeKey ?? null,
      runAfter: options.runAfter ?? new Date(),
      maxAttempts: options.maxAttempts ?? 5,
    })
    .onConflictDoNothing({ target: jobs.dedupeKey })
    .returning({ id: jobs.id });
  return row?.id ?? null;
}

export async function claimJobs(db: Db, limit = 5, now = new Date()): Promise<Job[]> {
  const staleLock = new Date(now.getTime() - 10 * 60_000);
  return db.transaction(async (tx) => {
    const ids = tx
      .select({ id: jobs.id })
      .from(jobs)
      .where(
        sql`(${jobs.status} = 'pending' and ${jobs.runAfter} <= ${now.toISOString()}::timestamptz) or (${jobs.status} = 'running' and ${jobs.lockedAt} < ${staleLock.toISOString()}::timestamptz)`,
      )
      .orderBy(asc(jobs.runAfter), asc(jobs.id))
      .limit(limit)
      .for('update', { skipLocked: true });
    return tx
      .update(jobs)
      .set({ status: 'running', lockedAt: now, attempts: sql`${jobs.attempts} + 1` })
      .where(inArray(jobs.id, ids))
      .returning();
  });
}

export async function completeJob(db: Db, id: number): Promise<void> {
  await db
    .update(jobs)
    .set({ status: 'done', finishedAt: new Date(), lastError: null })
    .where(eq(jobs.id, id));
}

/** Failed jobs are retried with exponential backoff until maxAttempts. */
export async function failJob(db: Db, job: Job, error: unknown, now = new Date()): Promise<void> {
  const finalFailure = job.attempts >= job.maxAttempts;
  await db
    .update(jobs)
    .set({
      status: finalFailure ? 'failed' : 'pending',
      lastError: errorMessage(error).slice(0, 2000),
      lockedAt: null,
      runAfter: new Date(now.getTime() + Math.min(2 ** job.attempts, 60) * 60_000),
      finishedAt: finalFailure ? now : null,
    })
    .where(eq(jobs.id, job.id));
}

export type JobHandlers = Partial<Record<JobKind, (job: Job) => Promise<void>>>;

/** Claims and runs due jobs; returns how many ran. */
export async function runDueJobs(
  db: Db,
  handlers: JobHandlers,
  options: { limit?: number; onError?: (job: Job, error: unknown) => void } = {},
): Promise<number> {
  const claimed = await claimJobs(db, options.limit ?? 5);
  for (const job of claimed) {
    const handler = handlers[job.kind as JobKind];
    try {
      if (!handler) throw new Error(`No handler for job kind "${job.kind}"`);
      await handler(job);
      await completeJob(db, job.id);
    } catch (error) {
      options.onError?.(job, error);
      await failJob(db, job, error);
    }
  }
  return claimed.length;
}

export async function pendingJobCount(db: Db): Promise<number> {
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(jobs)
    .where(and(eq(jobs.status, 'pending'), lte(jobs.runAfter, new Date())));
  return row?.n ?? 0;
}
