import type { Locale } from '@/i18n/config';

export type AdPlacement =
  'home_top' | 'feed_inline' | 'article_inline' | 'article_bottom' | 'search_inline';

/**
 * Reserved, fixed-size space for an ad. The box always keeps its size so an
 * ad arriving (or not) never shifts the content (CLS). Creatives are wired in
 * by the ad-slot step.
 */
export function AdSlot({ placement, locale }: { placement: AdPlacement; locale: Locale }) {
  return (
    <div className="ad-row">
      <div
        className={`ad-slot ad-slot--${placement}`}
        data-placement={placement}
        aria-hidden="true"
      >
        <span className="ad-slot__label">{locale === 'bg' ? 'Реклама' : 'Advertisement'}</span>
      </div>
    </div>
  );
}
