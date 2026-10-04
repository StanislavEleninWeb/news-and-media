'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import type { Reaction, ReactionSummary } from '@nm/services/content/contracts';
import type { Locale } from '@/i18n/config';
import { getMessages } from '@/i18n/messages';
import { api } from '@/lib/client-api';
import { BookmarkIcon } from '../Icons';
import { useViewer } from '../ViewerProvider';

const emoji: Record<Reaction, string> = {
  like: '👍',
  insightful: '💡',
  surprising: '😮',
  sad: '😢',
  angry: '😠',
};
const order: Reaction[] = ['like', 'insightful', 'surprising', 'sad', 'angry'];

export function SaveButton({
  articleId,
  locale,
  path,
}: {
  articleId: string;
  locale: Locale;
  path: string;
}) {
  const t = getMessages(locale).engage;
  const viewer = useViewer();
  const [saved, setSaved] = useState<boolean | null>(null);

  useEffect(() => {
    if (viewer.status !== 'signed-in') return;
    void api<{ items: { id: string }[] }>(`/api/v1/me/saved?locale=${locale}`).then((r) =>
      setSaved(r.items.some((i) => i.id === articleId)),
    );
  }, [viewer.status, articleId, locale]);

  if (viewer.status === 'anonymous') {
    return (
      <Link className="button button--ghost" href={`/${locale}/account`} title={t.signInToSave}>
        <BookmarkIcon /> {t.save}
      </Link>
    );
  }
  const toggle = async () => {
    const next = !saved;
    setSaved(next);
    try {
      await api(`/api/v1/me/saved/${articleId}`, { method: next ? 'PUT' : 'DELETE' });
      // Let the service worker keep (or drop) an offline copy of the page.
      navigator.serviceWorker?.controller?.postMessage({
        type: next ? 'cache-article' : 'uncache-article',
        url: path,
      });
    } catch {
      setSaved(!next);
    }
  };
  return (
    <button
      className="button button--ghost"
      type="button"
      aria-pressed={!!saved}
      onClick={toggle}
      disabled={saved === null && viewer.status === 'signed-in'}
    >
      <BookmarkIcon filled={!!saved} /> {saved ? t.saved : t.save}
    </button>
  );
}

export function ShareButton({ locale, title }: { locale: Locale; title: string }) {
  const t = getMessages(locale).engage;
  const [copied, setCopied] = useState(false);
  const share = async () => {
    const url = window.location.href;
    if (navigator.share) {
      await navigator.share({ title, url }).catch(() => {});
      return;
    }
    await navigator.clipboard?.writeText(url);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };
  return (
    <button className="button button--ghost" type="button" onClick={share} aria-live="polite">
      {copied ? t.copied : t.share}
    </button>
  );
}

export function Reactions({ articleId, locale }: { articleId: string; locale: Locale }) {
  const t = getMessages(locale).engage;
  const [summary, setSummary] = useState<ReactionSummary | null>(null);

  useEffect(() => {
    void api<ReactionSummary>(`/api/v1/articles/${articleId}/reaction`)
      .then(setSummary)
      .catch(() => {});
  }, [articleId]);

  const choose = async (reaction: Reaction) => {
    const remove = summary?.mine === reaction;
    try {
      setSummary(
        await api<ReactionSummary>(`/api/v1/articles/${articleId}/reaction`, {
          method: remove ? 'DELETE' : 'PUT',
          body: remove ? undefined : { reaction },
        }),
      );
    } catch {
      // ignore (rate limit, offline)
    }
  };

  return (
    <section className="reactions" aria-label={t.reactionsLabel}>
      <p className="reactions__label">{t.reactionsLabel}</p>
      <div className="reactions__list">
        {order.map((reaction) => (
          <button
            key={reaction}
            type="button"
            className="reaction"
            aria-pressed={summary?.mine === reaction}
            onClick={() => choose(reaction)}
            title={t.reactions[reaction]}
          >
            <span aria-hidden="true">{emoji[reaction]}</span>
            <span className="visually-hidden">{t.reactions[reaction]}</span>
            <span className="reaction__count">{summary?.counts[reaction] ?? 0}</span>
          </button>
        ))}
      </div>
    </section>
  );
}
