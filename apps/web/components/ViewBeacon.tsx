'use client';

import { useEffect } from 'react';
import { readConsent } from '@/lib/consent';

/** Ignore reading time below this (bounces, mis-taps). */
const MIN_DWELL_MS = 3_000;

function send(url: string, body?: unknown) {
  // text/plain keeps sendBeacon a "simple" request; the API parses the JSON itself.
  const payload =
    body === undefined ? undefined : new Blob([JSON.stringify(body)], { type: 'text/plain' });
  if (!navigator.sendBeacon?.(url, payload))
    void fetch(url, { method: 'POST', body: payload, keepalive: true }).catch(() => undefined);
}

/**
 * Counts one view per page load for "trending now" (no cookies, no third
 * parties). With consent it also reports the open and the visible reading
 * time, which feed the reader's behavioural ranking.
 */
export function ViewBeacon({ articleId }: { articleId: string }) {
  useEffect(() => {
    send(`/api/v1/articles/${articleId}/view`);
    if (readConsent() !== 'all') return;

    send('/api/v1/events', { events: [{ articleId, kind: 'click' }] });
    let visibleSince = document.visibilityState === 'visible' ? Date.now() : 0;
    let total = 0;
    let reported = false;
    const flush = () => {
      if (visibleSince) total += Date.now() - visibleSince;
      visibleSince = 0;
      if (reported || total < MIN_DWELL_MS) return;
      reported = true;
      send('/api/v1/events', {
        events: [{ articleId, kind: 'dwell', dwellMs: Math.round(total) }],
      });
    };
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') flush();
      else if (!reported) visibleSince = Date.now();
    };
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('pagehide', flush);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('pagehide', flush);
      flush(); // client-side navigation to another page
    };
  }, [articleId]);
  return null;
}
