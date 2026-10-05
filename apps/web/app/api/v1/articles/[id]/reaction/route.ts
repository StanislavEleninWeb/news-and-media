import { z } from 'zod';
import { getDb } from '@nm/db';
import { reactionSchema } from '@nm/services/content/contracts';
import {
  getReactionSummary,
  isPublished,
  removeReaction,
  setReaction,
} from '@nm/services/content/engagement';
import { recordEngagement } from '@nm/services/content/behavior';
import { idParam } from '@/lib/api-schemas';
import { hasPersonalizationConsent } from '@/lib/consent';
import { clientIp, json, parseBody, problem, rejectCrossSite } from '@/lib/http';
import { rateLimit } from '@/lib/rate-limit';
import { getViewer } from '@/lib/viewer';

export const dynamic = 'force-dynamic';

type Context = { params: Promise<{ id: string }> };

async function articleId(context: Context): Promise<string | null> {
  const { id } = await context.params;
  return idParam.safeParse(id).success ? id : null;
}

/** GET /api/v1/articles/:id/reaction — counts per reaction and the viewer's own. */
export async function GET(request: Request, context: Context) {
  const id = await articleId(context);
  if (!id) return problem(404, 'not_found');
  const viewer = await getViewer(request);
  return json(await getReactionSummary(getDb(), id, viewer.actorKey || null));
}

/** PUT /api/v1/articles/:id/reaction {"reaction":"like"} — works without an account. */
export async function PUT(request: Request, context: Context) {
  const blocked = rejectCrossSite(request);
  if (blocked) return blocked;
  const id = await articleId(context);
  if (!id || !(await isPublished(getDb(), id))) return problem(404, 'not_found');
  if (!rateLimit(`react:${clientIp(request)}`, 60, 60_000)) return problem(429, 'rate_limited');
  const body = await parseBody(request, z.object({ reaction: reactionSchema }));
  if (body instanceof Response) return body;
  const viewer = await getViewer(request, { createAnonymousId: true });
  await setReaction(getDb(), id, viewer.actorKey, body.reaction);
  if (hasPersonalizationConsent(request))
    await recordEngagement(getDb(), { actorKey: viewer.actorKey, userId: viewer.user?.id }, [
      { articleId: id, kind: 'reaction' },
    ]);
  return json(await getReactionSummary(getDb(), id, viewer.actorKey), { cookies: viewer.cookies });
}

/** DELETE /api/v1/articles/:id/reaction */
export async function DELETE(request: Request, context: Context) {
  const blocked = rejectCrossSite(request);
  if (blocked) return blocked;
  const id = await articleId(context);
  if (!id) return problem(404, 'not_found');
  const viewer = await getViewer(request);
  if (viewer.actorKey) await removeReaction(getDb(), id, viewer.actorKey);
  return json(await getReactionSummary(getDb(), id, viewer.actorKey || null));
}
