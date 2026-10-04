import { and, asc, desc, eq, inArray, lt } from 'drizzle-orm';
import type { Logger } from 'pino';
import { getConfig } from '@nm/core/config';
import { getLogger } from '@nm/core/logger';
import type { Db } from '@nm/db';
import {
  articleLocalizations,
  articles,
  articleTopics,
  sources,
  topics,
  type Locale,
} from '@nm/db/schema';
import { finishRun, startRun, type RunTrigger } from '../runs';
import { errorMessage, mapLimit } from '../util';
import { monthToDateSpend, recordUsage } from './budget';
import { deeplTranslate } from './deepl';
import { copiedShare } from './originality';
import {
  normaliseBody,
  parseModelJson,
  rewriteSchema,
  translationSchema,
  type RewriteOutput,
  type TranslationOutput,
} from './parse';
import {
  invalidJsonReminder,
  rewriteSystemPrompt,
  rewriteUserPrompt,
  translateSystemPrompt,
  translateUserPrompt,
} from './prompts';
import { createProvider, type CompletionRequest, type LlmProvider } from './providers';
import { slugify } from './slug';

export const MAX_PROCESS_ATTEMPTS = 3;
const STALE_PROCESSING_MS = 30 * 60_000;

export interface ProcessDeps {
  db: Db;
  /** null when no provider is configured — processing is skipped and reported. */
  provider: LlmProvider | null;
  providerError?: string;
  logger: Logger;
  maxPerRun: number;
  monthlyBudgetUsd: number;
  similarityThreshold: number;
  deepl?: { apiKey: string; apiUrl: string };
  concurrency: number;
  now: () => Date;
}

export function createProcessDeps(db: Db, overrides: Partial<ProcessDeps> = {}): ProcessDeps {
  const config = getConfig();
  const logger = getLogger({ service: 'ai' });
  let provider: LlmProvider | null = null;
  let providerError: string | undefined;
  if (!('provider' in overrides)) {
    try {
      provider = createProvider(config, (error) =>
        logger.warn({ err: errorMessage(error) }, 'primary LLM unavailable, using fallback'),
      );
    } catch (error) {
      providerError = errorMessage(error);
    }
  }
  return {
    db,
    provider,
    providerError,
    logger,
    maxPerRun: config.LLM_MAX_ARTICLES_PER_RUN,
    monthlyBudgetUsd: config.LLM_MONTHLY_BUDGET_USD,
    similarityThreshold: config.LLM_SIMILARITY_THRESHOLD,
    deepl: config.DEEPL_API_KEY
      ? { apiKey: config.DEEPL_API_KEY, apiUrl: config.DEEPL_API_URL }
      : undefined,
    concurrency: 2,
    now: () => new Date(),
    ...overrides,
  };
}

export interface ProcessSummary {
  status: 'ok' | 'partial' | 'failed' | 'skipped' | 'budget_exceeded';
  runId?: string;
  claimed: number;
  published: number;
  needsReview: number;
  failed: number;
  costUsd: number;
  reason?: string;
}

type Article = typeof articles.$inferSelect;
type Source = typeof sources.$inferSelect;

class Spend {
  constructor(
    public total: number,
    private readonly budget: number,
  ) {}
  get exceeded() {
    return this.total >= this.budget;
  }
}

async function completeJson<T>(
  deps: ProcessDeps,
  request: CompletionRequest,
  parse: (text: string) => T,
  meta: { articleId: string; purpose: 'rewrite' | 'translate' },
  spend: Spend,
): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const result = await deps.provider!.complete(
      attempt === 0 ? request : { ...request, user: request.user + invalidJsonReminder },
    );
    spend.total += await recordUsage(deps.db, result, meta);
    try {
      return parse(result.text);
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError;
}

function localesFor(article: Article): { primary: Locale; secondary: Locale } {
  const primary: Locale = article.originalLanguage === 'en' ? 'en' : 'bg';
  return { primary, secondary: primary === 'bg' ? 'en' : 'bg' };
}

async function processOne(
  deps: ProcessDeps,
  article: Article,
  source: Source,
  topicRows: { id: string; slug: string }[],
  spend: Spend,
): Promise<'published' | 'needs_review'> {
  const { primary, secondary } = localesFor(article);
  const system = rewriteSystemPrompt(topicRows.map((t) => t.slug));
  const userInput = {
    targetLocale: primary,
    sourceName: source.name,
    sourceLanguage: article.originalLanguage,
    originalTitle: article.originalTitle,
    text: article.rawText,
  };
  const parseRewrite = (text: string) => parseModelJson(text, rewriteSchema);
  const meta = { articleId: article.id, purpose: 'rewrite' as const };

  let rewrite: RewriteOutput = await completeJson(
    deps,
    { system, user: rewriteUserPrompt(userInput), maxTokens: 2_000 },
    parseRewrite,
    meta,
    spend,
  );
  let reviewReason: string | null = null;

  // Originality guard (same-language rewrites only — a translation never matches word for word).
  if (primary === article.originalLanguage) {
    let share = copiedShare(rewrite.body, article.rawText);
    if (share > deps.similarityThreshold) {
      const retry = await completeJson(
        deps,
        {
          system,
          user: rewriteUserPrompt({ ...userInput, stricter: true }),
          maxTokens: 2_000,
          temperature: 0.7,
        },
        parseRewrite,
        meta,
        spend,
      );
      const retryShare = copiedShare(retry.body, article.rawText);
      if (retryShare < share) {
        rewrite = retry;
        share = retryShare;
      }
      if (share > deps.similarityThreshold) {
        reviewReason = `too_similar_to_source (${Math.round(share * 100)}% of phrases reused)`;
      }
    }
  }

  const body = normaliseBody(rewrite.body);
  let translation: TranslationOutput & { model: string };
  if (article.priority === 'flagship' && deps.deepl) {
    const result = await deeplTranslate(
      deps.deepl,
      { title: rewrite.title, tldr: rewrite.tldr, body },
      secondary,
      primary,
    );
    translation = { ...result, model: 'deepl' };
  } else {
    const result = await completeJson(
      deps,
      {
        system: translateSystemPrompt(),
        user: translateUserPrompt({
          targetLocale: secondary,
          title: rewrite.title,
          tldr: rewrite.tldr,
          body,
        }),
        maxTokens: 2_000,
        temperature: 0.2,
      },
      (text) => parseModelJson(text, translationSchema),
      { articleId: article.id, purpose: 'translate' },
      spend,
    );
    translation = { ...result, model: deps.provider!.model };
  }

  const bySlug = new Map(topicRows.map((t) => [t.slug, t.id]));
  let topicIds = [
    ...new Set(rewrite.topics.map((slug) => bySlug.get(slug)).filter((id): id is string => !!id)),
  ].slice(0, 3);
  if (topicIds.length === 0) {
    const fallback = source.defaultTopicId ?? bySlug.get('general');
    if (fallback) topicIds = [fallback];
  }

  const now = deps.now();
  const localizations = [
    {
      locale: primary,
      title: rewrite.title,
      tldr: rewrite.tldr,
      body,
      isTranslation: false,
      model: deps.provider!.model,
    },
    {
      locale: secondary,
      title: translation.title,
      tldr: translation.tldr,
      body: normaliseBody(translation.body),
      isTranslation: true,
      model: translation.model,
    },
  ];

  await deps.db.transaction(async (tx) => {
    for (const l of localizations) {
      const values = { articleId: article.id, ...l, slug: slugify(l.title) };
      await tx
        .insert(articleLocalizations)
        .values(values)
        .onConflictDoUpdate({
          target: [articleLocalizations.articleId, articleLocalizations.locale],
          set: {
            title: values.title,
            slug: values.slug,
            tldr: values.tldr,
            body: values.body,
            isTranslation: values.isTranslation,
            model: values.model,
          },
        });
    }
    await tx.delete(articleTopics).where(eq(articleTopics.articleId, article.id));
    if (topicIds.length) {
      await tx
        .insert(articleTopics)
        .values(topicIds.map((topicId) => ({ articleId: article.id, topicId })));
    }
    await tx
      .update(articles)
      .set({
        status: reviewReason ? 'needs_review' : 'published',
        reviewReason,
        publishedAt: reviewReason ? article.publishedAt : (article.publishedAt ?? now),
        isAiRewritten: true,
        processAttempts: article.processAttempts + 1,
        lastProcessError: null,
        indexedAt: null,
      })
      .where(eq(articles.id, article.id));
  });
  return reviewReason ? 'needs_review' : 'published';
}

/**
 * Rewrites claimed `ingested` articles into Bulgarian and English. Flagship
 * articles go first. Spend is capped per run and per calendar month.
 */
export async function processArticles(
  deps: ProcessDeps,
  options: { trigger: RunTrigger; articleIds?: string[] },
): Promise<ProcessSummary> {
  const empty = { claimed: 0, published: 0, needsReview: 0, failed: 0, costUsd: 0 };
  if (!deps.provider) {
    return {
      status: 'skipped',
      ...empty,
      reason: deps.providerError ?? 'No LLM provider configured',
    };
  }
  const now = deps.now();

  // Articles left in `processing` by a crashed worker go back to the queue.
  await deps.db
    .update(articles)
    .set({ status: 'ingested' })
    .where(
      and(
        eq(articles.status, 'processing'),
        lt(articles.updatedAt, new Date(now.getTime() - STALE_PROCESSING_MS)),
      ),
    );

  const spend = new Spend(await monthToDateSpend(deps.db, now), deps.monthlyBudgetUsd);
  if (spend.exceeded) {
    const runId = await startRun(deps.db, 'process', options.trigger);
    const reason = `Monthly LLM budget reached ($${spend.total.toFixed(2)} of $${deps.monthlyBudgetUsd})`;
    await finishRun(deps.db, runId, { status: 'failed', stats: { claimed: 0 }, errors: [reason] });
    deps.logger.error(
      { spent: spend.total, budget: deps.monthlyBudgetUsd },
      'LLM budget exhausted',
    );
    return { status: 'budget_exceeded', runId, ...empty, reason };
  }

  const claimed = await deps.db.transaction(async (tx) => {
    const candidates = tx
      .select({ id: articles.id })
      .from(articles)
      .where(
        options.articleIds?.length
          ? and(inArray(articles.id, options.articleIds), eq(articles.status, 'ingested'))
          : eq(articles.status, 'ingested'),
      )
      .orderBy(desc(articles.priority), asc(articles.ingestedAt))
      .limit(deps.maxPerRun)
      .for('update', { skipLocked: true });
    return tx
      .update(articles)
      .set({ status: 'processing' })
      .where(inArray(articles.id, candidates))
      .returning();
  });
  if (claimed.length === 0) return { status: 'ok', ...empty };

  const runId = await startRun(deps.db, 'process', options.trigger);
  const sourceRows = await deps.db
    .select()
    .from(sources)
    .where(inArray(sources.id, [...new Set(claimed.map((a) => a.sourceId))]));
  const sourceById = new Map(sourceRows.map((s) => [s.id, s]));
  const topicRows = await deps.db
    .select({ id: topics.id, slug: topics.slug })
    .from(topics)
    .where(eq(topics.isActive, true))
    .orderBy(asc(topics.sortOrder));

  const startSpend = spend.total;
  const counts = { published: 0, needsReview: 0, failed: 0, released: 0 };
  const errors: string[] = [];

  await mapLimit(claimed, deps.concurrency, async (article) => {
    if (spend.exceeded) {
      counts.released += 1;
      await deps.db.update(articles).set({ status: 'ingested' }).where(eq(articles.id, article.id));
      return;
    }
    try {
      const outcome = await processOne(
        deps,
        article,
        sourceById.get(article.sourceId)!,
        topicRows,
        spend,
      );
      if (outcome === 'published') counts.published += 1;
      else counts.needsReview += 1;
    } catch (error) {
      counts.failed += 1;
      const message = errorMessage(error);
      errors.push(`${article.id}: ${message}`);
      const attempts = article.processAttempts + 1;
      await deps.db
        .update(articles)
        .set({
          status: attempts >= MAX_PROCESS_ATTEMPTS ? 'failed' : 'ingested',
          processAttempts: attempts,
          lastProcessError: message.slice(0, 2000),
        })
        .where(eq(articles.id, article.id));
      deps.logger.warn(
        { articleId: article.id, attempts, err: message },
        'article processing failed',
      );
    }
  });

  const costUsd = spend.total - startSpend;
  const status = counts.failed === claimed.length ? 'failed' : counts.failed > 0 ? 'partial' : 'ok';
  await finishRun(deps.db, runId, {
    status,
    stats: {
      claimed: claimed.length,
      published: counts.published,
      needsReview: counts.needsReview,
      failed: counts.failed,
      released: counts.released,
      costMicroUsd: Math.round(costUsd * 1_000_000),
    },
    errors,
  });
  deps.logger.info({ ...counts, claimed: claimed.length, costUsd }, 'processing finished');
  return {
    status: spend.exceeded && counts.released > 0 ? 'budget_exceeded' : status,
    runId,
    claimed: claimed.length,
    published: counts.published,
    needsReview: counts.needsReview,
    failed: counts.failed,
    costUsd,
  };
}

/** Puts articles back into the queue (admin "reprocess", CLI). */
export async function requeueArticles(db: Db, articleIds: string[]): Promise<number> {
  if (articleIds.length === 0) return 0;
  const rows = await db
    .update(articles)
    .set({ status: 'ingested', processAttempts: 0, lastProcessError: null })
    .where(inArray(articles.id, articleIds))
    .returning({ id: articles.id });
  return rows.length;
}
