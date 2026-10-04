import { gte, sum } from 'drizzle-orm';
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

/** LLM spend so far this calendar month (UTC). */
export async function monthToDateSpend(db: Db, now = new Date()): Promise<number> {
  const [row] = await db
    .select({ total: sum(llmUsage.costUsd) })
    .from(llmUsage)
    .where(gte(llmUsage.createdAt, startOfMonthUtc(now)));
  return Number(row?.total ?? 0);
}

export async function recordUsage(
  db: Db,
  result: CompletionResult,
  meta: { articleId: string | null; purpose: 'rewrite' | 'translate' | 'chat' },
): Promise<number> {
  const cost = costUsd(result);
  await db.insert(llmUsage).values({
    articleId: meta.articleId,
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
