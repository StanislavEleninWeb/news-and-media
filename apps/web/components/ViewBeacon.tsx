'use client';

import { useEffect } from 'react';

/** Counts one view per page load for "trending now" (no cookies, no third parties). */
export function ViewBeacon({ articleId }: { articleId: string }) {
  useEffect(() => {
    const url = `/api/v1/articles/${articleId}/view`;
    if (!navigator.sendBeacon?.(url)) void fetch(url, { method: 'POST', keepalive: true });
  }, [articleId]);
  return null;
}
