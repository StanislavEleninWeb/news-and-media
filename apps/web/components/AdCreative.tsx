'use client';

import { useEffect, useId, useRef, useState } from 'react';
import type { Ad } from '@nm/services/content/contracts';
import type { Locale } from '@/i18n/config';
import { cappedAdIds, countCappedImpression } from '@/lib/ad-frequency';
import { displayGamSlot, loadAdConfig } from '@/lib/ad-server';
import { CONSENT_EVENT, readConsent } from '@/lib/consent';
import type { AdPlacement } from './AdSlot';

/**
 * Fills a reserved ad box in the browser, so cached pages stay identical for
 * everyone. With Ad Manager configured the slot is served by GPT (direct line
 * items, AdX/PMP, optional Prebid); otherwise — or when Ad Manager has nothing
 * to show — a built-in direct/house creative is used. Built-in measurement
 * (impression beacon, click counter) only happens after consent.
 */
export function AdCreative({
  placement,
  locale,
  label,
  targeting,
}: {
  placement: AdPlacement;
  locale: Locale;
  label: string;
  targeting?: Record<string, string>;
}) {
  const [mode, setMode] = useState<'loading' | 'gam' | 'direct'>('loading');
  const [consented, setConsented] = useState(false);
  const divId = `gpt-${placement}-${useId().replace(/[^A-Za-z0-9]/g, '')}`;
  const targetingKey = JSON.stringify(targeting ?? {});

  useEffect(() => {
    const update = () => setConsented(readConsent() === 'all');
    update();
    window.addEventListener(CONSENT_EVENT, update);
    return () => window.removeEventListener(CONSENT_EVENT, update);
  }, []);

  useEffect(() => {
    let cancelled = false;
    void loadAdConfig().then(
      (config) => !cancelled && setMode(config.provider === 'gam' ? 'gam' : 'direct'),
    );
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (mode !== 'gam') return;
    let cleanup: (() => void) | undefined;
    let cancelled = false;
    void loadAdConfig()
      .then((config) =>
        displayGamSlot({
          config,
          divId,
          placement,
          locale,
          targeting: JSON.parse(targetingKey) as Record<string, string>,
          onEmpty: () => !cancelled && setMode('direct'),
        }),
      )
      .then((fn) => {
        if (cancelled) fn();
        else cleanup = fn;
      })
      .catch(() => !cancelled && setMode('direct'));
    return () => {
      cancelled = true;
      cleanup?.();
    };
  }, [mode, divId, placement, locale, targetingKey]);

  if (mode === 'gam')
    return (
      <>
        <span className="ad-slot__label">{label}</span>
        <div id={divId} className="ad-slot__gpt" />
      </>
    );
  if (mode === 'direct')
    return (
      <DirectCreative placement={placement} locale={locale} label={label} consented={consented} />
    );
  return <span className="ad-slot__label">{label}</span>;
}

/** Built-in direct-sold / house creative from /api/v1/ads. */
function DirectCreative({
  placement,
  locale,
  label,
  consented,
}: {
  placement: AdPlacement;
  locale: Locale;
  label: string;
  consented: boolean;
}) {
  const [ad, setAd] = useState<Ad | null>(null);
  const ref = useRef<HTMLAnchorElement>(null);

  useEffect(() => {
    let cancelled = false;
    const exclude = cappedAdIds(readConsent() === 'all').join(',');
    void fetch(
      `/api/v1/ads?placement=${placement}&locale=${locale}${exclude ? `&exclude=${exclude}` : ''}`,
    )
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
          countCappedImpression(true, ad);
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
