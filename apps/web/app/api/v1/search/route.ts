import { z } from 'zod';
import { getDb } from '@nm/db';
import { articlePath, type SearchResponse } from '@nm/services/content/contracts';
import { createSearchBackend } from '@nm/services/search/search';
import { localeParam, pageParams, slugParam } from '@/lib/api-schemas';
import { clientIp, json, parseQuery, problem } from '@/lib/http';
import { rateLimit } from '@/lib/rate-limit';

export const dynamic = 'force-dynamic';

const query = z.object({
  ...localeParam,
  ...pageParams,
  q: z.string().trim().max(200).default(''),
  topic: slugParam.optional(),
});

/** GET /api/v1/search?q=бюджет&locale=bg&topic=politics */
export async function GET(request: Request) {
  const params = parseQuery(request, query);
  if (params instanceof Response) return params;
  if (!rateLimit(`search:${clientIp(request)}`, 120, 60_000)) return problem(429, 'rate_limited');
  const backend = createSearchBackend(getDb());
  const result = await backend.search({
    q: params.q,
    locale: params.locale,
    topic: params.topic,
    page: params.page,
    perPage: params.perPage,
  });
  const response: SearchResponse = {
    found: result.found,
    page: result.page,
    perPage: result.perPage,
    engine: backend.kind,
    hits: result.hits.map((hit) => ({
      id: hit.articleId,
      locale: hit.locale,
      title: hit.title,
      tldr: hit.tldr,
      path: articlePath(hit.locale, hit.articleId, hit.slug),
      source: hit.source,
      topics: hit.topics,
      imageUrl: hit.imageUrl,
      publishedAt: hit.publishedAt,
      isUrgent: hit.isUrgent,
      highlight: hit.highlight,
    })),
    facets: result.facets,
  };
  return json(response);
}
