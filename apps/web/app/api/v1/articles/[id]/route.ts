import { z } from 'zod';
import { getDb } from '@nm/db';
import { getArticle } from '@nm/services/content/article';
import { idParam, localeParam } from '@/lib/api-schemas';
import { json, parseQuery, problem } from '@/lib/http';

export const dynamic = 'force-dynamic';

const query = z.object(localeParam);

/** GET /api/v1/articles/:id?locale=en */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!idParam.safeParse(id).success) return problem(404, 'not_found');
  const q = parseQuery(request, query);
  if (q instanceof Response) return q;
  const article = await getArticle(getDb(), id, q.locale);
  return article ? json(article) : problem(404, 'not_found');
}
