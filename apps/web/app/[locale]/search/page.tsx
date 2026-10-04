import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getDb } from '@nm/db';
import { articlePath } from '@nm/services/content/contracts';
import { createSearchBackend } from '@nm/services/search/search';
import { AdSlot } from '@/components/AdSlot';
import { TimeAgo } from '@/components/TimeAgo';
import { isLocale } from '@/i18n/config';
import { getMessages } from '@/i18n/messages';
import { getNavTopics } from '@/lib/site';

// Results depend on the query string — always rendered per request.
export const dynamic = 'force-dynamic';

type Props = {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ q?: string; topic?: string; page?: string }>;
};

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  return {
    title: isLocale(locale) ? getMessages(locale).search.title : undefined,
    robots: { index: false },
  };
}

/** Highlights from Typesense contain only <mark> tags; everything else is escaped. */
function safeHighlight(html: string) {
  const escaped = html.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return escaped.replace(/&lt;mark&gt;/g, '<mark>').replace(/&lt;\/mark&gt;/g, '</mark>');
}

export default async function SearchPage({ params, searchParams }: Props) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  const { q = '', topic, page = '1' } = await searchParams;
  const t = getMessages(locale);
  const topics = await getNavTopics(locale);
  const query = q.trim().slice(0, 200);
  const topicFilter = topics.some((x) => x.slug === topic) ? topic : undefined;
  const pageNumber = Math.max(1, Math.min(50, Number(page) || 1));
  const result = query
    ? await createSearchBackend(getDb()).search({
        q: query,
        locale,
        topic: topicFilter,
        page: pageNumber,
        perPage: 20,
      })
    : null;

  const pageLink = (n: number) =>
    `/${locale}/search?${new URLSearchParams({ q: query, ...(topicFilter ? { topic: topicFilter } : {}), page: String(n) })}`;

  return (
    <div className="container" style={{ maxWidth: 820 }}>
      <h1 className="page-title">{t.search.title}</h1>
      <form className="search-form" action={`/${locale}/search`} role="search">
        <label className="visually-hidden" htmlFor="q">
          {t.search.title}
        </label>
        <input
          className="input"
          id="q"
          name="q"
          type="search"
          defaultValue={query}
          placeholder={t.search.placeholder}
          autoFocus
        />
        <label className="visually-hidden" htmlFor="topic">
          {t.nav.topics}
        </label>
        <select
          className="select"
          id="topic"
          name="topic"
          defaultValue={topicFilter ?? ''}
          style={{ maxWidth: 200 }}
        >
          <option value="">{t.search.filterAll}</option>
          {topics.map((x) => (
            <option key={x.slug} value={x.slug}>
              {x.name}
            </option>
          ))}
        </select>
        <button className="button" type="submit">
          {t.search.submit}
        </button>
      </form>

      {result ? (
        <>
          <p className="card__meta" style={{ marginBottom: '1rem' }}>
            {t.search.results(result.found)}
          </p>
          {result.hits.length === 0 ? <p className="empty">{t.search.none}</p> : null}
          <div className="stack">
            {result.hits.map((hit, index) => (
              <div key={hit.articleId}>
                <article className="card card--compact">
                  <div className="card__kicker">
                    {hit.isUrgent ? <span className="badge-urgent">{t.urgent}</span> : null}
                    <span>{hit.source}</span>
                  </div>
                  <h2 className="card__title">
                    <Link
                      className="card__link"
                      href={articlePath(locale, hit.articleId, hit.slug)}
                    >
                      {hit.title}
                    </Link>
                  </h2>
                  {hit.highlight ? (
                    <p
                      className="card__tldr"
                      dangerouslySetInnerHTML={{ __html: safeHighlight(hit.highlight) }}
                    />
                  ) : (
                    <p className="card__tldr">{hit.tldr}</p>
                  )}
                  <p className="card__meta">
                    <TimeAgo iso={hit.publishedAt} locale={locale} />
                  </p>
                </article>
                {index === 4 ? <AdSlot placement="search_inline" locale={locale} /> : null}
              </div>
            ))}
          </div>
          {result.found > pageNumber * 20 ? (
            <div className="load-more">
              <Link className="button button--ghost" href={pageLink(pageNumber + 1)}>
                {t.loadMore}
              </Link>
            </div>
          ) : null}
        </>
      ) : null}
    </div>
  );
}
