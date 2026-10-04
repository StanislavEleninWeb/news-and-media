import { mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { getConfig } from '@nm/core/config';

/**
 * Where binary media (article images, ad creatives) lives. The VPS uses the
 * local driver: files are written to a volume that Caddy serves under /media.
 * Another driver (S3/R2) can implement the same interface later.
 */
export interface Storage {
  put(key: string, data: Buffer, contentType: string): Promise<void>;
  delete(key: string): Promise<void>;
  /** Public URL (absolute path) for a stored key. */
  url(key: string): string;
}

export class LocalStorage implements Storage {
  constructor(
    private readonly rootDir: string,
    private readonly baseUrl: string,
  ) {}

  private resolve(key: string): string {
    const full = path.resolve(this.rootDir, key);
    if (!full.startsWith(path.resolve(this.rootDir) + path.sep)) {
      throw new Error(`Invalid storage key: ${key}`);
    }
    return full;
  }

  async put(key: string, data: Buffer): Promise<void> {
    const file = this.resolve(key);
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, data);
  }

  async delete(key: string): Promise<void> {
    await rm(this.resolve(key), { force: true });
  }

  url(key: string): string {
    return `${this.baseUrl.replace(/\/$/, '')}/${key}`;
  }

  get root(): string {
    return path.resolve(this.rootDir);
  }
}

let instance: LocalStorage | undefined;

export function getStorage(): LocalStorage {
  if (!instance) {
    const config = getConfig();
    instance = new LocalStorage(config.STORAGE_LOCAL_DIR, config.MEDIA_BASE_URL);
  }
  return instance;
}

/** Public URL for a storage key without needing a Storage instance (pure; used by read paths). */
export function mediaUrl(key: string | null | undefined): string | null {
  if (!key) return null;
  return `${getConfig().MEDIA_BASE_URL.replace(/\/$/, '')}/${key}`;
}
