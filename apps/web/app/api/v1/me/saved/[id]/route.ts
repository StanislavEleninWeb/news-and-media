import { getDb } from '@nm/db';
import { isPublished, saveArticle, unsaveArticle } from '@nm/services/content/engagement';
import { idParam } from '@/lib/api-schemas';
import { noContent, problem, rejectCrossSite } from '@/lib/http';
import { getUser } from '@/lib/viewer';

export const dynamic = 'force-dynamic';

type Context = { params: Promise<{ id: string }> };

async function prepare(request: Request, context: Context) {
  const blocked = rejectCrossSite(request);
  if (blocked) return blocked;
  const user = await getUser(request);
  if (!user) return problem(401, 'unauthenticated');
  const { id } = await context.params;
  if (!idParam.safeParse(id).success) return problem(404, 'not_found');
  return { user, id };
}

/** PUT /api/v1/me/saved/:id — add to the reading list. */
export async function PUT(request: Request, context: Context) {
  const ready = await prepare(request, context);
  if (ready instanceof Response) return ready;
  if (!(await isPublished(getDb(), ready.id))) return problem(404, 'not_found');
  await saveArticle(getDb(), ready.user.id, ready.id);
  return noContent();
}

/** DELETE /api/v1/me/saved/:id */
export async function DELETE(request: Request, context: Context) {
  const ready = await prepare(request, context);
  if (ready instanceof Response) return ready;
  await unsaveArticle(getDb(), ready.user.id, ready.id);
  return noContent();
}
