import { and, eq, gte, isNull, lte, or, sql } from 'drizzle-orm';
import type { Db } from '@nm/db';
import { adSlots, type AdPlacement, type Locale } from '@nm/db/schema';
import type { Ad } from './contracts';

/**
 * Picks one creative for a placement: active, inside its date window, for this
 * locale (or all locales). Direct-sold creatives win over house ads; within a
 * kind the choice is weighted by `weight`.
 */
export async function pickAd(
  db: Db,
  placement: AdPlacement,
  locale: Locale,
  options: { now?: Date; random?: () => number } = {},
): Promise<Ad | null> {
  const now = options.now ?? new Date();
  const rows = await db
    .select()
    .from(adSlots)
    .where(
      and(
        eq(adSlots.placement, placement),
        eq(adSlots.isActive, true),
        or(isNull(adSlots.locale), eq(adSlots.locale, locale)),
        or(isNull(adSlots.startsAt), lte(adSlots.startsAt, now)),
        or(isNull(adSlots.endsAt), gte(adSlots.endsAt, now)),
      ),
    );
  const direct = rows.filter((r) => r.kind === 'direct');
  const pool = direct.length ? direct : rows;
  if (pool.length === 0) return null;
  const total = pool.reduce((sum, r) => sum + Math.max(1, r.weight), 0);
  let pick = (options.random ?? Math.random)() * total;
  const chosen = pool.find((r) => (pick -= Math.max(1, r.weight)) < 0) ?? pool[pool.length - 1]!;
  return {
    id: chosen.id,
    kind: chosen.kind,
    imageUrl: chosen.imageUrl,
    targetUrl: chosen.targetUrl,
    altText: chosen.altText,
    width: chosen.width,
    height: chosen.height,
    advertiser: chosen.advertiser,
  };
}

export async function countAdEvent(
  db: Db,
  adId: string,
  event: 'impression' | 'click',
): Promise<void> {
  const column = event === 'impression' ? adSlots.impressions : adSlots.clicks;
  await db
    .update(adSlots)
    .set(
      event === 'impression' ? { impressions: sql`${column} + 1` } : { clicks: sql`${column} + 1` },
    )
    .where(eq(adSlots.id, adId));
}
