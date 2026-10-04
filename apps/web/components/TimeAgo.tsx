'use client';

import { useEffect, useState } from 'react';
import type { Locale } from '@/i18n/config';
import { formatDateTime, formatRelative } from '@/lib/format';

/**
 * Server-rendered pages are cached, so relative times ("5 min ago") would go
 * stale. The server renders the absolute time; the browser swaps in a live
 * relative one after hydration.
 */
export function TimeAgo({ iso, locale }: { iso: string; locale: Locale }) {
  const [label, setLabel] = useState(() => formatDateTime(iso, locale));
  useEffect(() => {
    const update = () => setLabel(formatRelative(iso, locale));
    update();
    const timer = setInterval(update, 60_000);
    return () => clearInterval(timer);
  }, [iso, locale]);
  return (
    <time dateTime={iso} title={formatDateTime(iso, locale)} suppressHydrationWarning>
      {label}
    </time>
  );
}
