import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Db } from '@nm/db';
import { adSlots } from '@nm/db/schema';
import {
  articleDetailSchema,
  feedResponseSchema,
  reactionSummarySchema,
  searchResponseSchema,
} from '@nm/services/content/contracts';
import { createPublishedArticle, createSource } from '@nm/services/testing/content';
import { GET as getAds } from '@/app/api/v1/ads/route';
import { GET as getArticleRoute } from '@/app/api/v1/articles/[id]/route';
import {
  DELETE as unreact,
  GET as getReaction,
  PUT as react,
} from '@/app/api/v1/articles/[id]/reaction/route';
import { POST as view } from '@/app/api/v1/articles/[id]/view/route';
import { GET as getFeedRoute } from '@/app/api/v1/feed/route';
import { DELETE as unsave, PUT as save } from '@/app/api/v1/me/saved/[id]/route';
import { GET as getSaved } from '@/app/api/v1/me/saved/route';
import { GET as search } from '@/app/api/v1/search/route';
import { GET as getTopics } from '@/app/api/v1/topics/route';
import { GET as getTrending } from '@/app/api/v1/trending/route';
import { GET as health } from '@/app/api/health/route';
import { params, request, setupApiTest, signedInCookie } from './helpers';

let db: Db;
let close: () => Promise<void>;
let articleId: string;

beforeAll(async () => {
  ({ db, close } = await setupApiTest());
  const source = await createSource(db, { name: 'Дневник' });
  articleId = (
    await createPublishedArticle(db, {
      sourceId: source.id,
      texts: { bg: { title: 'Бюджетът е приет' }, en: { title: 'Budget adopted' } },
      topicSlugs: ['politics'],
    })
  ).id;
});
afterAll(async () => close());

describe('GET /api/v1/feed', () => {
  it('returns the contract shape', async () => {
    const response = await getFeedRoute(request('/api/v1/feed?locale=en&perPage=5'));
    expect(response.status).toBe(200);
    const body = feedResponseSchema.parse(await response.json());
    expect(body.items[0]).toMatchObject({
      title: 'Budget adopted',
      topics: [{ slug: 'politics', name: 'Politics' }],
    });
  });
  it('rejects bad parameters', async () => {
    expect((await getFeedRoute(request('/api/v1/feed?locale=de'))).status).toBe(400);
    expect((await getFeedRoute(request('/api/v1/feed?topic=DROP%20TABLE'))).status).toBe(400);
  });
});

describe('GET /api/v1/articles/:id', () => {
  it('returns a published article and 404s otherwise', async () => {
    const ok = await getArticleRoute(
      request(`/api/v1/articles/${articleId}?locale=bg`),
      params({ id: articleId }),
    );
    expect(articleDetailSchema.parse(await ok.json()).title).toBe('Бюджетът е приет');
    expect(
      (await getArticleRoute(request('/api/v1/articles/nope'), params({ id: 'nope' }))).status,
    ).toBe(404);
    const missing = crypto.randomUUID();
    expect(
      (await getArticleRoute(request(`/api/v1/articles/${missing}`), params({ id: missing })))
        .status,
    ).toBe(404);
  });
});

describe('reactions', () => {
  it('lets anonymous readers react, remembering them with a cookie', async () => {
    const response = await react(
      request(`/api/v1/articles/${articleId}/reaction`, {
        method: 'PUT',
        body: JSON.stringify({ reaction: 'like' }),
      }),
      params({ id: articleId }),
    );
    expect(response.status).toBe(200);
    const cookie = response.headers.get('set-cookie')!;
    expect(cookie).toMatch(
      /^nm_aid=[0-9a-f-]{36}; Path=\/; Max-Age=31536000; HttpOnly; SameSite=Lax$/,
    );
    expect(reactionSummarySchema.parse(await response.json())).toMatchObject({
      mine: 'like',
      counts: { like: 1 },
    });

    const anonCookie = cookie.split(';')[0]!;
    const summary = await (
      await getReaction(
        request(`/api/v1/articles/${articleId}/reaction`, { cookie: anonCookie }),
        params({ id: articleId }),
      )
    ).json();
    expect(summary.mine).toBe('like');
    const removed = await unreact(
      request(`/api/v1/articles/${articleId}/reaction`, { method: 'DELETE', cookie: anonCookie }),
      params({ id: articleId }),
    );
    expect((await removed.json()).counts.like).toBe(0);
  });

  it('blocks cross-site requests and invalid reactions', async () => {
    const crossSite = await react(
      request(`/api/v1/articles/${articleId}/reaction`, {
        method: 'PUT',
        origin: 'https://evil.example',
        body: '{"reaction":"like"}',
      }),
      params({ id: articleId }),
    );
    expect(crossSite.status).toBe(403);
    const noOrigin = await react(
      request(`/api/v1/articles/${articleId}/reaction`, {
        method: 'PUT',
        origin: null,
        body: '{"reaction":"like"}',
      }),
      params({ id: articleId }),
    );
    expect(noOrigin.status).toBe(403);
    const invalid = await react(
      request(`/api/v1/articles/${articleId}/reaction`, {
        method: 'PUT',
        body: '{"reaction":"love"}',
      }),
      params({ id: articleId }),
    );
    expect(invalid.status).toBe(400);
  });
});

describe('reading list', () => {
  it('requires a session', async () => {
    expect((await getSaved(request('/api/v1/me/saved'))).status).toBe(401);
    expect(
      (
        await save(
          request(`/api/v1/me/saved/${articleId}`, { method: 'PUT' }),
          params({ id: articleId }),
        )
      ).status,
    ).toBe(401);
  });

  it('saves and lists articles for the signed-in reader', async () => {
    const { cookie } = await signedInCookie(db);
    expect(
      (
        await save(
          request(`/api/v1/me/saved/${articleId}`, { method: 'PUT', cookie }),
          params({ id: articleId }),
        )
      ).status,
    ).toBe(204);
    const list = await (await getSaved(request('/api/v1/me/saved?locale=en', { cookie }))).json();
    expect(list.items.map((i: { id: string }) => i.id)).toEqual([articleId]);
    await unsave(
      request(`/api/v1/me/saved/${articleId}`, { method: 'DELETE', cookie }),
      params({ id: articleId }),
    );
    expect((await (await getSaved(request('/api/v1/me/saved', { cookie }))).json()).items).toEqual(
      [],
    );
  });

  it('ignores expired or forged sessions', async () => {
    expect(
      (
        await getSaved(
          request('/api/v1/me/saved', { cookie: 'nm_session=forged-token-that-is-long-enough' }),
        )
      ).status,
    ).toBe(401);
  });
});

describe('search, topics, trending, ads, views, health', () => {
  it('searches with the PostgreSQL fallback when Typesense is not configured', async () => {
    const body = searchResponseSchema.parse(
      await (await search(request('/api/v1/search?q=бюджет&locale=bg'))).json(),
    );
    expect(body.engine).toBe('postgres');
    expect(body.hits[0]).toMatchObject({
      id: articleId,
      path: expect.stringMatching(/^\/bg\/a\//),
    });
  });

  it('lists topics', async () => {
    const body = await (await getTopics(request('/api/v1/topics?locale=bg'))).json();
    expect(body.topics.map((t: { slug: string }) => t.slug)).toEqual([
      'general',
      'politics',
      'business',
      'tech',
      'culture',
      'sport',
    ]);
  });

  it('counts a view once per visitor and surfaces it in trending', async () => {
    const headers = { 'x-forwarded-for': '203.0.113.7' };
    expect(
      (
        await view(
          request(`/api/v1/articles/${articleId}/view`, { method: 'POST', headers }),
          params({ id: articleId }),
        )
      ).status,
    ).toBe(204);
    await view(
      request(`/api/v1/articles/${articleId}/view`, { method: 'POST', headers }),
      params({ id: articleId }),
    );
    const trending = await (await getTrending(request('/api/v1/trending?locale=bg'))).json();
    expect(trending.items.map((i: { id: string }) => i.id)).toEqual([articleId]);
  });

  it('serves an ad for a placement or null', async () => {
    await db.insert(adSlots).values({
      name: 'x',
      placement: 'home_top',
      kind: 'house',
      imageUrl: '/media/h.webp',
      targetUrl: '/advertise',
      altText: 'Рекламирайте тук',
      width: 970,
      height: 90,
    });
    expect(
      (await (await getAds(request('/api/v1/ads?placement=home_top&locale=bg'))).json()).ad.altText,
    ).toBe('Рекламирайте тук');
    expect(
      (await (await getAds(request('/api/v1/ads?placement=search_inline'))).json()).ad,
    ).toBeNull();
    expect((await getAds(request('/api/v1/ads?placement=popup'))).status).toBe(400);
  });

  it('reports health of its dependencies', async () => {
    const response = await health();
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      status: 'ok',
      checks: { database: 'ok', search: 'disabled' },
    });
  });
});
