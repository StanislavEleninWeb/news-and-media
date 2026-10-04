import { createHash } from 'node:crypto';
import type { Db } from '@nm/db';
import { images } from '@nm/db/schema';
import type { Storage } from '../storage';

export const IMAGE_FULL_WIDTH = 1280;
export const IMAGE_THUMB_WIDTH = 480;

export interface StoredImage {
  id: string;
  storageKeyFull: string;
  storageKeyThumb: string;
}

/**
 * Converts a downloaded image into two webp renditions (full + thumbnail used
 * by lite mode), stores them and records the image. Re-encoding also strips
 * metadata and neutralises malformed or hostile files.
 */
export async function storeImage(
  db: Db,
  storage: Storage,
  data: Buffer,
  meta: { originalUrl?: string | null; credit?: string | null; licenseNote?: string | null },
): Promise<StoredImage> {
  const { default: sharp } = await import('sharp');
  const hash = createHash('sha256').update(data).digest('hex');
  const prefix = `img/${hash.slice(0, 2)}/${hash.slice(2, 34)}`;
  const base = sharp(data, { failOn: 'error', limitInputPixels: 40_000_000 }).rotate();
  const { width, height } = await base.metadata();
  if (!width || !height || width < 200 || height < 100) {
    throw new Error('Image too small or unreadable');
  }
  const full = await base
    .clone()
    .resize({ width: IMAGE_FULL_WIDTH, withoutEnlargement: true })
    .webp({ quality: 80 })
    .toBuffer({ resolveWithObject: true });
  const thumb = await base
    .clone()
    .resize({ width: IMAGE_THUMB_WIDTH, withoutEnlargement: true })
    .webp({ quality: 70 })
    .toBuffer();

  const storageKeyFull = `${prefix}-${IMAGE_FULL_WIDTH}.webp`;
  const storageKeyThumb = `${prefix}-${IMAGE_THUMB_WIDTH}.webp`;
  await storage.put(storageKeyFull, full.data, 'image/webp');
  await storage.put(storageKeyThumb, thumb, 'image/webp');

  const [row] = await db
    .insert(images)
    .values({
      originalUrl: meta.originalUrl ?? null,
      storageKeyFull,
      storageKeyThumb,
      width: full.info.width,
      height: full.info.height,
      credit: meta.credit ?? null,
      licenseNote: meta.licenseNote ?? null,
    })
    .returning({ id: images.id });
  return { id: row!.id, storageKeyFull, storageKeyThumb };
}
