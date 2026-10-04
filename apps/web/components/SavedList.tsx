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

  useEffect(() => {
    if (viewer.status !== 'signed-in') return;
    void api<{ items: Card[] }>(`/api/v1/me/saved?locale=${locale}`).then((r) => setItems(r.items));
  }, [viewer.status, locale]);

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
