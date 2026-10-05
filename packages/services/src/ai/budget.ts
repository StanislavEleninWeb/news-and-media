import { and, eq, gte, ne, sum } from 'drizzle-orm';
import type { Db } from '@nm/db';
import { llmUsage } from '@nm/db/schema';
import type { CompletionResult } from './providers';

export function costUsd(result: Pick<CompletionResult, 'usage' | 'prices'>): number {
  const { usage, prices } = result;
  return (
    (usage.inputTokens * prices.input +
      usage.outputTokens * prices.output +
      usage.cacheReadTokens * prices.cacheRead) /
    1_000_000
  );
}

export function startOfMonthUtc(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}

/**
 * LLM spend so far this calendar month (UTC). The pipeline (rewrite, translate)
 * and the reader-facing chat have separate keys and separate budgets.
 */
export async function monthToDateSpend(
  db: Db,
  now = new Date(),
  scope: 'pipeline' | 'chat' = 'pipeline',
): Promise<number> {
  const [row] = await db
    .select({ total: sum(llmUsage.costUsd) })
    .from(llmUsage)
    .where(
      and(
        gte(llmUsage.createdAt, startOfMonthUtc(now)),
        scope === 'chat' ? eq(llmUsage.purpose, 'chat') : ne(llmUsage.purpose, 'chat'),
      ),
    );
  return Number(row?.total ?? 0);
}

export async function recordUsage(
  db: Db,
  result: CompletionResult,
  meta: { articleId: string | null; purpose: 'rewrite' | 'translate' | 'chat'; userId?: string },
): Promise<number> {
  const cost = costUsd(result);
  await db.insert(llmUsage).values({
    articleId: meta.articleId,
    userId: meta.userId ?? null,
    purpose: meta.purpose,
    provider: result.provider,
    model: result.model,
    inputTokens: result.usage.inputTokens,
    outputTokens: result.usage.outputTokens,
    cacheReadTokens: result.usage.cacheReadTokens,
    costUsd: cost,
  });
  return cost;
}
