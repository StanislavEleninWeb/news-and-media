import { eq } from 'drizzle-orm';
import type { Db } from '@nm/db';
import { systemState } from '@nm/db/schema';

const KEY = 'worker:heartbeat';
export const HEARTBEAT_STALE_MS = 5 * 60_000;

export interface Heartbeat {
  at: string;
  version: string;
  env: string;
  tasks: string[];
}

export async function writeHeartbeat(db: Db, value: Omit<Heartbeat, 'at'>): Promise<void> {
  const payload: Heartbeat = { ...value, at: new Date().toISOString() };
  await db
    .insert(systemState)
    .values({ key: KEY, value: payload })
    .onConflictDoUpdate({ target: systemState.key, set: { value: payload } });
}

export async function readHeartbeat(
  db: Db,
): Promise<{ heartbeat: Heartbeat | null; ageMs: number | null; stale: boolean }> {
  const [row] = await db.select().from(systemState).where(eq(systemState.key, KEY));
  const heartbeat = (row?.value as Heartbeat | undefined) ?? null;
  const ageMs = heartbeat ? Date.now() - Date.parse(heartbeat.at) : null;
  return { heartbeat, ageMs, stale: ageMs === null || ageMs > HEARTBEAT_STALE_MS };
}
