import type { Locale } from '@/i18n/config';
import { AdCreative } from './AdCreative';

export type AdPlacement =
  'home_top' | 'feed_inline' | 'article_inline' | 'article_bottom' | 'search_inline';

/**
 * Fixed-size ad space. The box keeps its size whether or not a creative
 * arrives, so ads never shift the content (CLS). Creatives load in the browser.
 */
export function AdSlot({ placement, locale }: { placement: AdPlacement; locale: Locale }) {
  return (
    <div className="ad-row" data-lite-hide="">
      <div className={`ad-slot ad-slot--${placement}`} data-placement={placement}>
        <AdCreative
          placement={placement}
          locale={locale}
          label={locale === 'bg' ? 'Реклама' : 'Advertisement'}
        />
      </div>
    </div>
  );
}
