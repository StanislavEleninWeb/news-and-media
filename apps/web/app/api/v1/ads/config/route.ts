import { getAdServerConfig } from '@nm/services/content/ads';
import { json } from '@/lib/http';

export const dynamic = 'force-dynamic';

/**
 * GET /api/v1/ads/config — ad server settings for the browser (runtime, so the
 * same Docker image serves direct ads on staging and Ad Manager in production).
 */
export function GET() {
  return json(getAdServerConfig(), { headers: { 'Cache-Control': 'public, max-age=300' } });
}
