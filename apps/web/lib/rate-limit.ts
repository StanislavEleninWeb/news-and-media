/**
 * In-memory fixed-window rate limiter. The MVP runs a single web container on
 * one VPS, so per-process counters are sufficient; move to Postgres/Redis if
 * the app is ever scaled horizontally.
 */
const windows = new Map<string, { count: number; resetAt: number }>();

export function rateLimit(key: string, limit: number, windowMs: number, now = Date.now()): boolean {
  const entry = windows.get(key);
  if (!entry || entry.resetAt <= now) {
    windows.set(key, { count: 1, resetAt: now + windowMs });
    if (windows.size > 50_000) {
      for (const [k, v] of windows) if (v.resetAt <= now) windows.delete(k);
    }
    return true;
  }
  entry.count += 1;
  return entry.count <= limit;
}

export function resetRateLimits(): void {
  windows.clear();
}
