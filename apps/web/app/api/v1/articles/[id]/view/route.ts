import { getDb } from '@nm/db';
import { isPublished, recordView } from '@nm/services/content/engagement';
import { idParam } from '@/lib/api-schemas';
import { clientIp, noContent, problem } from '@/lib/http';
import { rateLimit } from '@/lib/rate-limit';

export const dynamic = 'force-dynamic';

/** POST /api/v1/articles/:id/view — anonymous view beacon feeding "trending now". */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!idParam.safeParse(id).success) return problem(404, 'not_found');
  // One counted view per IP and article every 10 minutes.
  if (!rateLimit(`view:${clientIp(request)}:${id}`, 1, 10 * 60_000)) return noContent();
  if (await isPublished(getDb(), id)) await recordView(getDb(), id);
  return noContent();
}
