/**
 * Database migration entrypoint, run by the `migrate` compose service on every
 * deploy before new web/worker containers start (`node dist/migrate.js`).
 */
import { getConfig, getLogger } from '@nm/core';
import { migrationsFolder, runMigrations } from '@nm/db/migrate';

const logger = getLogger({ service: 'migrate' });
const url = getConfig().DATABASE_URL;
if (!url) {
  logger.fatal('DATABASE_URL is not set');
  process.exit(1);
}

const startedAt = Date.now();
runMigrations(url)
  .then(() => {
    logger.info({ folder: migrationsFolder(), ms: Date.now() - startedAt }, 'migrations applied');
    process.exit(0);
  })
  .catch((error: unknown) => {
    logger.fatal({ err: error }, 'migration failed');
    process.exit(1);
  });
