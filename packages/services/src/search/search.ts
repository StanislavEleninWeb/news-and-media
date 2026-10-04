import { and, count, desc, eq, exists, ilike, inArray, or, sql } from 'drizzle-orm';
import { getConfig, type AppConfig } from '@nm/core/config';
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
import { mediaUrl } from '../storage';
import { articleCollectionSchema, type ArticleDocument } from './documents';
import { TypesenseClient } from './typesense';

export interface SearchParams {
  q: string;
  locale: Locale;
  topic?: string;
  page?: number;
  perPage?: number;
}

export interface SearchHit {
  articleId: string;
  locale: Locale;
  title: string;
  tldr: string;
  slug: string;
  source: string;
  topics: string[];
  imageUrl: string | null;
  publishedAt: string;
  isUrgent: boolean;
  /** Highlighted snippet (HTML with <mark>) when the engine provides one. */
  highlight: string | null;
}

export interface SearchResult {
  found: number;
  page: number;
  perPage: number;
  hits: SearchHit[];
  facets: { topics: { slug: string; count: number }[] };
}

/** Write side, used by the sync job. */
export interface SearchIndex {
  ensure(): Promise<void>;
  reset(): Promise<void>;
  upsert(documents: ArticleDocument[]): Promise<void>;
  removeArticles(articleIds: string[]): Promise<void>;
}

/** Read side, used by the API. */
export interface SearchBackend {
  readonly kind: 'typesense' | 'postgres';
  search(params: SearchParams): Promise<SearchResult>;
}

const clampPage = (page?: number) => Math.max(1, Math.floor(page ?? 1));
const clampPerPage = (perPage?: number) => Math.min(50, Math.max(1, Math.floor(perPage ?? 20)));
/** Typesense filter values are wrapped in backticks so slugs never break the filter syntax. */
const filterValue = (value: string) => `\`${value.replace(/`/g, '')}\``;

export class TypesenseSearch implements SearchIndex, SearchBackend {
  readonly kind = 'typesense' as const;
  constructor(
    private readonly client: TypesenseClient,
    readonly collection: string,
  ) {}

  async ensure(): Promise<void> {
    if (!(await this.client.collectionExists(this.collection))) {
      await this.client.createCollection(articleCollectionSchema(this.collection));
    }
  }

  async reset(): Promise<void> {
    await this.client.dropCollection(this.collection);
    await this.client.createCollection(articleCollectionSchema(this.collection));
  }

  upsert(documents: ArticleDocument[]): Promise<void> {
    return this.client.upsert(this.collection, documents);
  }

  async removeArticles(articleIds: string[]): Promise<void> {
    if (articleIds.length === 0) return;
    await this.client.deleteByFilter(
      this.collection,
      `article_id:=[${articleIds.map(filterValue).join(',')}]`,
    );
  }

  async search(params: SearchParams): Promise<SearchResult> {
    const page = clampPage(params.page);
    const perPage = clampPerPage(params.perPage);
    const filters = [`locale:=${filterValue(params.locale)}`];
    if (params.topic) filters.push(`topics:=${filterValue(params.topic)}`);
    const response = await this.client.search<ArticleDocument>(this.collection, {
      q: params.q.trim() || '*',
      query_by: 'title,tldr,body',
      query_by_weights: '4,2,1',
      filter_by: filters.join(' && '),
      sort_by: params.q.trim() ? '_text_match:desc,published_at:desc' : 'published_at:desc',
      facet_by: 'topics',
      highlight_fields: 'tldr,body',
      num_typos: 1,
      page,
      per_page: perPage,
    });
    return {
      found: response.found,
      page,
      perPage,
      hits: response.hits.map(({ document: d, highlight }) => ({
        articleId: d.article_id,
        locale: d.locale,
        title: d.title,
        tldr: d.tldr,
        slug: d.slug,
        source: d.source,
        topics: d.topics,
        imageUrl: mediaUrl(d.image),
        publishedAt: new Date(d.published_at * 1000).toISOString(),
        isUrgent: d.is_urgent,
        highlight: highlight?.tldr?.snippet ?? highlight?.body?.snippet ?? null,
      })),
      facets: {
        topics:
          response.facet_counts
            ?.find((f) => f.field_name === 'topics')
            ?.counts.map((c) => ({ slug: c.value, count: c.count })) ?? [],
      },
    };
  }
}

/**
 * Fallback when Typesense is not configured (local development): simple
 * case-insensitive matching in PostgreSQL. No typo tolerance or relevance ranking.
 */
export class PostgresSearch implements SearchBackend {
  readonly kind = 'postgres' as const;
  constructor(private readonly db: Db) {}

  async search(params: SearchParams): Promise<SearchResult> {
    const page = clampPage(params.page);
    const perPage = clampPerPage(params.perPage);
    const term = `%${params.q.trim().replace(/[%_\\]/g, (c) => `\\${c}`)}%`;
    const conditions = [
      eq(articles.status, 'published'),
      eq(articleLocalizations.locale, params.locale),
    ];
    if (params.q.trim()) {
      conditions.push(
        or(
          ilike(articleLocalizations.title, term),
          ilike(articleLocalizations.tldr, term),
          ilike(articleLocalizations.body, term),
        )!,
      );
    }
    if (params.topic) {
      conditions.push(
        exists(
          this.db
            .select({ one: sql`1` })
            .from(articleTopics)
            .innerJoin(topics, eq(topics.id, articleTopics.topicId))
            .where(and(eq(articleTopics.articleId, articles.id), eq(topics.slug, params.topic))),
        ),
      );
    }
    const where = and(...conditions);
    const [total] = await this.db
      .select({ n: count() })
      .from(articleLocalizations)
      .innerJoin(articles, eq(articles.id, articleLocalizations.articleId))
      .where(where);
    const rows = await this.db
      .select({
        articleId: articles.id,
        title: articleLocalizations.title,
        tldr: articleLocalizations.tldr,
        slug: articleLocalizations.slug,
        source: sources.name,
        image: images.storageKeyThumb,
        publishedAt: articles.publishedAt,
        isUrgent: articles.isUrgent,
        urgentApprovedAt: articles.urgentApprovedAt,
      })
      .from(articleLocalizations)
      .innerJoin(articles, eq(articles.id, articleLocalizations.articleId))
      .innerJoin(sources, eq(sources.id, articles.sourceId))
      .leftJoin(images, eq(images.id, articles.imageId))
      .where(where)
      .orderBy(desc(articles.publishedAt))
      .limit(perPage)
      .offset((page - 1) * perPage);
    const topicRows = rows.length
      ? await this.db
          .select({ articleId: articleTopics.articleId, slug: topics.slug })
          .from(articleTopics)
          .innerJoin(topics, eq(topics.id, articleTopics.topicId))
          .where(
            inArray(
              articleTopics.articleId,
              rows.map((r) => r.articleId),
            ),
          )
      : [];
    return {
      found: total?.n ?? 0,
      page,
      perPage,
      hits: rows.map((r) => ({
        articleId: r.articleId,
        locale: params.locale,
        title: r.title,
        tldr: r.tldr,
        slug: r.slug,
        source: r.source,
        topics: topicRows.filter((t) => t.articleId === r.articleId).map((t) => t.slug),
        imageUrl: mediaUrl(r.image),
        publishedAt: (r.publishedAt ?? new Date(0)).toISOString(),
        isUrgent: r.isUrgent && r.urgentApprovedAt !== null,
        highlight: null,
      })),
      facets: { topics: [] },
    };
  }
}

export function createTypesense(config: AppConfig = getConfig()): TypesenseSearch | null {
  if (!config.TYPESENSE_URL || !config.TYPESENSE_API_KEY) return null;
  return new TypesenseSearch(
    new TypesenseClient(config.TYPESENSE_URL, config.TYPESENSE_API_KEY),
    `${config.TYPESENSE_COLLECTION_PREFIX}articles`,
  );
}

/** Typesense when configured, PostgreSQL otherwise. */
export function createSearchBackend(db: Db, config: AppConfig = getConfig()): SearchBackend {
  return createTypesense(config) ?? new PostgresSearch(db);
}
