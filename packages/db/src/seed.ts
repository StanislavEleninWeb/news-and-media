import { eq } from 'drizzle-orm';
import type { Db } from './client';
import {
  articleLocalizations,
  articles,
  articleTopics,
  sources,
  topics,
  type Locale,
} from './schema';

export const defaultTopics = [
  { slug: 'general', nameBg: 'Общи новини', nameEn: 'General news', sortOrder: 10 },
  { slug: 'politics', nameBg: 'Политика', nameEn: 'Politics', sortOrder: 20 },
  { slug: 'business', nameBg: 'Бизнес', nameEn: 'Business', sortOrder: 30 },
  { slug: 'tech', nameBg: 'Технологии', nameEn: 'Tech', sortOrder: 40 },
  { slug: 'culture', nameBg: 'Култура', nameEn: 'Culture', sortOrder: 50 },
  { slug: 'sport', nameBg: 'Спорт', nameEn: 'Sport', sortOrder: 60 },
] as const;

/**
 * Example sources for development only. They are ordinary rows: replace them
 * from the admin (Sources) — production starts with an empty list.
 * BG feed URLs are best guesses; verify them with "Test fetch" in the admin.
 */
const exampleSources = [
  {
    name: 'BBC News — World',
    url: 'https://feeds.bbci.co.uk/news/world/rss.xml',
    homepageUrl: 'https://www.bbc.com/news/world',
    language: 'en',
    topic: 'general',
  },
  {
    name: 'The Guardian — Technology',
    url: 'https://www.theguardian.com/uk/technology/rss',
    homepageUrl: 'https://www.theguardian.com/uk/technology',
    language: 'en',
    topic: 'tech',
  },
  {
    name: 'Дневник',
    url: 'https://www.dnevnik.bg/rss/',
    homepageUrl: 'https://www.dnevnik.bg',
    language: 'bg',
    topic: 'general',
  },
  {
    name: 'Капитал',
    url: 'https://www.capital.bg/rss/',
    homepageUrl: 'https://www.capital.bg',
    language: 'bg',
    topic: 'business',
  },
];

/** Inserts the default topic list. Safe to run repeatedly; used in every environment. */
export async function seedTopics(db: Db): Promise<number> {
  const inserted = await db
    .insert(topics)
    .values([...defaultTopics])
    .onConflictDoNothing({ target: topics.slug })
    .returning({ id: topics.id });
  return inserted.length;
}

/** Development data: topics, example sources and two published sample articles. */
export async function seedDevelopment(db: Db, appEnv: string): Promise<void> {
  if (appEnv === 'production' || appEnv === 'staging') {
    throw new Error(`Refusing to load development seed data into ${appEnv}`);
  }
  await seedTopics(db);
  const topicRows = await db.select().from(topics);
  const topicId = (slug: string) => topicRows.find((t) => t.slug === slug)?.id ?? null;

  for (const source of exampleSources) {
    await db
      .insert(sources)
      .values({
        name: source.name,
        url: source.url,
        homepageUrl: source.homepageUrl,
        language: source.language,
        defaultTopicId: topicId(source.topic),
      })
      .onConflictDoNothing({ target: sources.url });
  }

  const [bbc] = await db.select().from(sources).where(eq(sources.url, exampleSources[0]!.url));
  if (!bbc) return;

  const samples: {
    url: string;
    topic: string;
    texts: Record<Locale, { title: string; tldr: string; body: string }>;
  }[] = [
    {
      url: 'https://example.com/sample-1',
      topic: 'tech',
      texts: {
        en: {
          title: 'Sample: European cities test AI traffic lights',
          tldr: 'Several cities are piloting signals that adapt to traffic in real time.',
          body: 'This is sample content for local development.\n\nRun the ingestion pipeline to replace it with real articles.',
        },
        bg: {
          title: 'Пример: европейски градове тестват умни светофари',
          tldr: 'Няколко града пилотират светофари, които се настройват към трафика в реално време.',
          body: 'Това е примерно съдържание за локална разработка.\n\nСтартирайте обработката на източници, за да го замените с реални статии.',
        },
      },
    },
    {
      url: 'https://example.com/sample-2',
      topic: 'sport',
      texts: {
        en: {
          title: 'Sample: Season opener draws record crowd',
          tldr: 'Attendance beat the previous record by a wide margin.',
          body: 'Sample article body.\n\nSecond paragraph.',
        },
        bg: {
          title: 'Пример: рекордна публика на откриването на сезона',
          tldr: 'Посещаемостта подобри предишния рекорд с голяма разлика.',
          body: 'Примерен текст на статия.\n\nВтори абзац.',
        },
      },
    },
  ];

  for (const [i, sample] of samples.entries()) {
    const [article] = await db
      .insert(articles)
      .values({
        sourceId: bbc.id,
        originalUrl: sample.url,
        originalTitle: sample.texts.en.title,
        originalLanguage: 'en',
        rawText: sample.texts.en.body,
        contentHash: `sample-${i}`,
        status: 'published',
        isAiRewritten: true,
        publishedAt: new Date(Date.now() - i * 3_600_000),
      })
      .onConflictDoNothing({ target: articles.originalUrl })
      .returning();
    if (!article) continue;
    for (const locale of ['bg', 'en'] as const) {
      const text = sample.texts[locale];
      await db.insert(articleLocalizations).values({
        articleId: article.id,
        locale,
        title: text.title,
        slug: `sample-${i + 1}`,
        tldr: text.tldr,
        body: text.body,
        isTranslation: locale === 'bg',
      });
    }
    const tid = topicId(sample.topic);
    if (tid) await db.insert(articleTopics).values({ articleId: article.id, topicId: tid });
  }
}
