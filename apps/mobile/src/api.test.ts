import { describe, expect, it } from 'vitest';
import { ApiError, createApi } from './api';

const card = {
  id: '3f1c2a4e-9b7d-4c1e-8a2f-0b6d5e4c3a21',
  locale: 'bg',
  title: 'Заглавие',
  tldr: 'Накратко',
  slug: 'zaglavie',
  path: '/bg/a/3f1c2a4e-9b7d-4c1e-8a2f-0b6d5e4c3a21/zaglavie',
  imageUrl: '/media/a.webp',
  imageThumbUrl: null,
  source: { id: '0b6d5e4c-3a21-4c1e-8a2f-3f1c2a4e9b7d', name: 'Източник' },
  topics: [],
  publishedAt: '2026-10-05T07:00:00.000Z',
  isUrgent: false,
};

function fakeFetch(responses: Response[]) {
  const calls: { url: string; init: RequestInit }[] = [];
  const impl = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return responses.shift()!;
  }) as unknown as typeof fetch;
  return { calls, impl };
}

describe('mobile API client', () => {
  it('sends the bearer token, anonymous id and staging key, never cookies', async () => {
    const { calls, impl } = fakeFetch([
      new Response(
        JSON.stringify({ items: [card], page: 1, perPage: 20, hasMore: false, personalized: true }),
      ),
    ]);
    const api = createApi({
      baseUrl: 'https://staging.example.com/',
      getToken: () => 'tok_abcdefghijklmnopqrstuvwxyz',
      anonId: () => 'anon-id',
      stagingKey: 'gate',
      fetchImpl: impl,
    });
    const feed = await api.feed({ locale: 'bg', topic: 'tech' });
    expect(feed.items[0]!.title).toBe('Заглавие');
    expect(calls[0]!.url).toBe('https://staging.example.com/api/v1/feed?locale=bg&topic=tech');
    expect(calls[0]!.init.credentials).toBe('omit');
    expect(calls[0]!.init.headers).toMatchObject({
      Authorization: 'Bearer tok_abcdefghijklmnopqrstuvwxyz',
      'X-NM-Anon-Id': 'anon-id',
      'X-Staging-Key': 'gate',
    });
    expect(api.absolute(card.imageUrl)).toBe('https://staging.example.com/media/a.webp');
  });

  it('turns error bodies into ApiError and rejects contract violations', async () => {
    const { impl } = fakeFetch([
      new Response(JSON.stringify({ error: { code: 'invalid_credentials' } }), { status: 401 }),
      new Response(JSON.stringify({ items: [{ ...card, id: 'nope' }], page: 1 })),
    ]);
    const api = createApi({
      baseUrl: 'https://x.test',
      getToken: () => null,
      anonId: () => null,
      fetchImpl: impl,
    });
    await expect(api.signIn('a@b.bg', 'x')).rejects.toEqual(
      new ApiError(401, 'invalid_credentials'),
    );
    await expect(api.feed({ locale: 'bg' })).rejects.toThrow();
  });
});
