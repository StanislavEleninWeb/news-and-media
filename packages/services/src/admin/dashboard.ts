import { count, desc, eq, sql } from 'drizzle-orm';
import { getConfig } from '@nm/core/config';
import type { Db } from '@nm/db';
import { articles, jobs, pipelineRuns, users, type UserRole } from '@nm/db/schema';
import { monthToDateSpend } from '../ai/budget';
import { pendingJobCount } from '../jobs/queue';
import { failingSourceCount } from './sources';

export async function getDashboard(db: Db) {
  const [statusCounts, recentRuns, spend, chatSpend, pendingJobs, failingSources] =
    await Promise.all([
      db.select({ status: articles.status, n: count() }).from(articles).groupBy(articles.status),
      db.select().from(pipelineRuns).orderBy(desc(pipelineRuns.startedAt)).limit(8),
      monthToDateSpend(db),
      monthToDateSpend(db, new Date(), 'chat'),
      pendingJobCount(db),
      failingSourceCount(db),
    ]);
  const [today] = await db
    .select({ n: count() })
    .from(articles)
    .where(
      sql`${articles.publishedAt} > now() - interval '24 hours' and ${articles.status} = 'published'`,
    );
  return {
    byStatus: Object.fromEntries(statusCounts.map((r) => [r.status, r.n])) as Record<
      string,
      number
    >,
    publishedLast24h: today?.n ?? 0,
    recentRuns,
    llm: { spentUsd: spend, budgetUsd: getConfig().LLM_MONTHLY_BUDGET_USD },
    chat: { spentUsd: chatSpend, budgetUsd: getConfig().CHAT_MONTHLY_BUDGET_USD },
    pendingJobs,
    failingSources,
  };
}

export const listRecentRuns = (db: Db, limit = 60) =>
  db.select().from(pipelineRuns).orderBy(desc(pipelineRuns.startedAt)).limit(limit);
export const listRecentJobs = (db: Db, limit = 60) =>
  db.select().from(jobs).orderBy(desc(jobs.createdAt)).limit(limit);

export async function listUsers(db: Db, q?: string) {
  const query = db
    .select({
      id: users.id,
      email: users.email,
      name: users.name,
      role: users.role,
      createdAt: users.createdAt,
      lastLoginAt: users.lastLoginAt,
    })
    .from(users)
    .orderBy(desc(users.createdAt))
    .limit(200);
  return q?.trim()
    ? query.where(sql`lower(${users.email}) like ${`%${q.trim().toLowerCase()}%`}`)
    : query;
}

export async function setUserRole(
  db: Db,
  actorId: string,
  userId: string,
  role: UserRole,
): Promise<void> {
  if (actorId === userId) throw new Error('You cannot change your own role');
  await db.update(users).set({ role }).where(eq(users.id, userId));
}
