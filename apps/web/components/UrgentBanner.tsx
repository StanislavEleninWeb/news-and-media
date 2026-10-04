import Link from 'next/link';
import type { ArticleCard } from '@nm/services/content/contracts';
import type { Locale } from '@/i18n/config';
import { getMessages } from '@/i18n/messages';

/** Full-width breaking-news strip, shown only for editor-approved urgent stories. */
export function UrgentBanner({ card, locale }: { card: ArticleCard; locale: Locale }) {
  return (
    <aside className="urgent" aria-live="polite">
      <div className="container urgent__inner">
        <span className="urgent__label">
          <span className="urgent__pulse" aria-hidden="true" />
          {getMessages(locale).urgent}
        </span>
        <Link className="urgent__title" href={card.path}>
          {card.title}
        </Link>
      </div>
    </aside>
  );
}
