import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Db } from '@nm/db';
import { createTestDb } from '@nm/db/testing';
import { pickAd } from '../content/ads';
import { LocalStorage } from '../storage';
import { adInputSchema, saveAd, storeAdCreative } from './ads';

let db: Db;
let close: () => Promise<void>;
let dir: string;
beforeAll(async () => {
  ({ db, close } = await createTestDb());
  dir = await mkdtemp(path.join(tmpdir(), 'nm-ads-'));
});
afterAll(async () => {
  await close();
  await rm(dir, { recursive: true, force: true });
});

const form = {
  name: 'Banka X — октомври',
  placement: 'feed_inline',
  locale: '',
  kind: 'direct',
  advertiser: 'Banka X',
  imageUrl: '/media/ads/aa/creative.webp',
  targetUrl: 'https://banka-x.bg/kampania',
  altText: 'Банка X — нова кредитна карта',
  weight: '2',
  startsAt: '',
  endsAt: '',
  isActive: true,
};

describe('ad admin', () => {
  it('validates input and sizes the slot from its placement', async () => {
    const input = adInputSchema.parse(form);
    expect(input).toMatchObject({ locale: null, weight: 2, startsAt: null });
    const ad = (await saveAd(db, input))!;
    expect([ad.width, ad.height]).toEqual([728, 90]);
    expect((await pickAd(db, 'feed_inline', 'en'))!.altText).toBe('Банка X — нова кредитна карта');
  });

  it('rejects unsafe or inconsistent creatives', () => {
    expect(adInputSchema.safeParse({ ...form, targetUrl: 'javascript:alert(1)' }).success).toBe(
      false,
    );
    expect(
      adInputSchema.safeParse({ ...form, imageUrl: 'http://insecure.example/a.png' }).success,
    ).toBe(false);
    expect(
      adInputSchema.safeParse({ ...form, startsAt: '2026-10-10T10:00', endsAt: '2026-10-01T10:00' })
        .success,
    ).toBe(false);
  });

  it('re-encodes uploaded creatives to webp in storage', async () => {
    const png = await sharp({
      create: { width: 728, height: 90, channels: 3, background: '#13233a' },
    })
      .png()
      .toBuffer();
    const url = await storeAdCreative(new LocalStorage(dir, '/media'), png);
    expect(url).toMatch(/^\/media\/ads\/[0-9a-f]{2}\/[0-9a-f]{32}\.webp$/);
    const files = await readdir(path.join(dir, 'ads'), { recursive: true });
    expect(files.some((f) => String(f).endsWith('.webp'))).toBe(true);
    await expect(
      storeAdCreative(new LocalStorage(dir, '/media'), Buffer.from('not an image')),
    ).rejects.toThrow();
  });
});
