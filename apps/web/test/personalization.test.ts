import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { chatResponseSchema, feedResponseSchema } from '@nm/contracts';
import { resetConfig } from '@nm/core/config';
import type { Db } from '@nm/db';
import { engagementEvents } from '@nm/db/schema';
import { createPublishedArticle, createSource } from '@nm/services/testing/content';
import { POST as chat } from '@/app/api/v1/articles/[id]/chat/route';
import { DELETE as forget, POST as events } from '@/app/api/v1/events/route';
import { GET as feed } from '@/app/api/v1/feed/route';
import { params, request, setupApiTest, signedInCookie } from './helpers';

let db: Db;
let close: () => Promise<void>;
let politics: string;
let sport: string;
const anon = 'nm_aid=3f1c2a4e-9b7d-4c1e-8a2f-0b6d5e4c3a21';

beforeAll(async () => {
  ({ db, close } = await setupApiTest());
  const sourceId = (await createSource(db)).id;
  politics = (
    await createPublishedArticle(db, {
      sourceId,
      topicSlugs: ['politics'],
      publishedAt: new Date(Date.now() - 3_600_000),
    })
  ).id;
  sport = (
    await createPublishedArticle(db, {
      sourceId: (await createSource(db)).id,
      topicSlugs: ['sport'],
      publishedAt: new Date(Date.now() - 4 * 3_600_000),
    })
  ).id;
});
afterAll(async () => {
  delete process.env.CHAT_ANTHROPIC_API_KEY;
  resetConfig();
  await close();
});

const beacon = (cookie: string, body: unknown) =>
  events(
    request('/api/v1/events', {
      method: 'POST',
      cookie,
      body: JSON.stringify(body),
      headers: { 'content-type': 'text/plain' },
    }),
  );

describe('reading signals', () => {
  it('stores nothing without consent', async () => {
    const response = await beacon(anon, { events: [{ articleId: sport, kind: 'click' }] });
    expect(response.status).toBe(204);
    expect(await db.select().from(engagementEvents)).toHaveLength(0);
  });

  it('records signals with consent and re-ranks that reader’s feed', async () => {
    const cookie = `${anon}; nm_consent=all`;
    const top = async (c: string) =>
      feedResponseSchema.parse(
        await (await feed(request('/api/v1/feed?locale=bg', { cookie: c }))).json(),
      ).items[0]!.id;
    expect(await top(cookie)).toBe(politics);

    // Other sport stories the reader reads (the ones shown here are new).
    const read = await createPublishedArticle(db, {
      sourceId: (await createSource(db)).id,
      topicSlugs: ['sport'],
      publishedAt: new Date(Date.now() - 48 * 3_600_000),
    });
    expect(
      (
        await beacon(cookie, {
          events: [
            { articleId: read.id, kind: 'click' },
            { articleId: read.id, kind: 'dwell', dwellMs: 90_000 },
          ],
        })
      ).status,
    ).toBe(204);
    expect(await db.select().from(engagementEvents)).toHaveLength(2);
    expect(await top(cookie)).toBe(sport);
    // Same reader without consent (e.g. withdrawn) gets the neutral order.
    expect(await top(anon)).toBe(politics);
  });

  it('rejects malformed batches and forgets on request', async () => {
    const cookie = `${anon}; nm_consent=all`;
    expect((await beacon(cookie, { events: [{ articleId: 'x', kind: 'click' }] })).status).toBe(
      400,
    );
    expect((await beacon(cookie, { events: [{ articleId: sport, kind: 'buy' }] })).status).toBe(
      400,
    );
    await forget(request('/api/v1/events', { method: 'DELETE', cookie }));
    expect(await db.select().from(engagementEvents)).toHaveLength(0);
  });
});

describe('ask this article (route)', () => {
  const ask = (cookie: string | undefined, body: unknown, id = politics) =>
    chat(
      request(`/api/v1/articles/${id}/chat`, {
        method: 'POST',
        cookie,
        body: JSON.stringify(body),
      }),
      params({ id }),
    );

  it('requires sign-in and a configured chat key', async () => {
    expect((await ask(undefined, { locale: 'bg', question: 'Какво?' })).status).toBe(401);
    const { cookie } = await signedInCookie(db);
    const disabled = await ask(cookie, { locale: 'bg', question: 'Какво?' });
    expect(disabled.status).toBe(503);
    expect((await disabled.json()).error.code).toBe('disabled');
    expect((await ask(cookie, { locale: 'bg', question: 'x' })).status).toBe(400);
  });

  it('answers through the chat provider (fake Anthropic endpoint)', async () => {
    const calls: { url: string; key: string | null }[] = [];
    const realFetch = globalThis.fetch;
    globalThis.fetch = (async (url: string, init: RequestInit) => {
      calls.push({ url: String(url), key: new Headers(init.headers).get('x-api-key') });
      return new Response(
        JSON.stringify({
          content: [{ type: 'text', text: 'Отговор от статията.' }],
          usage: { input_tokens: 500, output_tokens: 20 },
          stop_reason: 'end_turn',
        }),
      );
    }) as typeof fetch;
    try {
      process.env.CHAT_ANTHROPIC_API_KEY = 'chat-only-key';
      resetConfig();
      const { cookie } = await signedInCookie(db);
      const response = await ask(cookie, { locale: 'bg', question: 'Какво се случи?' });
      expect(response.status).toBe(200);
      expect(chatResponseSchema.parse(await response.json())).toEqual({
        answer: 'Отговор от статията.',
        refused: false,
      });
      expect(calls[0]).toEqual({
        url: 'https://api.anthropic.com/v1/messages',
        key: 'chat-only-key',
      });
    } finally {
      globalThis.fetch = realFetch;
    }
  });
});
