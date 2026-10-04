import type { Db } from '@nm/db';
import {
  articleLocalizations,
  articles,
  articleTopics,
  sources,
  topics,
  type Locale,
} from '@nm/db/schema';

let sequence = 0;

/** Inserts a published (by default) article with bg + en localizations for tests. */
export async function createPublishedArticle(
  db: Db,
  options: {
    sourceId: string;
    texts?: Partial<Record<Locale, { title: string; tldr?: string; body?: string }>>;
    topicSlugs?: string[];
    status?: (typeof articles.$inferInsert)['status'];
    publishedAt?: Date;
    isUrgent?: boolean;
    urgentApprovedAt?: Date | null;
    urgentExpiresAt?: Date | null;
  },
) {
  sequence += 1;
  const texts = options.texts ?? {
    bg: { title: `Новина номер ${sequence}` },
    en: { title: `News item ${sequence}` },
  };
  const [article] = await db
    .insert(articles)
    .values({
      sourceId: options.sourceId,
      originalUrl: `https://example.test/${sequence}-${Math.random().toString(36).slice(2)}`,
      originalTitle: texts.en?.title ?? texts.bg?.title ?? 'title',
      originalLanguage: 'bg',
      rawText: 'raw',
      contentHash: `h${sequence}-${Math.random()}`,
      status: options.status ?? 'published',
      isAiRewritten: true,
      publishedAt: options.publishedAt ?? new Date(Date.now() - sequence * 60_000),
      isUrgent: options.isUrgent ?? false,
      urgentApprovedAt: options.urgentApprovedAt ?? null,
      urgentExpiresAt: options.urgentExpiresAt ?? null,
    })
    .returning();
  for (const [locale, text] of Object.entries(texts) as [
    Locale,
    { title: string; tldr?: string; body?: string },
  ][]) {
    await db.insert(articleLocalizations).values({
      articleId: article!.id,
      locale,
      title: text.title,
      slug: `slug-${sequence}-${locale}`,
      tldr: text.tldr ?? `${text.title} — summary`,
      body: text.body ?? `${text.title}.\n\nSecond paragraph.`,
      isTranslation: locale === 'en',
    });
  }
  if (options.topicSlugs?.length) {
    const rows = await db.select().from(topics);
    for (const slug of options.topicSlugs) {
      const topic = rows.find((t) => t.slug === slug);
      if (topic)
        await db.insert(articleTopics).values({ articleId: article!.id, topicId: topic.id });
    }
  }
  return article!;
}

export async function createSource(db: Db, values: Partial<typeof sources.$inferInsert> = {}) {
  sequence += 1;
  const [row] = await db
    .insert(sources)
    .values({
      name: `Source ${sequence}`,
      url: `https://source-${sequence}.test/rss`,
      language: 'bg',
      ...values,
    })
    .returning();
  return row!;
}
