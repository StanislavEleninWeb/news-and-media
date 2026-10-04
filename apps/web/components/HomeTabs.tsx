'use client';

import Link from 'next/link';
import { useEffect, useState, type ReactNode } from 'react';
import type { FeedResponse } from '@nm/services/content/contracts';
import type { Locale } from '@/i18n/config';
import { getMessages } from '@/i18n/messages';
import { ArticleCard } from './ArticleCard';
import { useViewer } from './ViewerProvider';

/** "All" (cached, server-rendered) vs "For you" (personalised, fetched for signed-in readers). */
export function HomeTabs({ locale, children }: { locale: Locale; children: ReactNode }) {
  const t = getMessages(locale);
  const viewer = useViewer();
  const [tab, setTab] = useState<'all' | 'mine'>('all');
  const [mine, setMine] = useState<FeedResponse | null>(null);

  useEffect(() => {
    if (tab !== 'mine' || mine) return;
    void fetch(`/api/v1/feed?locale=${locale}&perPage=24`, { credentials: 'same-origin' })
      .then((r) => r.json())
      .then(setMine);
  }, [tab, mine, locale]);

  if (viewer.status !== 'signed-in') return <>{children}</>;
  const hasPreferences = viewer.preferences.topics.length + viewer.preferences.sourceIds.length > 0;
  return (
    <>
      <div className="tabs" role="tablist">
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'all'}
          onClick={() => setTab('all')}
        >
          {t.home.all}
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'mine'}
          onClick={() => setTab('mine')}
        >
          {t.home.forYou}
        </button>
      </div>
      {tab === 'all' ? (
        children
      ) : !hasPreferences ? (
        <p className="empty">
          {t.home.forYouEmpty} <Link href={`/${locale}/account`}>{t.home.choose}</Link>
        </p>
      ) : mine ? (
        <div className="story-grid">
          {mine.items.map((card) => (
            <ArticleCard key={card.id} card={card} locale={locale} />
          ))}
        </div>
      ) : (
        <p className="empty">{t.loading}</p>
      )}
    </>
  );
}
