'use client';

/**
 * Per-reader daily frequency caps for built-in (direct-sold) ads. Counts live
 * only in this browser and only after the reader consented; without consent
 * there is no capping (nothing is stored). Ad Manager line items are capped
 * in Ad Manager itself.
 */
const KEY = 'nm_adfreq';

interface Store {
  day: string;
  counts: Record<string, { n: number; cap: number }>;
}

const today = () => new Date().toISOString().slice(0, 10);

function read(): Store {
  try {
    const store = JSON.parse(localStorage.getItem(KEY) ?? 'null') as Store | null;
    if (store && store.day === today()) return store;
  } catch {
    // unavailable or corrupted
  }
  return { day: today(), counts: {} };
}

/** Ads that reached their cap today (sent as `exclude` to /api/v1/ads). */
export function cappedAdIds(consented: boolean): string[] {
  if (!consented) return [];
  return Object.entries(read().counts)
    .filter(([, c]) => c.n >= c.cap)
    .map(([id]) => id)
    .slice(0, 20);
}

export function countCappedImpression(
  consented: boolean,
  ad: { id: string; frequencyCapPerDay: number | null },
): void {
  if (!consented || !ad.frequencyCapPerDay) return;
  const store = read();
  const entry = store.counts[ad.id] ?? { n: 0, cap: ad.frequencyCapPerDay };
  store.counts[ad.id] = { n: entry.n + 1, cap: ad.frequencyCapPerDay };
  try {
    localStorage.setItem(KEY, JSON.stringify(store));
  } catch {
    // storage full or blocked: no capping
  }
}
