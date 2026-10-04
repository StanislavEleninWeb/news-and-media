import { and, eq, inArray } from 'drizzle-orm';
import type { Db } from '@nm/db';
import {
  articleLocalizations,
  articles,
  articleTopics,
  images,
  sources,
  topics,
  type Locale,
} from '@nm/db/schema';
import type { CollectionSchema } from './typesense';

/** One search document per article *and* locale. */
export interface ArticleDocument {
  id: string;
  article_id: string;
  locale: Locale;
  title: string;
  tldr: string;
  body: string;
  slug: string;
  topics: string[];
  source: string;
  source_id: string;
  image?: string;
  published_at: number;
  is_urgent: boolean;
}

export function articleCollectionSchema(name: string): CollectionSchema {
  return {
    name,
    fields: [
      { name: 'article_id', type: 'string' },
      { name: 'locale', type: 'string', facet: true },
      { name: 'title', type: 'string' },
      { name: 'tldr', type: 'string' },
      { name: 'body', type: 'string' },
      { name: 'slug', type: 'string', index: false, optional: true },
      { name: 'topics', type: 'string[]', facet: true },
      { name: 'source', type: 'string', facet: true },
      { name: 'source_id', type: 'string' },
      { name: 'image', type: 'string', index: false, optional: true },
      { name: 'published_at', type: 'int64', sort: true },
      { name: 'is_urgent', type: 'bool' },
    ],
    default_sorting_field: 'published_at',
  };
}

export const documentId = (articleId: string, locale: Locale) => `${articleId}_${locale}`;

const MAX_BODY_CHARS = 8_000;

/** Search documents for the given articles; only published articles produce documents. */
export async function buildDocuments(db: Db, articleIds: string[]): Promise<ArticleDocument[]> {
  if (articleIds.length === 0) return [];
  const rows = await db
    .select({
      articleId: articles.id,
      publishedAt: articles.publishedAt,
      isUrgent: articles.isUrgent,
      urgentApprovedAt: articles.urgentApprovedAt,
      locale: articleLocalizations.locale,
      title: articleLocalizations.title,
      tldr: articleLocalizations.tldr,
      body: articleLocalizations.body,
      slug: articleLocalizations.slug,
      sourceName: sources.name,
      sourceId: sources.id,
      image: images.storageKeyThumb,
    })
    .from(articles)
    .innerJoin(articleLocalizations, eq(articleLocalizations.articleId, articles.id))
    .innerJoin(sources, eq(sources.id, articles.sourceId))
    .leftJoin(images, eq(images.id, articles.imageId))
    .where(and(inArray(articles.id, articleIds), eq(articles.status, 'published')));

  const topicRows = await db
    .select({ articleId: articleTopics.articleId, slug: topics.slug })
    .from(articleTopics)
    .innerJoin(topics, eq(topics.id, articleTopics.topicId))
    .where(inArray(articleTopics.articleId, articleIds));
  const topicsByArticle = new Map<string, string[]>();
  for (const row of topicRows) {
    topicsByArticle.set(row.articleId, [...(topicsByArticle.get(row.articleId) ?? []), row.slug]);
  }

  return rows.map((row) => ({
    id: documentId(row.articleId, row.locale),
    article_id: row.articleId,
    locale: row.locale,
    title: row.title,
    tldr: row.tldr,
    body: row.body.slice(0, MAX_BODY_CHARS),
    slug: row.slug,
    topics: topicsByArticle.get(row.articleId) ?? [],
    source: row.sourceName,
    source_id: row.sourceId,
    ...(row.image ? { image: row.image } : {}),
    published_at: Math.floor((row.publishedAt ?? new Date()).getTime() / 1000),
    is_urgent: row.isUrgent && row.urgentApprovedAt !== null,
  }));
}
