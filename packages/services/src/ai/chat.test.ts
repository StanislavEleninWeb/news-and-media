import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { envSchema } from '@nm/core/config';
import type { Db } from '@nm/db';
import { llmUsage, users } from '@nm/db/schema';
import { seedTopics } from '@nm/db/seed';
import { createTestDb } from '@nm/db/testing';
import { createPublishedArticle, createSource } from '../testing/content';
import { FakeProvider } from '../testing/fake-llm';
import { monthToDateSpend, recordUsage } from './budget';
import { askArticle, NOT_IN_ARTICLE } from './chat';
import { createChatProvider } from './providers';

let db: Db;
let close: () => Promise<void>;
let articleId: string;
let otherArticleText: string;
let userId: string;
const config = (extra: Record<string, string> = {}) =>
  envSchema.parse({ APP_ENV: 'development', CHAT_ANTHROPIC_API_KEY: 'chat-key', ...extra });

/** Stands in for the model: answers from the system prompt's article only. */
const grounded = new FakeProvider((request) => {
  if (/кога|when/i.test(request.user) && request.system.includes('1 януари 2027'))
    return 'Промените влизат в сила от 1 януари 2027 г.';
  return NOT_IN_ARTICLE;
});

beforeAll(async () => {
  ({ db, close } = await createTestDb());
  await seedTopics(db);
  const sourceId = (await createSource(db, { name: 'БТА' })).id;
  articleId = (
    await createPublishedArticle(db, {
      sourceId,
      texts: {
        bg: {
          title: 'Парламентът прие промени в местните данъци',
          tldr: 'Общините получават повече свобода.',
          body: 'Депутатите приеха промените на второ четене.\n\nТе влизат в сила от 1 януари 2027 г.',
        },
      },
    })
  ).id;
  otherArticleText = 'Нов стадион в Пловдив';
  await createPublishedArticle(db, { sourceId, texts: { bg: { title: otherArticleText } } });
  userId = (await db.insert(users).values({ email: 'chat@example.bg' }).returning())[0]!.id;
});
afterAll(async () => close());

const ask = (
  question: string,
  extra: Partial<Parameters<typeof askArticle>[2]> = {},
  cfg = config(),
) =>
  askArticle(
    db,
    grounded,
    { articleId, locale: 'bg', userId, question, history: [], ...extra },
    cfg,
  );

describe('ask this article', () => {
  it('answers from the article and puts only that article in the context', async () => {
    const result = await ask('Кога влизат в сила промените?');
    expect(result).toEqual({
      ok: true,
      answer: 'Промените влизат в сила от 1 януари 2027 г.',
      refused: false,
    });
    const call = grounded.calls.at(-1)!;
    expect(call.system).toContain('Парламентът прие промени в местните данъци');
    expect(call.system).toContain('Do not use outside knowledge');
    expect(call.system).not.toContain(otherArticleText);
    expect(call.timeoutMs).toBe(30_000);
  });

  it('declines questions the article does not answer', async () => {
    const result = await ask('Кой спечели световното първенство по футбол през 2022?');
    expect(result).toMatchObject({ ok: true, refused: true });
    expect(result.ok && result.answer).toMatch(/не съдържа отговор/);
  });

  it('keeps only recent history and starts it with the reader', async () => {
    const history = Array.from({ length: 10 }, (_, i) => ({
      role: (i % 2 ? 'user' : 'assistant') as 'user' | 'assistant',
      content: `turn ${i}`,
    }));
    await ask('Кога?', { history });
    const sent = grounded.calls.at(-1)!.history!;
    expect(sent.length).toBeLessThanOrEqual(6);
    expect(sent[0]!.role).toBe('user');
  });

  it('meters chat spend separately from the pipeline', async () => {
    const rows = await db.select().from(llmUsage);
    expect(rows.every((r) => r.purpose === 'chat' && r.userId === userId)).toBe(true);
    expect(await monthToDateSpend(db, new Date(), 'chat')).toBeGreaterThan(0);
    expect(await monthToDateSpend(db)).toBe(0);
  });

  it('enforces the per-reader quota and the monthly chat budget', async () => {
    expect(await ask('Кога?', {}, config({ CHAT_MAX_PER_HOUR: '3' }))).toEqual({
      ok: false,
      reason: 'rate_limited',
    });
    expect(await ask('Кога?', {}, config({ CHAT_MONTHLY_BUDGET_USD: '0.001' }))).toEqual({
      ok: false,
      reason: 'budget_exhausted',
    });
  });

  it('reports a missing article, a disabled feature and provider failures', async () => {
    const base = { locale: 'bg' as const, userId, question: 'Кога?', history: [] };
    expect(
      await askArticle(
        db,
        grounded,
        { ...base, articleId: '00000000-0000-4000-8000-000000000000' },
        config(),
      ),
    ).toEqual({ ok: false, reason: 'not_found' });
    expect(await askArticle(db, null, { ...base, articleId }, config())).toEqual({
      ok: false,
      reason: 'disabled',
    });
    const failing = new FakeProvider(() => new Error('down'));
    expect(await askArticle(db, failing, { ...base, articleId }, config())).toEqual({
      ok: false,
      reason: 'provider_error',
    });
  });

  it('uses its own key and never the pipeline key', () => {
    expect(createChatProvider(envSchema.parse({ ANTHROPIC_API_KEY: 'pipeline' }))).toBeNull();
    expect(createChatProvider(config())?.model).toBe('claude-haiku-4-5-20251001');
  });
});

describe('pipeline budget', () => {
  it('excludes chat spend', async () => {
    await recordUsage(
      db,
      {
        text: '',
        usage: { inputTokens: 1_000_000, outputTokens: 0, cacheReadTokens: 0 },
        provider: 'p',
        model: 'm',
        prices: { input: 1, output: 5, cacheRead: 0.1 },
      },
      { articleId: null, purpose: 'rewrite' },
    );
    expect(await monthToDateSpend(db)).toBe(1);
  });
});
