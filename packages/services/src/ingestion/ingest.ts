import { and, eq, gte, inArray, lte } from 'drizzle-orm';
import type { Logger } from 'pino';
import { getConfig } from '@nm/core/config';
import { getLogger } from '@nm/core/logger';
import type { Db } from '@nm/db';
import { articles, sources } from '@nm/db/schema';
import { finishRun, startRun, type RunTrigger } from '../runs';
import { getStorage, type Storage } from '../storage';
import { errorMessage, mapLimit } from '../util';
import { decodeBody } from './decode';
import { extractArticle, extractListingLinks, htmlToText } from './extract';
import { parseFeed, type FeedItem } from './feed';
import { storeImage } from './images';
import { normalizeUrl, titleHash } from './normalize';
import { RobotsCache } from './robots';
import { safeFetch } from './safe-fetch';

export type Source = typeof sources.$inferSelect;

export interface IngestDeps {
  db: Db;
  storage: Storage;
  logger: Logger;
  robots: RobotsCache;
  fetchText: (url: string, accept?: string) => Promise<{ url: string; text: string }>;
  fetchBinary: (url: string) => Promise<{ body: Buffer; contentType: string }>;
  minTextLength: number;
  concurrency: number;
  now: () => Date;
}

export function createIngestDeps(db: Db, overrides: Partial<IngestDeps> = {}): IngestDeps {
  const config = getConfig();
  const base = {
    userAgent: config.INGEST_USER_AGENT,
    timeoutMs: config.INGEST_TIMEOUT_MS,
    allowPrivateNetwork: config.ALLOW_PRIVATE_NETWORK_FETCH,
  };
  const fetchText = async (url: string, accept?: string) => {
    const result = await safeFetch(url, { ...base, accept: accept ?? 'text/html,*/*;q=0.8' });
    return { url: result.url, text: decodeBody(result.body, result.contentType) };
  };
  return {
    db,
    storage: getStorage(),
    logger: getLogger({ service: 'ingest' }),
    robots: new RobotsCache(async (origin) => {
      try {
        return (await fetchText(`${origin}/robots.txt`, 'text/plain')).text;
      } catch {
        return null;
      }
    }, config.INGEST_USER_AGENT),
    fetchText,
    fetchBinary: async (url) => {
      const result = await safeFetch(url, {
        ...base,
        accept: 'image/*',
        maxBytes: 10 * 1024 * 1024,
      });
      return { body: result.body, contentType: result.contentType };
    },
    minTextLength: config.INGEST_MIN_TEXT_LENGTH,
    concurrency: config.INGEST_CONCURRENCY,
    now: () => new Date(),
    ...overrides,
  };
}

export type SkipReason =
  'known_url' | 'robots' | 'no_title' | 'too_short' | 'duplicate_story' | 'error';

export interface PreviewItem {
  title: string | null;
  link: string;
  publishedAt: string | null;
}

export interface SourceIngestResult {
  sourceId: string;
  found: number;
  created: number;
  skipped: Partial<Record<SkipReason, number>>;
  errors: string[];
  /** Dry runs only: what would be ingested, and a sample extraction. */
  preview?: {
    items: PreviewItem[];
    sample?: { url: string; title: string | null; textLength: number; excerpt: string };
  };
}

interface Candidate {
  link: string;
  feed?: FeedItem;
}

async function listCandidates(deps: IngestDeps, source: Source): Promise<Candidate[]> {
  if (source.kind === 'html') {
    if (!source.linkSelector) throw new Error('HTML sources need a link selector');
    const page = await deps.fetchText(source.url);
    return extractListingLinks(page.text, page.url, source.linkSelector).map((link) => ({ link }));
  }
  const feed = await deps.fetchText(
    source.url,
    'application/rss+xml, application/atom+xml, application/xml;q=0.9, */*;q=0.5',
  );
  const items = await parseFeed(feed.text, feed.url);
  return items.map((item) => ({ link: item.link, feed: item }));
}

/** Fetches one source and stores its new articles (status `ingested`). */
export async function ingestSource(
  deps: IngestDeps,
  source: Source,
  options: { dryRun?: boolean } = {},
): Promise<SourceIngestResult> {
  const result: SourceIngestResult = {
    sourceId: source.id,
    found: 0,
    created: 0,
    skipped: {},
    errors: [],
  };
  const skip = (reason: SkipReason) => {
    result.skipped[reason] = (result.skipped[reason] ?? 0) + 1;
  };

  const candidates: Candidate[] = [];
  const seen = new Set<string>();
  for (const candidate of await listCandidates(deps, source)) {
    let normalized: string;
    try {
      normalized = normalizeUrl(candidate.link);
    } catch {
      continue;
    }
    if (seen.has(normalized)) continue;
    seen.add(normalized);
    candidates.push({ ...candidate, link: normalized });
    if (candidates.length >= source.maxItemsPerFetch) break;
  }
  result.found = candidates.length;

  const known = candidates.length
    ? new Set(
        (
          await deps.db
            .select({ url: articles.originalUrl })
            .from(articles)
            .where(
              inArray(
                articles.originalUrl,
                candidates.map((c) => c.link),
              ),
            )
        ).map((row) => row.url),
      )
    : new Set<string>();
  const fresh = candidates.filter((candidate) => {
    if (known.has(candidate.link)) {
      skip('known_url');
      return false;
    }
    return true;
  });

  if (options.dryRun) {
    result.preview = {
      items: fresh.map((c) => ({
        title: c.feed?.title ?? null,
        link: c.link,
        publishedAt: c.feed?.publishedAt?.toISOString() ?? null,
      })),
    };
    const first = fresh[0];
    if (first) {
      try {
        const page = await deps.fetchText(first.link);
        const extracted = extractArticle(page.text, page.url);
        const text = extracted?.text ?? '';
        result.preview.sample = {
          url: first.link,
          title: extracted?.title ?? first.feed?.title ?? null,
          textLength: text.length,
          excerpt: text.slice(0, 400),
        };
      } catch (error) {
        result.errors.push(`${first.link}: ${errorMessage(error)}`);
      }
    }
    return result;
  }

  const duplicateWindow = new Date(deps.now().getTime() - 72 * 3_600_000);
  // Items are processed concurrently. Claim headline hashes up front, in feed order,
  // so the first copy of a story wins and later copies in the same feed are skipped.
  const claimedHashes = new Set<string>();
  const work: (Candidate & { hash?: string })[] = [];
  for (const candidate of fresh) {
    if (candidate.feed?.title) {
      const hash = titleHash(candidate.feed.title);
      if (claimedHashes.has(hash)) {
        skip('duplicate_story');
        continue;
      }
      claimedHashes.add(hash);
      work.push({ ...candidate, hash });
    } else {
      work.push(candidate);
    }
  }

  await mapLimit(work, 3, async (candidate) => {
    try {
      if (!(await deps.robots.isAllowed(candidate.link))) return skip('robots');

      let extracted = null;
      try {
        const page = await deps.fetchText(candidate.link);
        extracted = extractArticle(page.text, page.url);
      } catch (error) {
        deps.logger.debug({ url: candidate.link, err: errorMessage(error) }, 'page fetch failed');
      }
      const text =
        extracted?.text || (candidate.feed?.content ? htmlToText(candidate.feed.content) : '');
      const title = candidate.feed?.title ?? extracted?.title ?? null;
      if (!title) return skip('no_title');
      if (text.length < deps.minTextLength) return skip('too_short');

      let contentHash = candidate.hash;
      if (!contentHash) {
        contentHash = titleHash(title);
        if (claimedHashes.has(contentHash)) return skip('duplicate_story');
        claimedHashes.add(contentHash);
      }
      const [duplicate] = await deps.db
        .select({ id: articles.id })
        .from(articles)
        .where(
          and(eq(articles.contentHash, contentHash), gte(articles.ingestedAt, duplicateWindow)),
        )
        .limit(1);
      if (duplicate) return skip('duplicate_story');

      let imageId: string | null = null;
      const imageUrl = extracted?.imageUrl ?? candidate.feed?.imageUrl ?? null;
      if (source.imagesAllowed && imageUrl) {
        try {
          const image = await deps.fetchBinary(imageUrl);
          if (image.contentType.startsWith('image/')) {
            imageId = (
              await storeImage(deps.db, deps.storage, image.body, {
                originalUrl: imageUrl,
                credit: source.name,
                licenseNote: 'Source permits reuse (images_allowed)',
              })
            ).id;
          }
        } catch (error) {
          deps.logger.debug({ url: imageUrl, err: errorMessage(error) }, 'image skipped');
        }
      }

      const inserted = await deps.db
        .insert(articles)
        .values({
          sourceId: source.id,
          originalUrl: candidate.link,
          originalTitle: title,
          originalLanguage: source.language,
          originalAuthor: candidate.feed?.author ?? extracted?.byline ?? null,
          rawText: text,
          contentHash,
          imageId,
          sourcePublishedAt: candidate.feed?.publishedAt ?? extracted?.publishedAt ?? null,
        })
        .onConflictDoNothing({ target: articles.originalUrl })
        .returning({ id: articles.id });
      if (inserted.length) result.created += 1;
      else skip('known_url');
    } catch (error) {
      skip('error');
      result.errors.push(`${candidate.link}: ${errorMessage(error)}`);
    }
  });

  return result;
}

export interface IngestionSummary {
  runId: string;
  status: 'ok' | 'partial' | 'failed';
  sources: number;
  sourcesFailed: number;
  created: number;
  results: SourceIngestResult[];
}

/** Fetches every due (or explicitly requested) source and records a pipeline run. */
export async function runIngestion(
  deps: IngestDeps,
  options: { trigger: RunTrigger; sourceIds?: string[] },
): Promise<IngestionSummary> {
  const now = deps.now();
  const due = await deps.db
    .select()
    .from(sources)
    .where(
      options.sourceIds?.length
        ? inArray(sources.id, options.sourceIds)
        : and(eq(sources.isActive, true), lte(sources.nextFetchAt, now)),
    );

  const runId = await startRun(deps.db, 'ingest', options.trigger);
  const errors: string[] = [];
  let sourcesFailed = 0;

  const results = await mapLimit(due, deps.concurrency, async (source) => {
    try {
      const result = await ingestSource(deps, source);
      await deps.db
        .update(sources)
        .set({
          lastFetchedAt: now,
          lastStatus: 'ok',
          lastError: result.errors.length ? result.errors.slice(0, 3).join('\n') : null,
          consecutiveFailures: 0,
          nextFetchAt: new Date(now.getTime() + source.fetchIntervalMinutes * 60_000),
        })
        .where(eq(sources.id, source.id));
      return result;
    } catch (error) {
      sourcesFailed += 1;
      const message = errorMessage(error);
      errors.push(`${source.name}: ${message}`);
      const failures = source.consecutiveFailures + 1;
      // Back off exponentially (capped at 8x the interval) so a dead feed is not hammered.
      const backoff = source.fetchIntervalMinutes * Math.min(2 ** failures, 8);
      await deps.db
        .update(sources)
        .set({
          lastFetchedAt: now,
          lastStatus: 'error',
          lastError: message.slice(0, 1000),
          consecutiveFailures: failures,
          nextFetchAt: new Date(now.getTime() + backoff * 60_000),
        })
        .where(eq(sources.id, source.id));
      deps.logger.warn({ source: source.name, err: message }, 'source fetch failed');
      return { sourceId: source.id, found: 0, created: 0, skipped: {}, errors: [message] };
    }
  });

  const created = results.reduce((sum, r) => sum + r.created, 0);
  const status =
    due.length > 0 && sourcesFailed === due.length
      ? 'failed'
      : sourcesFailed > 0
        ? 'partial'
        : 'ok';
  await finishRun(deps.db, runId, {
    status,
    stats: {
      sources: due.length,
      sourcesFailed,
      found: results.reduce((sum, r) => sum + r.found, 0),
      created,
    },
    errors,
  });
  if (due.length) {
    deps.logger.info({ sources: due.length, sourcesFailed, created, status }, 'ingestion finished');
  }
  return { runId, status, sources: due.length, sourcesFailed, created, results };
}
