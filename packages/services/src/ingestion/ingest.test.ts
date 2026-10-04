import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { eq } from 'drizzle-orm';
import sharp from 'sharp';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { resetConfig } from '@nm/core/config';
import type { Db } from '@nm/db';
import { articles, images, pipelineRuns, sources } from '@nm/db/schema';
import { createTestDb } from '@nm/db/testing';
import { LocalStorage } from '../storage';
import { articleHtml, rssFeed } from '../testing/fixtures';
import { startFixtureServer } from '../testing/server';
import { createIngestDeps, ingestSource, runIngestion, type IngestDeps } from './ingest';

let db: Db;
let closeDb: () => Promise<void>;
let server: Awaited<ReturnType<typeof startFixtureServer>>;
let mediaDir: string;
let deps: IngestDeps;

const englishParagraphs = [
  'The city council approved a new plan for public transport on Tuesday after months of consultation with residents and operators.',
  'The plan adds three tram lines, extends night bus services and introduces a single ticket valid across every mode of transport.',
  'Officials said the first changes would take effect next spring, with the full network expected to be complete within four years.',
  'Critics argued that the budget was optimistic and asked for an independent review of the projected passenger numbers before work begins.',
];

beforeAll(async () => {
  process.env.ALLOW_PRIVATE_NETWORK_FETCH = 'true';
  process.env.APP_ENV = 'test';
  resetConfig();
  ({ db, close: closeDb } = await createTestDb());
  mediaDir = await mkdtemp(path.join(tmpdir(), 'nm-media-'));
  const png = await sharp({
    create: { width: 1600, height: 900, channels: 3, background: { r: 30, g: 90, b: 160 } },
  })
    .png()
    .toBuffer();

  server = await startFixtureServer({
    '/robots.txt': { type: 'text/plain', body: 'User-agent: *\nDisallow: /private/' },
    '/rss': () => ({
      type: 'application/rss+xml',
      body: rssFeed([
        {
          title: 'Парламентът прие промени в данъците',
          link: `${server.base}/a/1?utm_source=rss`,
          date: 'Wed, 01 Oct 2026 08:00:00 GMT',
        },
        { title: 'Парламентът прие промени в данъците!', link: `${server.base}/a/2` },
        { title: 'Кратка бележка', link: `${server.base}/a/3` },
        { title: 'Скрита статия', link: `${server.base}/private/4` },
        {
          title: 'Само в RSS',
          link: `${server.base}/a/missing`,
          description: `<p>${'Дълъг текст от емисията. '.repeat(30)}</p>`,
        },
      ]),
    }),
    '/a/1': {
      body: articleHtml({ title: 'Парламентът прие промени в данъците', image: '/img/1.png' }),
    },
    '/a/2': { body: articleHtml({ title: 'Парламентът прие промени в данъците' }) },
    '/a/3': {
      body: articleHtml({ title: 'Кратка бележка', paragraphs: ['Само едно изречение тук.'] }),
    },
    '/private/4': { body: articleHtml({ title: 'Скрита статия' }) },
    '/img/1.png': { type: 'image/png', body: png },
    '/list': {
      body: `<html><body><section class="latest"><a href="/en/1">One</a><a href="/en/2">Two</a></section><a href="/about">About</a></body></html>`,
    },
    '/en/1': {
      body: articleHtml({
        title: 'City approves transport plan',
        lang: 'en',
        paragraphs: englishParagraphs,
      }),
    },
    '/en/2': {
      body: articleHtml({
        title: 'Second English story',
        lang: 'en',
        paragraphs: englishParagraphs.slice().reverse(),
      }),
    },
  });

  deps = createIngestDeps(db, {
    storage: new LocalStorage(mediaDir, '/media'),
    minTextLength: 300,
  });
});

afterAll(async () => {
  await server.close();
  await closeDb();
  await rm(mediaDir, { recursive: true, force: true });
});

async function addSource(values: Partial<typeof sources.$inferInsert> & { url: string }) {
  const [row] = await db
    .insert(sources)
    .values({ name: 'Fixture', language: 'bg', ...values })
    .returning();
  return row!;
}

describe('ingestSource', () => {
  it('previews a source without writing anything (admin "test fetch")', async () => {
    const source = await addSource({ url: `${server.base}/rss`, name: 'Preview' });
    const result = await ingestSource(deps, source, { dryRun: true });
    expect(result.found).toBe(5);
    expect(result.preview?.items[0]?.title).toBe('Парламентът прие промени в данъците');
    expect(result.preview?.sample?.textLength).toBeGreaterThan(300);
    expect(await db.select().from(articles)).toHaveLength(0);
    await db.delete(sources).where(eq(sources.id, source.id));
  });

  it('stores new articles and explains every skipped item', async () => {
    const source = await addSource({ url: `${server.base}/rss`, imagesAllowed: true });
    const result = await ingestSource(deps, source);

    expect(result.created).toBe(2); // /a/1 and the RSS-only item
    expect(result.skipped).toMatchObject({ duplicate_story: 1, too_short: 1, robots: 1 });

    const stored = await db.select().from(articles).where(eq(articles.sourceId, source.id));
    const first = stored.find((a) => a.originalUrl.endsWith('/a/1'))!;
    expect(first.originalUrl).toBe(`${server.base}/a/1`); // tracking params stripped
    expect(first.status).toBe('ingested');
    expect(first.rawText).toContain('Народното събрание');
    expect(first.originalLanguage).toBe('bg');
    expect(first.sourcePublishedAt?.toISOString()).toBe('2026-10-01T08:00:00.000Z');

    // Licensed source: image downloaded and converted to two webp renditions.
    expect(first.imageId).not.toBeNull();
    const [image] = await db.select().from(images).where(eq(images.id, first.imageId!));
    expect(image!.width).toBe(1280);
    const files = await readdir(path.join(mediaDir, 'img'), { recursive: true });
    expect(files.filter((f) => String(f).endsWith('.webp'))).toHaveLength(2);

    const rssOnly = stored.find((a) => a.originalUrl.endsWith('/a/missing'))!;
    expect(rssOnly.rawText).toContain('Дълъг текст от емисията');
  });

  it('does not create duplicates on a second run', async () => {
    const [source] = await db
      .select()
      .from(sources)
      .where(eq(sources.url, `${server.base}/rss`));
    const result = await ingestSource(deps, source!);
    expect(result.created).toBe(0);
    expect(result.skipped.known_url).toBe(2);
  });

  it('never downloads images from sources that are not licensed for reuse', async () => {
    const source = await addSource({
      url: `${server.base}/list`,
      kind: 'html',
      linkSelector: '.latest a',
      language: 'en',
    });
    const result = await ingestSource(deps, source);
    expect(result.created).toBe(2);
    const stored = await db.select().from(articles).where(eq(articles.sourceId, source.id));
    expect(stored.every((a) => a.imageId === null)).toBe(true);
    expect(stored.map((a) => a.originalLanguage)).toEqual(['en', 'en']);
    expect(server.hits.get('/about')).toBeUndefined();
  });
});

describe('runIngestion', () => {
  it('fetches only due sources, schedules the next fetch and records the run', async () => {
    const broken = await addSource({ url: `${server.base}/does-not-exist`, name: 'Broken' });
    await db
      .update(sources)
      .set({ nextFetchAt: new Date(Date.now() + 3_600_000) })
      .where(eq(sources.name, 'Fixture'));

    const summary = await runIngestion(deps, { trigger: 'manual' });
    expect(summary.sources).toBe(1);
    expect(summary.status).toBe('failed');

    const [after] = await db.select().from(sources).where(eq(sources.id, broken.id));
    expect(after!.lastStatus).toBe('error');
    expect(after!.consecutiveFailures).toBe(1);
    // exponential backoff: 60 min interval * 2
    expect(after!.nextFetchAt.getTime() - Date.now()).toBeGreaterThan(110 * 60_000);

    const [run] = await db.select().from(pipelineRuns).where(eq(pipelineRuns.id, summary.runId));
    expect(run).toMatchObject({ kind: 'ingest', trigger: 'manual', status: 'failed' });
    expect(run!.errorSummary).toContain('Broken');
  });

  it('can be pointed at specific sources regardless of schedule', async () => {
    const [html] = await db.select().from(sources).where(eq(sources.kind, 'html'));
    const summary = await runIngestion(deps, { trigger: 'manual', sourceIds: [html!.id] });
    expect(summary).toMatchObject({ sources: 1, sourcesFailed: 0, status: 'ok' });
    const [after] = await db.select().from(sources).where(eq(sources.id, html!.id));
    expect(after!.lastStatus).toBe('ok');
    expect(after!.nextFetchAt.getTime()).toBeGreaterThan(Date.now() + 55 * 60_000);
  });
});
