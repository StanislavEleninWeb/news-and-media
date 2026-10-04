import { getConfig } from '@nm/core/config';

export const dynamic = 'force-dynamic';

/** Liveness probe used by the deploy script and external uptime monitors. */
export function GET() {
  const config = getConfig();
  return Response.json(
    {
      status: 'ok',
      env: config.APP_ENV,
      version: process.env.GIT_SHA ?? 'dev',
      time: new Date().toISOString(),
    },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}
