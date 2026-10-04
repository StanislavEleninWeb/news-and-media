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
import { mediaUrl } from '../storage';
import { articlePath, type ArticleCard } from './contracts';

/** Whether an article's urgent flag is in effect right now (approved and not expired). */
export function isUrgentActive(
  row: { isUrgent: boolean; urgentApprovedAt: Date | null; urgentExpiresAt: Date | null },
  now = new Date(),
): boolean {
  return (
    row.isUrgent &&
    row.urgentApprovedAt !== null &&
    (row.urgentExpiresAt === null || row.urgentExpiresAt > now)
  );
}

export async function topicsByArticle(db: Db, articleIds: string[], locale: Locale) {
  const map = new Map<string, { slug: string; name: string }[]>();
  if (articleIds.length === 0) return map;
  const rows = await db
    .select({
      articleId: articleTopics.articleId,
      slug: topics.slug,
      nameBg: topics.nameBg,
      nameEn: topics.nameEn,
      sortOrder: topics.sortOrder,
    })
    .from(articleTopics)
    .innerJoin(topics, eq(topics.id, articleTopics.topicId))
    .where(and(inArray(articleTopics.articleId, articleIds), eq(topics.isActive, true)));
  rows.sort((a, b) => a.sortOrder - b.sortOrder);
  for (const row of rows) {
    const list = map.get(row.articleId) ?? [];
    list.push({ slug: row.slug, name: locale === 'bg' ? row.nameBg : row.nameEn });
    map.set(row.articleId, list);
  }
  return map;
}

/** Article cards for the given ids in the given order (missing or unpublished ids are dropped). */
export async function loadCards(
  db: Db,
  articleIds: string[],
  locale: Locale,
  now = new Date(),
): Promise<ArticleCard[]> {
  if (articleIds.length === 0) return [];
  const rows = await db
    .select({
      id: articles.id,
      publishedAt: articles.publishedAt,
      isUrgent: articles.isUrgent,
      urgentApprovedAt: articles.urgentApprovedAt,
      urgentExpiresAt: articles.urgentExpiresAt,
      title: articleLocalizations.title,
      tldr: articleLocalizations.tldr,
      slug: articleLocalizations.slug,
      sourceId: sources.id,
      sourceName: sources.name,
      imageFull: images.storageKeyFull,
      imageThumb: images.storageKeyThumb,
    })
    .from(articles)
    .innerJoin(
      articleLocalizations,
      and(eq(articleLocalizations.articleId, articles.id), eq(articleLocalizations.locale, locale)),
    )
    .innerJoin(sources, eq(sources.id, articles.sourceId))
    .leftJoin(images, eq(images.id, articles.imageId))
    .where(and(inArray(articles.id, articleIds), eq(articles.status, 'published')));
  const topicMap = await topicsByArticle(db, articleIds, locale);
  const byId = new Map(rows.map((row) => [row.id, row]));
  return articleIds.flatMap((id) => {
    const row = byId.get(id);
    if (!row) return [];
    return [
      {
        id: row.id,
        locale,
        title: row.title,
        tldr: row.tldr,
        slug: row.slug,
        path: articlePath(locale, row.id, row.slug),
        imageUrl: mediaUrl(row.imageFull),
        imageThumbUrl: mediaUrl(row.imageThumb),
        source: { id: row.sourceId, name: row.sourceName },
        topics: topicMap.get(row.id) ?? [],
        publishedAt: (row.publishedAt ?? new Date(0)).toISOString(),
        isUrgent: isUrgentActive(row, now),
      },
    ];
  });
}
