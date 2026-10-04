import { and, desc, eq, inArray, ne, sql } from 'drizzle-orm';
import type { Db } from '@nm/db';
import {
  articleCorrections,
  articleLocalizations,
  articles,
  articleTopics,
  images,
  sources,
  type Locale,
} from '@nm/db/schema';
import { mediaUrl } from '../storage';
import { isUrgentActive, loadCards, topicsByArticle } from './cards';
import { articlePath, type ArticleDetail } from './contracts';

/** Full article for the reading page; null unless published in that locale. */
export async function getArticle(
  db: Db,
  id: string,
  locale: Locale,
  now = new Date(),
): Promise<ArticleDetail | null> {
  const [row] = await db
    .select({
      article: articles,
      localization: articleLocalizations,
      source: sources,
      image: images,
    })
    .from(articles)
    .innerJoin(
      articleLocalizations,
      and(eq(articleLocalizations.articleId, articles.id), eq(articleLocalizations.locale, locale)),
    )
    .innerJoin(sources, eq(sources.id, articles.sourceId))
    .leftJoin(images, eq(images.id, articles.imageId))
    .where(and(eq(articles.id, id), eq(articles.status, 'published')));
  if (!row) return null;

  const [topicMap, alternates, corrections] = await Promise.all([
    topicsByArticle(db, [id], locale),
    db
      .select({ locale: articleLocalizations.locale, slug: articleLocalizations.slug })
      .from(articleLocalizations)
      .where(and(eq(articleLocalizations.articleId, id), ne(articleLocalizations.locale, locale))),
    db
      .select({
        locale: articleCorrections.locale,
        note: articleCorrections.note,
        createdAt: articleCorrections.createdAt,
      })
      .from(articleCorrections)
      .where(and(eq(articleCorrections.articleId, id), eq(articleCorrections.locale, locale)))
      .orderBy(desc(articleCorrections.createdAt)),
  ]);

  const topicIds = await db
    .select({ topicId: articleTopics.topicId })
    .from(articleTopics)
    .where(eq(articleTopics.articleId, id));
  let related: ArticleDetail['related'] = [];
  if (topicIds.length) {
    const relatedRows = await db
      .selectDistinct({ id: articles.id, publishedAt: articles.publishedAt })
      .from(articles)
      .innerJoin(articleTopics, eq(articleTopics.articleId, articles.id))
      .where(
        and(
          eq(articles.status, 'published'),
          ne(articles.id, id),
          inArray(
            articleTopics.topicId,
            topicIds.map((t) => t.topicId),
          ),
          sql`${articles.publishedAt} > now() - interval '14 days'`,
        ),
      )
      .orderBy(desc(articles.publishedAt))
      .limit(4);
    related = await loadCards(
      db,
      relatedRows.map((r) => r.id),
      locale,
      now,
    );
  }

  const { article, localization, source, image } = row;
  return {
    id: article.id,
    locale,
    title: localization.title,
    tldr: localization.tldr,
    slug: localization.slug,
    path: articlePath(locale, article.id, localization.slug),
    imageUrl: mediaUrl(image?.storageKeyFull),
    imageThumbUrl: mediaUrl(image?.storageKeyThumb),
    imageCredit: image?.credit ?? null,
    topics: topicMap.get(article.id) ?? [],
    publishedAt: (article.publishedAt ?? new Date(0)).toISOString(),
    isUrgent: isUrgentActive(article, now),
    body: localization.body.split(/\n\s*\n/).filter(Boolean),
    isAiRewritten: article.isAiRewritten,
    isTranslation: localization.isTranslation,
    originalUrl: article.originalUrl,
    source: {
      id: source.id,
      name: source.name,
      homepageUrl: source.homepageUrl,
      credibilityRating: source.credibilityRating,
      credibilityNote: source.credibilityNote,
    },
    corrections: corrections.map((c) => ({ ...c, createdAt: c.createdAt.toISOString() })),
    alternates: alternates.map((a) => ({
      locale: a.locale,
      path: articlePath(a.locale, article.id, a.slug),
    })),
    related,
  };
}
