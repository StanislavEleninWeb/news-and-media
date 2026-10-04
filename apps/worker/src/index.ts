import { getConfig, getLogger } from '@nm/core';
import { closeDb, getDb } from '@nm/db';
import { createProcessDeps, processArticles } from '@nm/services/ai/process';
import { createIngestDeps, runIngestion } from '@nm/services/ingestion/ingest';
import { createTypesense } from '@nm/services/search/search';
import { syncSearchIndex } from '@nm/services/search/sync';
import { Scheduler } from './scheduler';

const config = getConfig();
const logger = getLogger({ service: 'worker' });
const db = getDb();

const scheduler = new Scheduler(logger, config.SCHEDULER_ENABLED);
const ingestDeps = createIngestDeps(db);

// Each tick fetches only the sources whose next_fetch_at has passed, so the
// per-source interval set in the admin is what controls frequency.
scheduler.register({
  name: 'ingest',
  everyMs: 60_000,
  automatic: true,
  run: async () => {
    await runIngestion(ingestDeps, { trigger: 'schedule' });
  },
});

const processDeps = createProcessDeps(db);
if (!processDeps.provider) {
  logger.warn(
    { reason: processDeps.providerError },
    'AI processing disabled: no LLM provider configured',
  );
}

// Rewrites newly ingested articles into Bulgarian and English (capped per run and per month).
scheduler.register({
  name: 'process',
  everyMs: 60_000,
  automatic: true,
  run: async () => {
    const summary = await processArticles(processDeps, { trigger: 'schedule' });
    if (summary.status === 'budget_exceeded') logger.error(summary, 'LLM budget exhausted');
  },
});

// Keeps Typesense in line with the database (new, edited and hidden articles).
// Cheap and local, so it runs in every environment, schedules or not.
const searchIndex = createTypesense(config);
if (searchIndex) {
  scheduler.register({
    name: 'search-sync',
    everyMs: 30_000,
    automatic: false,
    run: async () => {
      const result = await syncSearchIndex(db, searchIndex);
      if (result.indexed || result.removed) logger.info(result, 'search index synced');
    },
  });
} else {
  logger.warn('TYPESENSE_URL not set: search uses the PostgreSQL fallback');
}

logger.info({ scheduler: config.SCHEDULER_ENABLED, tasks: scheduler.taskNames }, 'worker started');

let shuttingDown = false;
async function shutdown(signal: string) {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info({ signal }, 'shutting down');
  await scheduler.stop();
  await closeDb();
  process.exit(0);
}
process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
