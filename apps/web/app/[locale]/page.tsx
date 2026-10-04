import { notFound } from 'next/navigation';
import { getDb } from '@nm/db';
import { getTrending } from '@nm/services/content/engagement';
import { getFeed } from '@nm/services/content/feed';
import { AdSlot } from '@/components/AdSlot';
import { ArticleCard } from '@/components/ArticleCard';
import { FeedList } from '@/components/FeedList';
import { HomeTabs } from '@/components/HomeTabs';
import { UrgentBanner } from '@/components/UrgentBanner';
import { isLocale } from '@/i18n/config';
import { getMessages } from '@/i18n/messages';

export const revalidate = 60;

const PER_PAGE = 25;

export default async function HomePage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  const t = getMessages(locale);
  const db = getDb();
  const [feed, trending] = await Promise.all([
    getFeed(db, { locale, perPage: PER_PAGE }),
    getTrending(db, locale, 6),
  ]);
  const urgent = feed.items.filter((card) => card.isUrgent);
  const regular = feed.items.filter((card) => !card.isUrgent);
  const [lead, ...rest] = regular;

  return (
    <>
      {urgent[0] ? (
        <div style={{ marginTop: 'calc(var(--space) * -1)', marginBottom: 'var(--space)' }}>
          <UrgentBanner card={urgent[0]} locale={locale} />
        </div>
      ) : null}
      <div className="container">
        <AdSlot placement="home_top" locale={locale} />
        <div className="home-grid">
          <div>
            <h1 className="visually-hidden">{t.home.latest}</h1>
            <HomeTabs locale={locale}>
              {lead ? (
                <div className={`lead${lead.imageUrl ? ' lead--with-image' : ''}`}>
                  <ArticleCard card={lead} locale={locale} variant="lead" priority />
                </div>
              ) : null}
              <h2 className="section-title">{t.home.latest}</h2>
              <FeedList
                initial={[...urgent.slice(1), ...rest]}
                hasMore={feed.hasMore}
                perPage={PER_PAGE}
                locale={locale}
                query={{}}
                showEmpty={!lead}
                insert={{ after: 6, node: <AdSlot placement="feed_inline" locale={locale} /> }}
              />
            </HomeTabs>
          </div>
          <aside aria-labelledby="trending-title">
            <h2 className="section-title" id="trending-title">
              {t.home.trending}
            </h2>
            {trending.length ? (
              <ol className="trending">
                {trending.map((card) => (
                  <li key={card.id}>
                    <a href={card.path}>{card.title}</a>
                  </li>
                ))}
              </ol>
            ) : (
              <div className="stack">
                {rest.slice(0, 5).map((card) => (
                  <ArticleCard
                    key={card.id}
                    card={card}
                    locale={locale}
                    variant="compact"
                    showImage={false}
                  />
                ))}
              </div>
            )}
          </aside>
        </div>
      </div>
    </>
  );
}
