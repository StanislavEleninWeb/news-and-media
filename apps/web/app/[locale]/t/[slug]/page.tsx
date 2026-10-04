import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getDb } from '@nm/db';
import { getFeed } from '@nm/services/content/feed';
import { AdSlot } from '@/components/AdSlot';
import { FeedList } from '@/components/FeedList';
import { isLocale } from '@/i18n/config';
import { getMessages } from '@/i18n/messages';
import { getNavTopics } from '@/lib/site';

export const revalidate = 60;
export function generateStaticParams() {
  return [];
}

const PER_PAGE = 24;

type Props = { params: Promise<{ locale: string; slug: string }> };

async function findTopic(locale: string, slug: string) {
  if (!isLocale(locale)) return null;
  return (await getNavTopics(locale)).find((topic) => topic.slug === slug) ?? null;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale, slug } = await params;
  const topic = await findTopic(locale, slug);
  if (!topic) return {};
  return {
    title: topic.name,
    alternates: {
      canonical: `/${locale}/t/${slug}`,
      languages: { bg: `/bg/t/${slug}`, en: `/en/t/${slug}` },
    },
  };
}

export default async function TopicPage({ params }: Props) {
  const { locale, slug } = await params;
  const topic = await findTopic(locale, slug);
  if (!topic || !isLocale(locale)) notFound();
  const feed = await getFeed(getDb(), { locale, topic: slug, perPage: PER_PAGE });
  return (
    <div className="container">
      <h1 className="page-title">{topic.name}</h1>
      <h2 className="section-title">{getMessages(locale).topic.latestIn(topic.name)}</h2>
      <FeedList
        initial={feed.items}
        hasMore={feed.hasMore}
        perPage={PER_PAGE}
        locale={locale}
        query={{ topic: slug }}
        insert={{ after: 6, node: <AdSlot placement="feed_inline" locale={locale} /> }}
      />
    </div>
  );
}
