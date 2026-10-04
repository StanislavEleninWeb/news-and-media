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
