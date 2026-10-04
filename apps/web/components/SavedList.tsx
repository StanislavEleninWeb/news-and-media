'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import type { ArticleCard as Card } from '@nm/services/content/contracts';
import type { Locale } from '@/i18n/config';
import { getMessages } from '@/i18n/messages';
import { api } from '@/lib/client-api';
import { ArticleCard } from './ArticleCard';
import { useViewer } from './ViewerProvider';

export function SavedList({ locale }: { locale: Locale }) {
  const t = getMessages(locale);
  const viewer = useViewer();
  const [items, setItems] = useState<Card[] | null>(null);

  const offlineKey = `nm_saved_${locale}`;
  useEffect(() => {
    // Offline: show the last list we fetched (the article pages themselves are cached by the service worker).
    if (!navigator.onLine) {
      try {
        setItems(JSON.parse(localStorage.getItem(offlineKey) ?? 'null'));
      } catch {
        setItems([]);
      }
      return;
    }
    if (viewer.status !== 'signed-in') return;
    void api<{ items: Card[] }>(`/api/v1/me/saved?locale=${locale}`).then((r) => {
      setItems(r.items);
      try {
        localStorage.setItem(offlineKey, JSON.stringify(r.items));
      } catch {
        // storage full or disabled
      }
    });
  }, [viewer.status, locale, offlineKey]);

  if (items && items.length && viewer.status !== 'signed-in') {
    return (
      <div className="story-grid">
        {items.map((card) => (
          <ArticleCard key={card.id} card={card} locale={locale} showImage={false} />
        ))}
      </div>
    );
  }
  if (viewer.status === 'loading') return <p className="empty">{t.loading}</p>;
  if (viewer.status === 'anonymous') {
    return (
      <p className="empty">
        {t.saved.signIn} <Link href={`/${locale}/account`}>{t.nav.signIn}</Link>
      </p>
    );
  }
  if (!items) return <p className="empty">{t.loading}</p>;
  if (items.length === 0) return <p className="empty">{t.saved.empty}</p>;
  return (
    <div className="story-grid">
      {items.map((card) => (
        <ArticleCard key={card.id} card={card} locale={locale} />
      ))}
    </div>
  );
}
