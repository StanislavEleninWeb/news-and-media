import { fileURLToPath } from 'node:url';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';

/**
 * Location of the SQL migrations. Containers set MIGRATIONS_DIR; in a checkout
 * the folder next to this package's sources is used.
 */
export function migrationsFolder(): string {
  return process.env.MIGRATIONS_DIR ?? fileURLToPath(new URL('../migrations', import.meta.url));
}

/** Applies all pending migrations. Migrations are forward-only (see docs/RUNBOOK.md). */
export async function runMigrations(url: string): Promise<void> {
  const client = postgres(url, { max: 1, onnotice: () => {} });
  try {
    await migrate(drizzle(client), { migrationsFolder: migrationsFolder() });
  } finally {
    await client.end({ timeout: 5 });
  }
}
