'use client';

import { useEffect, useRef, useState } from 'react';
import type { Ad } from '@nm/services/content/contracts';
import type { Locale } from '@/i18n/config';
import { CONSENT_EVENT, readConsent } from '@/lib/consent';
import type { AdPlacement } from './AdSlot';

/**
 * Fills a reserved ad box in the browser, so cached pages stay identical for
 * everyone and creatives rotate per view. Measurement (impression beacon, click
 * counter) only happens after the reader consented to it.
 */
export function AdCreative({
  placement,
  locale,
  label,
}: {
  placement: AdPlacement;
  locale: Locale;
  label: string;
}) {
  const [ad, setAd] = useState<Ad | null>(null);
  const [consented, setConsented] = useState(false);
  const ref = useRef<HTMLAnchorElement>(null);

  useEffect(() => {
    const update = () => setConsented(readConsent() === 'all');
    update();
    window.addEventListener(CONSENT_EVENT, update);
    return () => window.removeEventListener(CONSENT_EVENT, update);
  }, []);

  useEffect(() => {
    let cancelled = false;
    void fetch(`/api/v1/ads?placement=${placement}&locale=${locale}`)
      .then((r) => (r.ok ? r.json() : { ad: null }))
      .then((body: { ad: Ad | null }) => !cancelled && setAd(body.ad))
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [placement, locale]);

  useEffect(() => {
    if (!ad || !consented || !ref.current) return;
    const element = ref.current;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          observer.disconnect();
          navigator.sendBeacon?.(`/api/v1/ads/${ad.id}/impression`);
        }
      },
      { threshold: 0.5 },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, [ad, consented]);

  if (!ad) return <span className="ad-slot__label">{label}</span>;
  return (
    <>
      <span className="ad-slot__label">{label}</span>
      <a
        ref={ref}
        href={consented ? `/api/v1/ads/${ad.id}/click` : ad.targetUrl}
        target="_blank"
        rel="sponsored noopener"
        className="ad-slot__link"
      >
        <img
          src={ad.imageUrl}
          alt={ad.altText}
          width={ad.width}
          height={ad.height}
          loading="lazy"
          decoding="async"
        />
      </a>
    </>
  );
}
