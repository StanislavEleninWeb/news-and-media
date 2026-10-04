import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import path from 'node:path';
import { Readable } from 'node:stream';
import { getConfig } from '@nm/core/config';

/**
 * Serves stored media in local development. On the VPS, Caddy answers /media/*
 * straight from disk before requests reach Next.js, so this route is never hit there.
 */
const types: Record<string, string> = {
  '.webp': 'image/webp',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
};

export async function GET(_request: Request, { params }: { params: Promise<{ key: string[] }> }) {
  const { key } = await params;
  const root = path.resolve(getConfig().STORAGE_LOCAL_DIR);
  const file = path.resolve(root, ...key);
  if (!file.startsWith(root + path.sep)) return new Response('Not found', { status: 404 });
  try {
    const info = await stat(file);
    if (!info.isFile()) return new Response('Not found', { status: 404 });
    const stream = Readable.toWeb(createReadStream(file)) as ReadableStream;
    return new Response(stream, {
      headers: {
        'Content-Type': types[path.extname(file).toLowerCase()] ?? 'application/octet-stream',
        'Content-Length': String(info.size),
        'Cache-Control': 'public, max-age=31536000, immutable',
        'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; sandbox",
      },
    });
  } catch {
    return new Response('Not found', { status: 404 });
  }
}
