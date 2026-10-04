import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { PGLiteSocketServer } from '@electric-sql/pglite-socket';
import { drizzle as drizzlePglite } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { drizzle as drizzlePostgres } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import type { Db } from './client';
import * as schema from './schema';

/**
 * Fresh in-memory PostgreSQL (PGlite) with every migration applied, so
 * integration tests run anywhere without a database server.
 *
 * By default the test talks to it through the PostgreSQL wire protocol with
 * postgres.js — the same driver as production — because the two drivers
 * serialise parameters differently. Set TEST_DB_DRIVER=pglite for the faster
 * in-process driver.
 */
export async function createTestDb(): Promise<{ db: Db; close: () => Promise<void> }> {
  const pglite = new PGlite();
  await migrate(drizzlePglite(pglite, { schema }), {
    migrationsFolder: fileURLToPath(new URL('../migrations', import.meta.url)),
  });

  if (process.env.TEST_DB_DRIVER === 'pglite') {
    return { db: drizzlePglite(pglite, { schema }) as unknown as Db, close: () => pglite.close() };
  }

  const server = new PGLiteSocketServer({
    db: pglite,
    host: '127.0.0.1',
    port: 0,
    maxConnections: 20,
  });
  await server.start();
  const address = server.getServerConn();
  const client = postgres(`postgres://postgres:postgres@${address}/postgres`, {
    max: 1,
    onnotice: () => {},
    idle_timeout: 0,
  });
  return {
    db: drizzlePostgres(client, { schema }) as unknown as Db,
    close: async () => {
      await client.end({ timeout: 1 });
      await server.stop();
      await pglite.close();
    },
  };
}
