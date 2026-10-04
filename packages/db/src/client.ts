import { getConfig } from '@nm/core/config';
import { drizzle } from 'drizzle-orm/postgres-js';
import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core';
import postgres from 'postgres';
import * as schema from './schema';

/**
 * Driver-agnostic database type. Production uses postgres.js; tests use an
 * in-process PGlite database. Services accept `Db` so both work.
 */
export type Db = PgDatabase<PgQueryResultHKT, typeof schema>;

let instance: { db: Db; close: () => Promise<void> } | undefined;

export function createDb(url: string, options: { max?: number } = {}) {
  const client = postgres(url, {
    max: options.max ?? 10,
    idle_timeout: 30,
    connect_timeout: 10,
    onnotice: () => {},
  });
  const db = drizzle(client, { schema }) as unknown as Db;
  return { db, close: () => client.end({ timeout: 5 }) };
}

/** Process-wide database handle, created on first use from DATABASE_URL. */
export function getDb(): Db {
  if (!instance) {
    const url = getConfig().DATABASE_URL;
    if (!url) throw new Error('DATABASE_URL is not set');
    instance = createDb(url);
  }
  return instance.db;
}

export async function closeDb(): Promise<void> {
  await instance?.close();
  instance = undefined;
}

/** Tests only: make getDb() return the given database (e.g. PGlite). */
export function setDbForTesting(db: Db | undefined): void {
  instance = db ? { db, close: async () => {} } : undefined;
}
