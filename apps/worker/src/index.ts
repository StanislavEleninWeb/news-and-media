import { getConfig, getLogger } from '@nm/core';
import { Scheduler } from './scheduler';

const config = getConfig();
const logger = getLogger({ service: 'worker' });

const scheduler = new Scheduler(logger, config.SCHEDULER_ENABLED);

scheduler.register({
  name: 'heartbeat',
  everyMs: 60_000,
  automatic: false,
  run: async () => {
    logger.debug('worker alive');
  },
});

logger.info({ scheduler: config.SCHEDULER_ENABLED, tasks: scheduler.taskNames }, 'worker started');

let shuttingDown = false;
async function shutdown(signal: string) {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info({ signal }, 'shutting down');
  await scheduler.stop();
  process.exit(0);
}
process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
