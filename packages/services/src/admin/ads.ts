import { createHash } from 'node:crypto';
import { asc, eq } from 'drizzle-orm';
import { z } from 'zod';
import type { Db } from '@nm/db';
import { adSlots } from '@nm/db/schema';
import { adPlacements } from '../content/contracts';
import type { Storage } from '../storage';

/** Creative size per placement (desktop); on phones every slot shows at 320×100. */
export const placementSizes: Record<
  (typeof adPlacements)[number],
  { width: number; height: number; label: string }
> = {
  home_top: { width: 970, height: 90, label: 'Home — top banner' },
  feed_inline: { width: 728, height: 90, label: 'Feed — between stories' },
  article_inline: { width: 728, height: 90, label: 'Article — inside the text' },
  article_bottom: { width: 970, height: 90, label: 'Article — after the text' },
  search_inline: { width: 728, height: 90, label: 'Search — between results' },
};

const optionalDate = z
  .string()
  .optional()
  .transform((value, ctx) => {
    if (!value) return null;
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'invalid date' });
      return z.NEVER;
    }
    return date;
  });

export const adInputSchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    placement: z.enum(adPlacements),
    locale: z.enum(['bg', 'en', '']).transform((v) => (v === '' ? null : v)),
    kind: z.enum(['direct', 'house']),
    advertiser: z
      .string()
      .trim()
      .max(120)
      .optional()
      .transform((v) => v || null),
    imageUrl: z.string().trim().max(2000),
    targetUrl: z
      .string()
      .trim()
      .url()
      .max(2000)
      .refine((u) => /^https?:\/\//.test(u), 'http(s) only'),
    altText: z.string().trim().min(1).max(200),
    weight: z.coerce.number().int().min(1).max(100),
    frequencyCapPerDay: z
      .string()
      .optional()
      .transform((v) => (v ? Number(v) : null))
      .pipe(z.number().int().min(1).max(50).nullable()),
    startsAt: optionalDate,
    endsAt: optionalDate,
    isActive: z.boolean(),
  })
  .refine((ad) => ad.imageUrl.startsWith('/media/') || /^https:\/\//.test(ad.imageUrl), {
    message: 'Upload an image or give an https:// image URL',
    path: ['imageUrl'],
  })
  .refine((ad) => !ad.startsAt || !ad.endsAt || ad.endsAt > ad.startsAt, {
    message: 'End must be after start',
    path: ['endsAt'],
  });
export type AdInput = z.infer<typeof adInputSchema>;

export const listAds = (db: Db) =>
  db.select().from(adSlots).orderBy(asc(adSlots.placement), asc(adSlots.name));

export async function saveAd(db: Db, input: AdInput, id?: string) {
  const size = placementSizes[input.placement];
  const values = { ...input, width: size.width, height: size.height };
  if (id) {
    const [row] = await db.update(adSlots).set(values).where(eq(adSlots.id, id)).returning();
    return row;
  }
  const [row] = await db.insert(adSlots).values(values).returning();
  return row;
}

export async function deleteAd(db: Db, id: string) {
  await db.delete(adSlots).where(eq(adSlots.id, id));
}

/** Re-encodes an uploaded creative to webp (strips metadata, neutralises hostile files). */
export async function storeAdCreative(storage: Storage, data: Buffer): Promise<string> {
  const { default: sharp } = await import('sharp');
  const image = sharp(data, { failOn: 'error', limitInputPixels: 20_000_000, animated: false });
  const meta = await image.metadata();
  if (!meta.width || !meta.height) throw new Error('Unreadable image');
  const output = await image
    .resize({ width: Math.min(meta.width, 1940), withoutEnlargement: true })
    .webp({ quality: 85 })
    .toBuffer();
  const hash = createHash('sha256').update(output).digest('hex');
  const key = `ads/${hash.slice(0, 2)}/${hash.slice(2, 34)}.webp`;
  await storage.put(key, output, 'image/webp');
  return storage.url(key);
}
