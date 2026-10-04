import { sql } from 'drizzle-orm';
import { getConfig } from '@nm/core/config';
import { getDb } from '@nm/db';
import { createTypesense } from '@nm/services/search/search';
import { TypesenseClient } from '@nm/services/search/typesense';

export const dynamic = 'force-dynamic';

async function check(fn: () => Promise<boolean>): Promise<'ok' | 'down' | 'disabled'> {
  try {
    return (await fn()) ? 'ok' : 'down';
  } catch {
    return 'down';
  }
}

/**
 * Readiness probe for deploy.sh and uptime monitors: 200 when the database
 * (and search, if configured) answer, 503 otherwise.
 */
export async function GET() {
  const config = getConfig();
  const database = await check(async () => {
    await getDb().execute(sql`select 1`);
    return true;
  });
  const search = createTypesense(config)
    ? await check(() =>
        new TypesenseClient(config.TYPESENSE_URL!, config.TYPESENSE_API_KEY!, 3_000).health(),
      )
    : 'disabled';
  const healthy = database === 'ok' && search !== 'down';
  return Response.json(
    {
      status: healthy ? 'ok' : 'degraded',
      env: config.APP_ENV,
      version: process.env.GIT_SHA ?? 'dev',
      checks: { database, search },
      time: new Date().toISOString(),
    },
    { status: healthy ? 200 : 503, headers: { 'Cache-Control': 'no-store' } },
  );
}
