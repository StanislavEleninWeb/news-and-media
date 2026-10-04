import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound, permanentRedirect, redirect } from 'next/navigation';
import { Fragment, cache } from 'react';
import { getDb } from '@nm/db';
import { getArticle } from '@nm/services/content/article';
import { AdSlot } from '@/components/AdSlot';
import { ArticleCard } from '@/components/ArticleCard';
import { ArticleActions } from '@/components/article/ArticleActionsBar';
import { Reactions } from '@/components/article/ArticleActions';
import { TrustPanel } from '@/components/article/TrustPanel';
import { ViewBeacon } from '@/components/ViewBeacon';
import { isLocale, type Locale } from '@/i18n/config';
import { getMessages } from '@/i18n/messages';
import { formatDateTime } from '@/lib/format';
import { siteName, siteUrl } from '@/lib/site';

export const revalidate = 300;
export function generateStaticParams() {
  return [];
}

type Props = { params: Promise<{ locale: string; id: string; slug: string }> };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const load = cache(async (id: string, locale: Locale) =>
  UUID.test(id) ? getArticle(getDb(), id, locale) : null,
);

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale, id } = await params;
  if (!isLocale(locale)) return {};
  const article = await load(id, locale);
  if (!article) return {};
  const languages = Object.fromEntries([
    [locale, article.path],
    ...article.alternates.map((a) => [a.locale, a.path]),
  ]);
  return {
    title: article.title,
    description: article.tldr,
    alternates: { canonical: article.path, languages },
    openGraph: {
      type: 'article',
      title: article.title,
      description: article.tldr,
      url: article.path,
      publishedTime: article.publishedAt,
      images: article.imageUrl ? [{ url: article.imageUrl }] : undefined,
    },
    twitter: { card: article.imageUrl ? 'summary_large_image' : 'summary' },
  };
}

export default async function ArticlePage({ params }: Props) {
  const { locale, id, slug } = await params;
  if (!isLocale(locale)) notFound();
  const article = await load(id, locale);
  if (!article) {
    // Published only in the other language? Send the reader there.
    const other = await load(id, locale === 'bg' ? 'en' : 'bg');
    if (other) redirect(other.path);
    notFound();
  }
  if (slug !== article.slug) permanentRedirect(article.path);

  const t = getMessages(locale);
  const topic = article.topics[0];
  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'NewsArticle',
    headline: article.title,
    description: article.tldr,
    datePublished: article.publishedAt,
    inLanguage: locale,
    image: article.imageUrl ? [`${siteUrl()}${article.imageUrl}`] : undefined,
    mainEntityOfPage: `${siteUrl()}${article.path}`,
    publisher: { '@type': 'Organization', name: siteName() },
    isBasedOn: article.originalUrl,
  };

  return (
    <div className="container">
      <article className="article">
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/</g, '\\u003c') }}
        />
        <div className="card__kicker article__kicker">
          {article.isUrgent ? <span className="badge-urgent">{t.urgent}</span> : null}
          {topic ? (
            <Link className="card__topic" href={`/${locale}/t/${topic.slug}`}>
              {topic.name}
            </Link>
          ) : null}
        </div>
        <h1 className="article__title">{article.title}</h1>
        <div className="article__meta">
          <span>
            {t.article.publishedAt}{' '}
            <time dateTime={article.publishedAt}>
              {formatDateTime(article.publishedAt, locale)}
            </time>
          </span>
          <span>
            {t.article.source}: {article.source.name}
          </span>
          {article.isAiRewritten ? (
            <a className="ai-badge" href="#transparency">
              {t.trust.aiLabel}
            </a>
          ) : null}
          {article.corrections.length ? (
            <a href="#corrections">
              {t.trust.corrections} ({article.corrections.length})
            </a>
          ) : null}
          {article.alternates.map((alternate) => (
            <Link
              key={alternate.locale}
              href={alternate.path}
              hrefLang={alternate.locale}
              lang={alternate.locale}
            >
              {t.article.readIn} {alternate.locale === 'bg' ? 'български' : 'English'}
            </Link>
          ))}
        </div>

        <ArticleActions
          articleId={article.id}
          locale={locale}
          path={article.path}
          title={article.title}
        />

        <section className="tldr" aria-label={t.article.inShort}>
          <p className="tldr__label">
            {t.article.inShort}
            <small>{t.article.inShortHint}</small>
          </p>
          <p>{article.tldr}</p>
        </section>

        {article.imageUrl ? (
          <figure className="article__figure" data-lite-hide="">
            <img
              src={article.imageUrl}
              srcSet={
                article.imageThumbUrl
                  ? `${article.imageThumbUrl} 480w, ${article.imageUrl} 1280w`
                  : undefined
              }
              sizes="(min-width: 800px) 760px, 100vw"
              alt=""
              width={1280}
              height={720}
              fetchPriority="high"
            />
            {article.imageCredit ? (
              <figcaption>
                {t.article.imageCredit}: {article.imageCredit}
              </figcaption>
            ) : null}
          </figure>
        ) : null}

        <div className="article__body">
          {article.body.map((paragraph, index) => (
            <Fragment key={index}>
              <p>{paragraph}</p>
              {index === 2 && article.body.length > 4 ? (
                <AdSlot placement="article_inline" locale={locale} />
              ) : null}
            </Fragment>
          ))}
        </div>

        <Reactions articleId={article.id} locale={locale} />

        <div id="transparency">
          <TrustPanel article={article} locale={locale} />
        </div>

        <div className="article__footer">
          <AdSlot placement="article_bottom" locale={locale} />
          {article.related.length ? (
            <section>
              <h2 className="section-title">{t.article.related}</h2>
              <div className="story-grid">
                {article.related.map((card) => (
                  <ArticleCard key={card.id} card={card} locale={locale} />
                ))}
              </div>
            </section>
          ) : null}
        </div>
        <ViewBeacon articleId={article.id} />
      </article>
    </div>
  );
}
