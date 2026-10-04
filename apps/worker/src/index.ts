import {
  flushErrorReporting,
  getConfig,
  getLogger,
  initErrorReporting,
  reportError,
} from '@nm/core';
import { closeDb, getDb } from '@nm/db';
import { createProcessDeps, processArticles } from '@nm/services/ai/process';
import { createIngestDeps, runIngestion } from '@nm/services/ingestion/ingest';
import { runDueJobs, type JobHandlers } from '@nm/services/jobs/queue';
import { scheduleDigests, sendDigest, sendUrgentPush } from '@nm/services/notifications/fanout';
import { createWebPushSender } from '@nm/services/notifications/push';
import { createAlertTransport, evaluatePipelineHealth, raiseAlert } from '@nm/services/ops/alerts';
import { writeHeartbeat } from '@nm/services/ops/heartbeat';
import { createTypesense } from '@nm/services/search/search';
import { rebuildSearchIndex, syncSearchIndex } from '@nm/services/search/sync';
import { Scheduler } from './scheduler';

const config = getConfig();
const logger = getLogger({ service: 'worker' });
const db = getDb();
await initErrorReporting('worker');

const scheduler = new Scheduler(logger, config.SCHEDULER_ENABLED, (task, error) =>
  reportError(error, { service: 'worker', task }),
);
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

const pushSender = createWebPushSender(config);
if (!pushSender) logger.warn('VAPID keys not set: push notifications are disabled');

// Job queue: "run now" requests from the admin, and notification fan-out.
// Always on (also in dev), so manual triggers work without automatic schedules.
const jobHandlers: JobHandlers = {
  ingest_sources: async (job) => {
    const sourceIds = Array.isArray(job.payload.sourceIds)
      ? (job.payload.sourceIds as string[])
      : undefined;
    await runIngestion(ingestDeps, { trigger: 'manual', sourceIds });
  },
  process_articles: async (job) => {
    const articleIds = Array.isArray(job.payload.articleIds)
      ? (job.payload.articleIds as string[])
      : undefined;
    await processArticles(processDeps, {
      trigger: 'manual',
      articleIds: articleIds?.length ? articleIds : undefined,
    });
  },
  reindex: async () => {
    if (searchIndex) await rebuildSearchIndex(db, searchIndex);
  },
  urgent_push: async (job) => {
    const result = await sendUrgentPush(db, pushSender, String(job.payload.articleId));
    logger.info({ articleId: job.payload.articleId, ...result }, 'urgent push sent');
  },
  digest: async (job) => {
    const result = await sendDigest(db, pushSender, String(job.payload.userId));
    logger.debug({ userId: job.payload.userId, ...result }, 'digest processed');
  },
};

// Daily briefing: at DIGEST_HOUR local time, one digest job per opted-in reader (production schedule).
scheduler.register({
  name: 'schedule-digests',
  everyMs: 5 * 60_000,
  automatic: true,
  run: async () => {
    const queued = await scheduleDigests(db);
    if (queued) logger.info({ queued }, 'daily digests queued');
  },
});
scheduler.register({
  name: 'jobs',
  everyMs: 5_000,
  automatic: false,
  run: async () => {
    await runDueJobs(db, jobHandlers, {
      onError: (job, error) =>
        logger.warn({ job: job.id, kind: job.kind, err: (error as Error).message }, 'job failed'),
    });
  },
});

// Liveness: the web app's /api/health/worker reports 503 when this goes stale.
scheduler.register({
  name: 'heartbeat',
  everyMs: 60_000,
  automatic: false,
  run: () =>
    writeHeartbeat(db, {
      version: process.env.GIT_SHA ?? 'dev',
      env: config.APP_ENV,
      tasks: scheduler.taskNames,
    }),
});

// Operational alerts (failed ingestion, no new articles, LLM budget, stuck AI queue).
const alertTransport = createAlertTransport();
scheduler.register({
  name: 'health-checks',
  everyMs: 10 * 60_000,
  automatic: true,
  run: async () => {
    for (const alert of await evaluatePipelineHealth(db)) {
      if (await raiseAlert(db, alertTransport, alert)) logger.warn(alert, 'alert raised');
    }
  },
});

logger.info({ scheduler: config.SCHEDULER_ENABLED, tasks: scheduler.taskNames }, 'worker started');

let shuttingDown = false;
async function shutdown(signal: string) {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info({ signal }, 'shutting down');
  await scheduler.stop();
  await flushErrorReporting();
  await closeDb();
  process.exit(0);
}
process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
