'use client';

import { Fragment, useState, type ReactNode } from 'react';
import type { ArticleCard as Card, FeedResponse } from '@nm/services/content/contracts';
import type { Locale } from '@/i18n/config';
import { getMessages } from '@/i18n/messages';
import { ArticleCard } from './ArticleCard';

/**
 * Server-rendered first page plus client-side "load more", so the page itself
 * stays cacheable. `insert` places a node (e.g. an ad slot) after a given card.
 */
export function FeedList({
  initial,
  hasMore: initialHasMore,
  locale,
  query,
  perPage,
  insert,
  showEmpty = true,
}: {
  initial: Card[];
  hasMore: boolean;
  locale: Locale;
  query: Record<string, string>;
  perPage: number;
  insert?: { after: number; node: ReactNode };
  showEmpty?: boolean;
}) {
  const t = getMessages(locale);
  const [items, setItems] = useState(initial);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(initialHasMore);
  const [loading, setLoading] = useState(false);

  async function loadMore() {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        ...query,
        locale,
        page: String(page + 1),
        perPage: String(perPage),
      });
      const response = await fetch(`/api/v1/feed?${params}`);
      const body = (await response.json()) as FeedResponse;
      const seen = new Set(items.map((i) => i.id));
      setItems([...items, ...body.items.filter((i) => !seen.has(i.id))]);
      setHasMore(body.hasMore);
      setPage(page + 1);
    } finally {
      setLoading(false);
    }
  }

  if (items.length === 0) return showEmpty ? <p className="empty">{t.noArticles}</p> : null;
  const head = insert ? items.slice(0, insert.after) : items;
  const tail = insert ? items.slice(insert.after) : [];
  return (
    <>
      <div className="story-grid">
        {head.map((card) => (
          <ArticleCard key={card.id} card={card} locale={locale} />
        ))}
      </div>
      {insert && items.length > insert.after ? <Fragment>{insert.node}</Fragment> : null}
      {tail.length ? (
        <div className="story-grid">
          {tail.map((card) => (
            <ArticleCard key={card.id} card={card} locale={locale} />
          ))}
        </div>
      ) : null}
      {hasMore ? (
        <div className="load-more">
          <button
            className="button button--ghost"
            type="button"
            onClick={loadMore}
            disabled={loading}
          >
            {loading ? t.loading : t.loadMore}
          </button>
        </div>
      ) : null}
    </>
  );
}
