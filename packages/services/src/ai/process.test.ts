import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { and, eq, sql } from 'drizzle-orm';
import { pino } from 'pino';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Db } from '@nm/db';
import {
  articleLocalizations,
  articles,
  articleTopics,
  llmUsage,
  pipelineRuns,
  sources,
  topics,
} from '@nm/db/schema';
import { seedTopics } from '@nm/db/seed';
import { createTestDb } from '@nm/db/testing';
import {
  FakeProvider,
  rewriteAnswer,
  translationAnswer,
  type FakeHandler,
} from '../testing/fake-llm';
import { longBgParagraphs } from '../testing/fixtures';
import { createProcessDeps, processArticles, type ProcessDeps } from './process';

let db: Db;
let close: () => Promise<void>;
let bgSource: typeof sources.$inferSelect;
let enSource: typeof sources.$inferSelect;
let topicIds: Record<string, string>;

const isTranslation = (system: string) => system.includes('news translator');
const happy: FakeHandler = (request) =>
  isTranslation(request.system) ? translationAnswer() : rewriteAnswer();

function deps(provider: FakeProvider | null, overrides: Partial<ProcessDeps> = {}): ProcessDeps {
  return createProcessDeps(db, {
    provider,
    logger: pino({ level: 'silent' }),
    maxPerRun: 10,
    monthlyBudgetUsd: 100,
    similarityThreshold: 0.2,
    deepl: undefined,
    ...overrides,
  });
}

let counter = 0;
async function addArticle(overrides: Partial<typeof articles.$inferInsert> = {}) {
  counter += 1;
  const [row] = await db
    .insert(articles)
    .values({
      sourceId: bgSource.id,
      originalUrl: `https://example.bg/a/${counter}`,
      originalTitle: 'Парламентът прие промени в данъците',
      originalLanguage: 'bg',
      rawText: longBgParagraphs.join('\n\n'),
      contentHash: `hash-${counter}`,
      ...overrides,
    })
    .returning();
  return row!;
}

async function reload(id: string) {
  const [row] = await db.select().from(articles).where(eq(articles.id, id));
  return row!;
}

beforeAll(async () => {
  ({ db, close } = await createTestDb());
  await seedTopics(db);
  topicIds = Object.fromEntries((await db.select().from(topics)).map((t) => [t.slug, t.id]));
  [bgSource] = (await db
    .insert(sources)
    .values({
      name: 'Дневник',
      url: 'https://www.dnevnik.bg/rss/',
      language: 'bg',
      defaultTopicId: topicIds.general,
    })
    .returning()) as [typeof sources.$inferSelect];
  [enSource] = (await db
    .insert(sources)
    .values({
      name: 'BBC',
      url: 'https://feeds.bbci.co.uk/news/rss.xml',
      language: 'en',
      defaultTopicId: topicIds.tech,
    })
    .returning()) as [typeof sources.$inferSelect];
});
afterAll(async () => close());

beforeEach(async () => {
  // Each test starts with an empty queue and no spend.
  await db.delete(llmUsage);
  await db.update(articles).set({ status: 'rejected' }).where(eq(articles.status, 'ingested'));
});

describe('processArticles', () => {
  it('rewrites a Bulgarian article, translates it to English and publishes it', async () => {
    const article = await addArticle();
    const provider = new FakeProvider(happy);
    const summary = await processArticles(deps(provider), { trigger: 'manual' });

    expect(summary).toMatchObject({
      status: 'ok',
      claimed: 1,
      published: 1,
      needsReview: 0,
      failed: 0,
    });
    expect(summary.costUsd).toBeCloseTo((2 * (2_000 * 1 + 800 * 5)) / 1_000_000, 6);

    const after = await reload(article.id);
    expect(after).toMatchObject({
      status: 'published',
      isAiRewritten: true,
      processAttempts: 1,
      indexedAt: null,
    });
    expect(after.publishedAt).not.toBeNull();

    const locs = await db
      .select()
      .from(articleLocalizations)
      .where(eq(articleLocalizations.articleId, article.id));
    const bg = locs.find((l) => l.locale === 'bg')!;
    const en = locs.find((l) => l.locale === 'en')!;
    expect(bg).toMatchObject({
      isTranslation: false,
      slug: 'deputatite-odobriha-novi-pravila-za-mestnite-danatsi',
    });
    expect(en).toMatchObject({
      isTranslation: true,
      title: 'MPs approve new rules for local taxes',
      slug: 'mps-approve-new-rules-for-local-taxes',
    });
    expect(bg.body.split('\n\n')).toHaveLength(4);

    const tagged = await db
      .select()
      .from(articleTopics)
      .where(eq(articleTopics.articleId, article.id));
    expect(tagged.map((t) => t.topicId).sort()).toEqual(
      [topicIds.politics, topicIds.business].sort(),
    );

    // Prompts: rewrite in Bulgarian with the source named; translation into English.
    expect(provider.calls[0]!.user).toContain('Write the report in Bulgarian');
    expect(provider.calls[0]!.user).toContain('Source outlet: Дневник');
    expect(provider.calls[0]!.system).toContain('politics, business, tech, culture, sport');
    expect(provider.calls[1]!.user).toContain('Translate into English');

    const usage = await db.select().from(llmUsage).where(eq(llmUsage.articleId, article.id));
    expect(usage.map((u) => u.purpose).sort()).toEqual(['rewrite', 'translate']);
    const [run] = await db.select().from(pipelineRuns).where(eq(pipelineRuns.id, summary.runId!));
    expect(run).toMatchObject({ kind: 'process', status: 'ok' });
  });

  it('writes English first for English sources and translates into Bulgarian', async () => {
    const article = await addArticle({
      sourceId: enSource.id,
      originalLanguage: 'en',
      originalTitle: 'Budget passes',
    });
    const provider = new FakeProvider(happy);
    await processArticles(deps(provider), { trigger: 'manual' });
    expect(provider.calls[0]!.user).toContain('Write the report in English');
    expect(provider.calls[1]!.user).toContain('Translate into Bulgarian');
    const [en] = await db
      .select()
      .from(articleLocalizations)
      .where(
        and(eq(articleLocalizations.articleId, article.id), eq(articleLocalizations.locale, 'en')),
      );
    expect(en!.isTranslation).toBe(false);
  });

  it('asks again once when the model answers with invalid JSON', async () => {
    const article = await addArticle();
    const provider = new FakeProvider((request, call) =>
      call === 1 ? 'Sorry, here is the article: ...' : happy(request, call),
    );
    const summary = await processArticles(deps(provider), { trigger: 'manual' });
    expect(summary.published).toBe(1);
    expect(provider.calls).toHaveLength(3);
    expect(provider.calls[1]!.user).toContain('not a valid JSON');
    expect((await reload(article.id)).status).toBe('published');
  });

  it('returns failing articles to the queue and gives up after three attempts', async () => {
    const article = await addArticle();
    const broken = () => new FakeProvider(() => 'not json');
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      const summary = await processArticles(deps(broken()), { trigger: 'manual' });
      expect(summary.failed).toBe(1);
      const after = await reload(article.id);
      expect(after.processAttempts).toBe(attempt);
      expect(after.status).toBe(attempt < 3 ? 'ingested' : 'failed');
      expect(after.lastProcessError).toMatch(/No JSON/);
    }
  });

  it('sends near-copies of the source to editorial review', async () => {
    const article = await addArticle();
    const copied = rewriteAnswer({ body: longBgParagraphs.join('\n\n') });
    const provider = new FakeProvider((request) =>
      isTranslation(request.system) ? translationAnswer() : copied,
    );
    const summary = await processArticles(deps(provider), { trigger: 'manual' });
    expect(summary).toMatchObject({ published: 0, needsReview: 1 });
    expect(provider.calls[1]!.user).toContain('reused too much of the source wording');
    const after = await reload(article.id);
    expect(after.status).toBe('needs_review');
    expect(after.reviewReason).toMatch(/too_similar_to_source/);
    expect(after.publishedAt).toBeNull();
  });

  it("falls back to the source's default topic when the model picks none it knows", async () => {
    const article = await addArticle();
    const provider = new FakeProvider((request) =>
      isTranslation(request.system)
        ? translationAnswer()
        : rewriteAnswer({ topics: ['astrology'] }),
    );
    await processArticles(deps(provider), { trigger: 'manual' });
    const tagged = await db
      .select()
      .from(articleTopics)
      .where(eq(articleTopics.articleId, article.id));
    expect(tagged.map((t) => t.topicId)).toEqual([topicIds.general]);
  });

  it('respects the per-run cap and processes flagship articles first', async () => {
    const normal = await addArticle();
    const flagship = await addArticle({ priority: 'flagship' });
    const summary = await processArticles(deps(new FakeProvider(happy), { maxPerRun: 1 }), {
      trigger: 'manual',
    });
    expect(summary.claimed).toBe(1);
    expect((await reload(flagship.id)).status).toBe('published');
    expect((await reload(normal.id)).status).toBe('ingested');
  });

  it('stops before spending once the monthly budget is used up', async () => {
    const article = await addArticle();
    await db
      .insert(llmUsage)
      .values({ purpose: 'rewrite', provider: 'fake', model: 'm', costUsd: 5.5 });
    const provider = new FakeProvider(happy);
    const summary = await processArticles(deps(provider, { monthlyBudgetUsd: 5 }), {
      trigger: 'schedule',
    });
    expect(summary.status).toBe('budget_exceeded');
    expect(provider.calls).toHaveLength(0);
    expect((await reload(article.id)).status).toBe('ingested');
    const [run] = await db.select().from(pipelineRuns).where(eq(pipelineRuns.id, summary.runId!));
    expect(run!.errorSummary).toContain('budget');
  });

  it('recovers articles left in processing by a crashed worker', async () => {
    const article = await addArticle({ status: 'processing' });
    await db.execute(
      sql`update articles set updated_at = now() - interval '2 hours' where id = ${article.id}`,
    );
    await processArticles(deps(new FakeProvider(happy)), { trigger: 'manual' });
    expect((await reload(article.id)).status).toBe('published');
  });

  it('reports instead of failing when no provider is configured', async () => {
    const summary = await processArticles(
      deps(null, { providerError: 'ANTHROPIC_API_KEY is not set' }),
      { trigger: 'schedule' },
    );
    expect(summary).toMatchObject({ status: 'skipped', reason: 'ANTHROPIC_API_KEY is not set' });
  });
});

describe('flagship translation with DeepL', () => {
  let server: ReturnType<typeof createServer>;
  let base = '';
  const bodies: string[] = [];
  beforeAll(async () => {
    server = createServer((req, res) => {
      let raw = '';
      req.on('data', (c) => (raw += c));
      req.on('end', () => {
        bodies.push(raw);
        const texts = new URLSearchParams(raw).getAll('text');
        res
          .writeHead(200, { 'content-type': 'application/json' })
          .end(JSON.stringify({ translations: texts.map((t) => ({ text: `[EN] ${t}` })) }));
      });
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/v2`;
  });
  afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

  it('uses DeepL instead of the LLM for the second language', async () => {
    const article = await addArticle({ priority: 'flagship' });
    const provider = new FakeProvider(happy);
    await processArticles(deps(provider, { deepl: { apiKey: 'key:fx', apiUrl: base } }), {
      trigger: 'manual',
    });
    expect(provider.calls).toHaveLength(1); // rewrite only
    expect(new URLSearchParams(bodies[0]).get('target_lang')).toBe('EN-GB');
    const [en] = await db
      .select()
      .from(articleLocalizations)
      .where(
        and(eq(articleLocalizations.articleId, article.id), eq(articleLocalizations.locale, 'en')),
      );
    expect(en).toMatchObject({ model: 'deepl', isTranslation: true });
    expect(en!.title.startsWith('[EN] ')).toBe(true);
  });
});
