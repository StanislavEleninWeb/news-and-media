import { getConfig } from '@nm/core/config';
import { json } from '@/lib/http';

export const dynamic = 'force-dynamic';

/** GET /api/v1/push/vapid-public-key — served at runtime so one image works in every environment. */
export function GET() {
  return json(
    { key: getConfig().VAPID_PUBLIC_KEY ?? null },
    { headers: { 'Cache-Control': 'public, max-age=3600' } },
  );
}
