import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { envSchema } from '@nm/core/config';
import type { Db } from '@nm/db';
import { adSlots } from '@nm/db/schema';
import { createTestDb } from '@nm/db/testing';
import { adServerConfigSchema, adSizeMapping, gamAdUnitPath } from './contracts';
import { getAdServerConfig, pickAd } from './ads';

const env = (extra: Record<string, string>) =>
  envSchema.safeParse({ APP_ENV: 'development', ...extra });

describe('ad server configuration', () => {
  it('defaults to the built-in ads', () => {
    expect(getAdServerConfig(env({}).data!)).toEqual({
      provider: 'direct',
      gam: null,
      prebid: null,
    });
  });

  it('serves Ad Manager settings at runtime, Prebid only together with the CMP', () => {
    const base = { ADS_PROVIDER: 'gam', GAM_NETWORK_CODE: '21812345678' };
    const noCmp = getAdServerConfig(
      env({ ...base, PREBID_SCRIPT_URL: '/media/ads/prebid.js' }).data!,
    );
    expect(noCmp).toEqual({
      provider: 'gam',
      gam: { networkCode: '21812345678', adUnitPrefix: 'news', cmpScriptUrl: null },
      prebid: null,
    });
    const full = getAdServerConfig(
      env({
        ...base,
        GAM_CMP_SCRIPT_URL: 'https://fundingchoicesmessages.google.com/i/pub-123?ers=1',
        PREBID_SCRIPT_URL: '/media/ads/prebid.js',
        PREBID_BIDDERS: JSON.stringify({
          article_inline: [{ bidder: 'appnexus', params: { placementId: 13144370 } }],
        }),
      }).data!,
    );
    expect(adServerConfigSchema.parse(full).prebid).toEqual({
      scriptUrl: '/media/ads/prebid.js',
      timeoutMs: 1000,
      bidders: { article_inline: [{ bidder: 'appnexus', params: { placementId: 13144370 } }] },
    });
    expect(gamAdUnitPath(full.gam!, 'home_top')).toBe('/21812345678/news/home_top');
  });

  it('rejects incomplete or unsafe settings', () => {
    expect(env({ ADS_PROVIDER: 'gam' }).success).toBe(false);
    expect(env({ ADS_PROVIDER: 'gam', GAM_NETWORK_CODE: '12ab' }).success).toBe(false);
    expect(
      env({
        ADS_PROVIDER: 'gam',
        GAM_NETWORK_CODE: '1234',
        GAM_CMP_SCRIPT_URL: 'https://evil.example/cmp.js',
      }).success,
    ).toBe(false);
    expect(env({ PREBID_BIDDERS: '{not json' }).success).toBe(false);
  });

  it('only maps sizes that fit the reserved slot boxes', () => {
    for (const mapping of Object.values(adSizeMapping)) {
      for (const [minWidth, sizes] of mapping)
        for (const [width, height] of sizes) {
          expect(width).toBeLessThanOrEqual(Math.max(minWidth, 320));
          expect(height).toBeLessThanOrEqual(100);
        }
      expect(mapping.at(-1)![0]).toBe(0); // every viewport is covered
    }
  });
});

describe('frequency caps (built-in ads)', () => {
  let db: Db;
  let close: () => Promise<void>;
  beforeAll(async () => {
    ({ db, close } = await createTestDb());
  });
  afterAll(async () => close());

  it('skips creatives the browser reports as capped and exposes the cap', async () => {
    const base = {
      placement: 'feed_inline' as const,
      imageUrl: '/media/a.webp',
      targetUrl: 'https://advertiser.bg',
      altText: 'Ad',
      width: 728,
      height: 90,
    };
    const [capped] = await db
      .insert(adSlots)
      .values({ ...base, name: 'capped', kind: 'direct', frequencyCapPerDay: 3 })
      .returning();
    const [house] = await db
      .insert(adSlots)
      .values({ ...base, name: 'house', kind: 'house' })
      .returning();
    const first = await pickAd(db, 'feed_inline', 'bg');
    expect(first).toMatchObject({ id: capped!.id, frequencyCapPerDay: 3 });
    const next = await pickAd(db, 'feed_inline', 'bg', { exclude: [capped!.id] });
    expect(next).toMatchObject({ id: house!.id, frequencyCapPerDay: null });
  });
});
