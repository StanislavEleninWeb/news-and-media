import Link from 'next/link';
import type { ArticleCard as Card } from '@nm/services/content/contracts';
import type { Locale } from '@/i18n/config';
import { getMessages } from '@/i18n/messages';
import { TimeAgo } from './TimeAgo';

export type CardVariant = 'lead' | 'standard' | 'compact';

/** Story card. Works without an image — most cards are typographic by design. */
export function ArticleCard({
  card,
  locale,
  variant = 'standard',
  showImage = true,
  priority = false,
}: {
  card: Card;
  locale: Locale;
  variant?: CardVariant;
  showImage?: boolean;
  priority?: boolean;
}) {
  const t = getMessages(locale);
  const image = variant === 'lead' ? card.imageUrl : card.imageThumbUrl;
  const topic = card.topics[0];
  return (
    <article className={`card card--${variant}`}>
      {showImage && image ? (
        <div className="card__media">
          <img
            src={image}
            srcSet={
              card.imageThumbUrl && card.imageUrl
                ? `${card.imageThumbUrl} 480w, ${card.imageUrl} 1280w`
                : undefined
            }
            sizes={
              variant === 'lead'
                ? '(min-width: 960px) 600px, 100vw'
                : '(min-width: 720px) 300px, 100vw'
            }
            alt=""
            width={1280}
            height={720}
            loading={priority ? 'eager' : 'lazy'}
            fetchPriority={priority ? 'high' : 'auto'}
            decoding="async"
            data-lite-hide=""
          />
        </div>
      ) : null}
      <div className="card__kicker">
        {card.isUrgent ? <span className="badge-urgent">{t.urgent}</span> : null}
        {topic ? <span className="card__topic">{topic.name}</span> : null}
        <span>{card.source.name}</span>
      </div>
      <h3 className="card__title">
        <Link className="card__link" href={card.path} prefetch={false}>
          {card.title}
        </Link>
      </h3>
      {variant !== 'compact' ? <p className="card__tldr">{card.tldr}</p> : null}
      <p className="card__meta">
        <TimeAgo iso={card.publishedAt} locale={locale} />
      </p>
    </article>
  );
}
