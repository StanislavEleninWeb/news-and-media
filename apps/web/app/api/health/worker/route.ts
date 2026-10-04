import { getDb } from '@nm/db';
import { readHeartbeat } from '@nm/services/ops/heartbeat';

export const dynamic = 'force-dynamic';

/**
 * Worker liveness for external uptime monitors: 503 when the worker has not
 * written its heartbeat for 5 minutes (crashed, stuck, or not deployed).
 */
export async function GET() {
  try {
    const { heartbeat, ageMs, stale } = await readHeartbeat(getDb());
    return Response.json(
      {
        status: stale ? 'stale' : 'ok',
        lastSeen: heartbeat?.at ?? null,
        ageSeconds: ageMs === null ? null : Math.round(ageMs / 1000),
        version: heartbeat?.version ?? null,
      },
      { status: stale ? 503 : 200, headers: { 'Cache-Control': 'no-store' } },
    );
  } catch {
    return Response.json(
      { status: 'error' },
      { status: 503, headers: { 'Cache-Control': 'no-store' } },
    );
  }
}
