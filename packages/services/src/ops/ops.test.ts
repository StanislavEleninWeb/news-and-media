import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Db } from '@nm/db';
import { articles, llmUsage, pipelineRuns } from '@nm/db/schema';
import { createTestDb } from '@nm/db/testing';
import { createSource } from '../testing/content';
import { evaluatePipelineHealth, raiseAlert, type Alert } from './alerts';
import { readHeartbeat, writeHeartbeat } from './heartbeat';

let db: Db;
let close: () => Promise<void>;
beforeAll(async () => {
  ({ db, close } = await createTestDb());
});
afterAll(async () => close());

describe('heartbeat', () => {
  it('is stale until the worker writes one', async () => {
    expect((await readHeartbeat(db)).stale).toBe(true);
    await writeHeartbeat(db, { version: 'abc123', env: 'test', tasks: ['ingest'] });
    const { heartbeat, stale, ageMs } = await readHeartbeat(db);
    expect(stale).toBe(false);
    expect(ageMs!).toBeLessThan(5_000);
    expect(heartbeat).toMatchObject({ version: 'abc123', tasks: ['ingest'] });
  });
});

describe('pipeline alerts', () => {
  it('stays quiet while things are healthy', async () => {
    expect(await evaluatePipelineHealth(db)).toEqual([]);
  });

  it('flags a failed ingestion, a dry day, the budget and a stuck AI queue', async () => {
    const source = await createSource(db);
    await db
      .insert(pipelineRuns)
      .values({ kind: 'ingest', status: 'failed', errorSummary: 'Дневник: HTTP 503' });
    let alerts = await evaluatePipelineHealth(db);
    expect(alerts.map((a) => a.key).sort()).toEqual(['ingest-failed', 'no-new-articles']);

    await db.insert(pipelineRuns).values({
      kind: 'process',
      status: 'failed',
      errorSummary: 'Monthly LLM budget reached ($5.01 of $5)',
    });
    await db
      .insert(llmUsage)
      .values({ purpose: 'rewrite', provider: 'x', model: 'm', costUsd: 5.01 });
    const old = new Date(Date.now() - 8 * 3_600_000);
    await db.insert(articles).values(
      Array.from({ length: 20 }, (_, i) => ({
        sourceId: source.id,
        originalUrl: `https://e.test/${i}`,
        originalTitle: `t${i}`,
        originalLanguage: 'bg',
        rawText: 'x',
        contentHash: `h${i}`,
        ingestedAt: old,
      })),
    );
    alerts = await evaluatePipelineHealth(db);
    expect(alerts.map((a) => a.key).sort()).toEqual([
      'ai-queue-stuck',
      'ingest-failed',
      'llm-budget-exhausted',
    ]);
    expect(alerts.find((a) => a.key === 'llm-budget-exhausted')!.severity).toBe('critical');
  });

  it('throttles repeats of the same alert', async () => {
    const sent: Alert[] = [];
    const transport = async (alert: Alert) => void sent.push(alert);
    const alert: Alert = { key: 'test', title: 'Test', details: 'details', severity: 'warning' };
    expect(await raiseAlert(db, transport, alert)).toBe(true);
    expect(await raiseAlert(db, transport, alert)).toBe(false);
    expect(await raiseAlert(db, transport, { ...alert, key: 'other' })).toBe(true);
    expect(sent.map((a) => a.key)).toEqual(['test', 'other']);
  });
});
