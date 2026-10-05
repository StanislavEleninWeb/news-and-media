import { getDb } from '@nm/db';
import { chatRequestSchema, type ChatResponse } from '@nm/contracts';
import { askArticle } from '@nm/services/ai/chat';
import { createChatProvider } from '@nm/services/ai/providers';
import { getConfig } from '@nm/core/config';
import { idParam } from '@/lib/api-schemas';
import { json, parseBody, problem, rejectCrossSite } from '@/lib/http';
import { rateLimit } from '@/lib/rate-limit';
import { getUser } from '@/lib/viewer';

export const dynamic = 'force-dynamic';

const status = {
  not_found: 404,
  disabled: 503,
  rate_limited: 429,
  budget_exhausted: 503,
  provider_error: 502,
} as const;

/**
 * POST /api/v1/articles/:id/chat {locale, question, history} — "ask this
 * article". Signed-in readers only; per-reader hourly/daily quota, a monthly
 * budget and its own provider key (CHAT_ANTHROPIC_API_KEY).
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const blocked = rejectCrossSite(request);
  if (blocked) return blocked;
  const { id } = await params;
  if (!idParam.safeParse(id).success) return problem(404, 'not_found');
  const user = await getUser(request);
  if (!user) return problem(401, 'unauthenticated');
  // Burst guard in front of the persistent quota.
  if (!rateLimit(`chat:${user.id}`, 5, 60_000)) return problem(429, 'rate_limited');
  const body = await parseBody(request, chatRequestSchema);
  if (body instanceof Response) return body;

  const config = getConfig();
  const outcome = await askArticle(
    getDb(),
    createChatProvider(config),
    {
      articleId: id,
      locale: body.locale,
      userId: user.id,
      question: body.question,
      history: body.history,
    },
    config,
  );
  if (!outcome.ok) return problem(status[outcome.reason], outcome.reason);
  const response: ChatResponse = { answer: outcome.answer, refused: outcome.refused };
  return json(response);
}
