import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Db } from '@nm/db';
import { adSlots } from '@nm/db/schema';
import { GET as click } from '@/app/api/v1/ads/[id]/click/route';
import { POST as impression } from '@/app/api/v1/ads/[id]/impression/route';
import { hasAdConsent } from '@/lib/consent';
import { params, request, setupApiTest } from './helpers';

let db: Db;
let close: () => Promise<void>;
let adId: string;
beforeAll(async () => {
  ({ db, close } = await setupApiTest());
  adId = (
    await db
      .insert(adSlots)
      .values({
        name: 'x',
        placement: 'feed_inline',
        kind: 'direct',
        imageUrl: '/media/a.webp',
        targetUrl: 'https://advertiser.bg/offer',
        altText: 'Ad',
        width: 728,
        height: 90,
      })
      .returning()
  )[0]!.id;
});
afterAll(async () => close());

const counts = async () => (await db.select().from(adSlots).where(eq(adSlots.id, adId)))[0]!;

describe('ad measurement respects consent', () => {
  it('parses the consent cookie strictly', () => {
    expect(hasAdConsent('a=1; nm_consent=all')).toBe(true);
    expect(hasAdConsent('nm_consent=necessary')).toBe(false);
    expect(hasAdConsent('nm_consent=allx')).toBe(false);
    expect(hasAdConsent(null)).toBe(false);
  });

  it('counts impressions only with consent, once per visitor per minute', async () => {
    await impression(
      request(`/api/v1/ads/${adId}/impression`, { method: 'POST' }),
      params({ id: adId }),
    );
    expect((await counts()).impressions).toBe(0);
    const consent = { cookie: 'nm_consent=all', headers: { 'x-forwarded-for': '198.51.100.1' } };
    await impression(
      request(`/api/v1/ads/${adId}/impression`, { method: 'POST', ...consent }),
      params({ id: adId }),
    );
    await impression(
      request(`/api/v1/ads/${adId}/impression`, { method: 'POST', ...consent }),
      params({ id: adId }),
    );
    expect((await counts()).impressions).toBe(1);
  });

  it('redirects clicks to the stored advertiser URL and counts only with consent', async () => {
    const anonymous = await click(
      request(`/api/v1/ads/${adId}/click?to=https://evil.test`),
      params({ id: adId }),
    );
    expect(anonymous.status).toBe(302);
    expect(anonymous.headers.get('location')).toBe('https://advertiser.bg/offer');
    expect((await counts()).clicks).toBe(0);
    await click(
      request(`/api/v1/ads/${adId}/click`, { cookie: 'nm_consent=all' }),
      params({ id: adId }),
    );
    expect((await counts()).clicks).toBe(1);
    const missing = crypto.randomUUID();
    expect(
      (await click(request(`/api/v1/ads/${missing}/click`), params({ id: missing }))).status,
    ).toBe(404);
  });
});

describe('ad serving API', () => {
  it('honours the frequency-cap exclude list and validates it', async () => {
    const { GET: pick } = await import('@/app/api/v1/ads/route');
    const shown = await (await pick(request('/api/v1/ads?placement=feed_inline&locale=bg'))).json();
    expect(shown.ad.id).toBe(adId);
    const capped = await (
      await pick(request(`/api/v1/ads?placement=feed_inline&locale=bg&exclude=${adId}`))
    ).json();
    expect(capped.ad).toBeNull();
    expect(
      (await pick(request('/api/v1/ads?placement=feed_inline&locale=bg&exclude=nope'))).status,
    ).toBe(400);
  });

  it('serves the runtime ad server config', async () => {
    const { GET: config } = await import('@/app/api/v1/ads/config/route');
    expect(await config().json()).toEqual({ provider: 'direct', gam: null, prebid: null });
  });
});

describe('/ads.txt', () => {
  it('lists the configured sellers', async () => {
    const { resetConfig } = await import('@nm/core/config');
    const { GET: adsTxt } = await import('@/app/ads.txt/route');
    process.env.ADS_TXT =
      'google.com, pub-123, DIRECT, f08c47fec0942fa0 | example.com, 9, RESELLER';
    resetConfig();
    try {
      expect(await adsTxt().text()).toBe(
        'google.com, pub-123, DIRECT, f08c47fec0942fa0\nexample.com, 9, RESELLER\n',
      );
    } finally {
      delete process.env.ADS_TXT;
      resetConfig();
    }
  });
});
