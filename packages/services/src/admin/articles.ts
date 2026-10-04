import { and, count, desc, eq, ilike, inArray, or, sql, type SQL } from 'drizzle-orm';
import type { Db } from '@nm/db';
import {
  articleCorrections,
  articleLocalizations,
  articles,
  articleTopics,
  images,
  sources,
  topics,
  type ArticleStatus,
  type Locale,
} from '@nm/db/schema';
import { slugify } from '../ai/slug';
import { enqueueJob } from '../jobs/queue';

export class AdminError extends Error {
  constructor(
    public readonly code: 'not_found' | 'correction_note_required' | 'invalid_state' | 'forbidden',
    message?: string,
  ) {
    super(message ?? code);
    this.name = 'AdminError';
  }
}

export const DEFAULT_URGENT_HOURS = 6;

export interface ArticleListFilter {
  status?: ArticleStatus | 'all';
  q?: string;
  sourceId?: string;
  page?: number;
  perPage?: number;
}

/** Review queue / article list for editors. */
export async function listArticlesForAdmin(db: Db, filter: ArticleListFilter) {
  const page = Math.max(1, filter.page ?? 1);
  const perPage = Math.min(100, filter.perPage ?? 30);
  const conditions: SQL[] = [];
  if (filter.status && filter.status !== 'all') conditions.push(eq(articles.status, filter.status));
  if (filter.sourceId) conditions.push(eq(articles.sourceId, filter.sourceId));
  if (filter.q?.trim()) {
    const term = `%${filter.q.trim().replace(/[%_\\]/g, (c) => `\\${c}`)}%`;
    conditions.push(
      or(
        ilike(articles.originalTitle, term),
        sql`exists (select 1 from ${articleLocalizations} where ${articleLocalizations.articleId} = ${articles.id} and ${articleLocalizations.title} ilike ${term})`,
      )!,
    );
  }
  const where = conditions.length ? and(...conditions) : undefined;
  const [total] = await db.select({ n: count() }).from(articles).where(where);
  const rows = await db
    .select({
      id: articles.id,
      status: articles.status,
      priority: articles.priority,
      originalTitle: articles.originalTitle,
      originalLanguage: articles.originalLanguage,
      sourceName: sources.name,
      ingestedAt: articles.ingestedAt,
      publishedAt: articles.publishedAt,
      isUrgent: articles.isUrgent,
      urgentApprovedAt: articles.urgentApprovedAt,
      urgentExpiresAt: articles.urgentExpiresAt,
      reviewReason: articles.reviewReason,
      lastProcessError: articles.lastProcessError,
      titleBg: sql<
        string | null
      >`(select title from ${articleLocalizations} where article_id = ${articles.id} and locale = 'bg')`,
    })
    .from(articles)
    .innerJoin(sources, eq(sources.id, articles.sourceId))
    .where(where)
    .orderBy(desc(articles.ingestedAt))
    .limit(perPage)
    .offset((page - 1) * perPage);
  return { rows, total: total?.n ?? 0, page, perPage };
}

export async function getArticleForEdit(db: Db, id: string) {
  const [row] = await db
    .select({ article: articles, source: sources, image: images })
    .from(articles)
    .innerJoin(sources, eq(sources.id, articles.sourceId))
    .leftJoin(images, eq(images.id, articles.imageId))
    .where(eq(articles.id, id));
  if (!row) return null;
  const [localizations, topicRows, corrections] = await Promise.all([
    db.select().from(articleLocalizations).where(eq(articleLocalizations.articleId, id)),
    db
      .select({ slug: topics.slug })
      .from(articleTopics)
      .innerJoin(topics, eq(topics.id, articleTopics.topicId))
      .where(eq(articleTopics.articleId, id)),
    db
      .select()
      .from(articleCorrections)
      .where(eq(articleCorrections.articleId, id))
      .orderBy(desc(articleCorrections.createdAt)),
  ]);
  return { ...row, localizations, topics: topicRows.map((t) => t.slug), corrections };
}

/** Marks the article as changed so search re-indexes it and caches refresh. */
async function touch(db: Db, id: string) {
  await db.update(articles).set({ indexedAt: null }).where(eq(articles.id, id));
}

/**
 * Saves an editor's text. For published articles a correction note is
 * required and recorded in the public correction log with the previous text.
 */
export async function updateLocalization(
  db: Db,
  input: {
    articleId: string;
    locale: Locale;
    title: string;
    tldr: string;
    body: string;
    editorId: string;
    correctionNote?: string | null;
  },
): Promise<{ correctionLogged: boolean }> {
  const item = await getArticleForEdit(db, input.articleId);
  if (!item) throw new AdminError('not_found');
  const current = item.localizations.find((l) => l.locale === input.locale);
  const title = input.title.trim();
  const tldr = input.tldr.trim();
  const body = input.body.replace(/\r\n?/g, '\n').trim();
  if (!title || !tldr || !body)
    throw new AdminError('invalid_state', 'Title, summary and body are required');
  const changed =
    !current || current.title !== title || current.tldr !== tldr || current.body !== body;
  if (!changed) return { correctionLogged: false };

  const published = item.article.status === 'published';
  const note = input.correctionNote?.trim();
  if (published && current && !note) throw new AdminError('correction_note_required');

  await db.transaction(async (tx) => {
    const values = { title, tldr, body, slug: slugify(title) };
    if (current) {
      await tx
        .update(articleLocalizations)
        .set({ ...values, isTranslation: false, model: 'editor' })
        .where(
          and(
            eq(articleLocalizations.articleId, input.articleId),
            eq(articleLocalizations.locale, input.locale),
          ),
        );
    } else {
      await tx.insert(articleLocalizations).values({
        articleId: input.articleId,
        locale: input.locale,
        ...values,
        isTranslation: false,
        model: 'editor',
      });
    }
    if (published && current && note) {
      await tx.insert(articleCorrections).values({
        articleId: input.articleId,
        locale: input.locale,
        note,
        previousBody: `${current.title}\n\n${current.tldr}\n\n${current.body}`,
        editorId: input.editorId,
      });
    }
    await tx.update(articles).set({ indexedAt: null }).where(eq(articles.id, input.articleId));
  });
  return { correctionLogged: published && !!current };
}

export async function setArticleStatus(
  db: Db,
  id: string,
  status: 'published' | 'rejected',
): Promise<void> {
  const item = await getArticleForEdit(db, id);
  if (!item) throw new AdminError('not_found');
  if (status === 'published' && item.localizations.length === 0) {
    throw new AdminError(
      'invalid_state',
      'An article needs at least one language version before publishing',
    );
  }
  await db
    .update(articles)
    .set({
      status,
      publishedAt:
        status === 'published'
          ? (item.article.publishedAt ?? new Date())
          : item.article.publishedAt,
      reviewReason: status === 'published' ? null : item.article.reviewReason,
      // Hiding an article also ends any urgent status.
      ...(status === 'rejected' ? { isUrgent: false, urgentExpiresAt: new Date() } : {}),
      indexedAt: null,
    })
    .where(eq(articles.id, id));
}

/**
 * The only way an article becomes urgent: an editor's explicit approval.
 * Records who approved it and when, and queues the breaking-news push.
 */
export async function approveUrgent(
  db: Db,
  id: string,
  editorId: string,
  hours = DEFAULT_URGENT_HOURS,
): Promise<void> {
  const item = await getArticleForEdit(db, id);
  if (!item) throw new AdminError('not_found');
  if (item.article.status !== 'published')
    throw new AdminError('invalid_state', 'Only published articles can be marked urgent');
  const now = new Date();
  await db
    .update(articles)
    .set({
      isUrgent: true,
      urgentApprovedBy: editorId,
      urgentApprovedAt: now,
      urgentExpiresAt: new Date(now.getTime() + Math.min(Math.max(hours, 1), 48) * 3_600_000),
      indexedAt: null,
    })
    .where(eq(articles.id, id));
  await enqueueJob(
    db,
    'urgent_push',
    { articleId: id },
    { dedupeKey: `urgent_push:${id}:${now.toISOString().slice(0, 13)}` },
  );
}

export async function clearUrgent(db: Db, id: string): Promise<void> {
  await db
    .update(articles)
    .set({ isUrgent: false, urgentExpiresAt: new Date(), indexedAt: null })
    .where(eq(articles.id, id));
}

export async function setPriority(
  db: Db,
  id: string,
  priority: 'normal' | 'flagship',
): Promise<void> {
  await db.update(articles).set({ priority }).where(eq(articles.id, id));
}

export async function setArticleTopics(db: Db, id: string, slugs: string[]): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.delete(articleTopics).where(eq(articleTopics.articleId, id));
    if (slugs.length) {
      const rows = await tx
        .select({ id: topics.id })
        .from(topics)
        .where(inArray(topics.slug, slugs));
      if (rows.length)
        await tx.insert(articleTopics).values(rows.map((t) => ({ articleId: id, topicId: t.id })));
    }
  });
  await touch(db, id);
}
