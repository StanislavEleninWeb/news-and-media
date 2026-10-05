import { and, eq, gte, isNull, lte, notInArray, or, sql } from 'drizzle-orm';
import { getConfig, type AppConfig } from '@nm/core/config';
import type { Db } from '@nm/db';
import { adSlots, type AdPlacement, type Locale } from '@nm/db/schema';
import type { Ad, AdServerConfig } from './contracts';

/**
 * Picks one creative for a placement: active, inside its date window, for this
 * locale (or all locales). Direct-sold creatives win over house ads; within a
 * kind the choice is weighted by `weight`. `exclude` holds creatives the
 * reader's browser has already shown up to their daily frequency cap.
 */
export async function pickAd(
  db: Db,
  placement: AdPlacement,
  locale: Locale,
  options: { now?: Date; random?: () => number; exclude?: string[] } = {},
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
        options.exclude?.length ? notInArray(adSlots.id, options.exclude) : undefined,
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
    frequencyCapPerDay: chosen.frequencyCapPerDay,
  };
}

/** What the browser needs to fill ad slots in this environment (served at /api/v1/ads/config). */
export function getAdServerConfig(config: AppConfig = getConfig()): AdServerConfig {
  if (config.ADS_PROVIDER !== 'gam' || !config.GAM_NETWORK_CODE)
    return { provider: 'direct', gam: null, prebid: null };
  return {
    provider: 'gam',
    gam: {
      networkCode: config.GAM_NETWORK_CODE,
      adUnitPrefix: config.GAM_AD_UNIT_PREFIX,
      cmpScriptUrl: config.GAM_CMP_SCRIPT_URL ?? null,
    },
    // Header bidding needs a TCF consent string, i.e. the Google CMP.
    prebid:
      config.PREBID_SCRIPT_URL && config.GAM_CMP_SCRIPT_URL
        ? {
            scriptUrl: config.PREBID_SCRIPT_URL,
            timeoutMs: config.PREBID_TIMEOUT_MS,
            bidders: config.PREBID_BIDDERS,
          }
        : null,
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
