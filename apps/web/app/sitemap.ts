import { and, desc, eq } from 'drizzle-orm';
import type { MetadataRoute } from 'next';
import { getConfig } from '@nm/core/config';
import { getDb } from '@nm/db';
import { articleLocalizations, articles, topics } from '@nm/db/schema';
import { articlePath } from '@nm/services/content/contracts';

export const dynamic = 'force-dynamic';

/** Home, topic pages and the 2,000 most recent articles in both languages. */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const base = getConfig().APP_URL.replace(/\/$/, '');
  const db = getDb();
  const [topicRows, articleRows] = await Promise.all([
    db.select({ slug: topics.slug }).from(topics).where(eq(topics.isActive, true)),
    db
      .select({
        id: articles.id,
        locale: articleLocalizations.locale,
        slug: articleLocalizations.slug,
        updatedAt: articles.updatedAt,
      })
      .from(articles)
      .innerJoin(articleLocalizations, eq(articleLocalizations.articleId, articles.id))
      .where(and(eq(articles.status, 'published')))
      .orderBy(desc(articles.publishedAt))
      .limit(2000),
  ]);
  const entries: MetadataRoute.Sitemap = [];
  for (const locale of ['bg', 'en']) {
    entries.push({ url: `${base}/${locale}`, changeFrequency: 'always', priority: 1 });
    for (const topic of topicRows)
      entries.push({
        url: `${base}/${locale}/t/${topic.slug}`,
        changeFrequency: 'hourly',
        priority: 0.7,
      });
  }
  for (const row of articleRows) {
    entries.push({
      url: `${base}${articlePath(row.locale, row.id, row.slug)}`,
      lastModified: row.updatedAt,
      priority: 0.6,
    });
  }
  return entries;
}
