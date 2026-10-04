import { getConfig, getLogger } from '@nm/core';
import { closeDb, getDb } from '@nm/db';
import { createIngestDeps, runIngestion } from '@nm/services/ingestion/ingest';
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
