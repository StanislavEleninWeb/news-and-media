import { eq } from 'drizzle-orm';
import type { Db } from '@nm/db';
import { pipelineRuns } from '@nm/db/schema';

export type RunKind = 'ingest' | 'process' | 'index' | 'digest' | 'notify';
export type RunTrigger = 'schedule' | 'manual' | 'cli';

/** Records a pipeline run so the admin and alerting can see what happened. */
export async function startRun(db: Db, kind: RunKind, trigger: RunTrigger): Promise<string> {
  const [row] = await db
    .insert(pipelineRuns)
    .values({ kind, trigger })
    .returning({ id: pipelineRuns.id });
  return row!.id;
}

export async function finishRun(
  db: Db,
  id: string,
  result: { status: 'ok' | 'partial' | 'failed'; stats: Record<string, number>; errors?: string[] },
): Promise<void> {
  const errorSummary = result.errors?.length
    ? result.errors.slice(0, 20).join('\n').slice(0, 4000)
    : null;
  await db
    .update(pipelineRuns)
    .set({ status: result.status, stats: result.stats, errorSummary, finishedAt: new Date() })
    .where(eq(pipelineRuns.id, id));
}
