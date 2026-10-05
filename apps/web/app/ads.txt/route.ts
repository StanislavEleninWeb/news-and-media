import { getConfig } from '@nm/core/config';

export const dynamic = 'force-dynamic';

/** /ads.txt — authorised digital sellers (IAB), from ADS_TXT ("|"-separated lines). */
export function GET() {
  const lines = (getConfig().ADS_TXT ?? '')
    .split('|')
    .map((line) => line.trim())
    .filter(Boolean);
  const body = lines.length ? `${lines.join('\n')}\n` : '# No authorised sellers configured\n';
  return new Response(body, {
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'public, max-age=3600',
    },
  });
}
