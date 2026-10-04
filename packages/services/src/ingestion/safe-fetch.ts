import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';

/**
 * Outbound HTTP for scraping. Feed items are third-party input, so every
 * request (and every redirect hop) is checked against private/internal network
 * ranges to prevent SSRF into the VPS's own services (Postgres, Typesense, ...).
 */

export class FetchError extends Error {
  constructor(
    message: string,
    public readonly status?: number,
  ) {
    super(message);
    this.name = 'FetchError';
  }
}

export interface SafeFetchOptions {
  userAgent: string;
  timeoutMs: number;
  maxBytes?: number;
  accept?: string;
  allowPrivateNetwork?: boolean;
  maxRedirects?: number;
}

export interface SafeFetchResult {
  url: string;
  status: number;
  contentType: string;
  body: Buffer;
}

function ipv4ToInt(ip: string): number {
  return ip.split('.').reduce((acc, part) => (acc << 8) + Number(part), 0) >>> 0;
}

const privateV4: [string, number][] = [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['224.0.0.0', 4],
  ['240.0.0.0', 4],
];

export function isPrivateAddress(ip: string): boolean {
  const version = isIP(ip);
  if (version === 4) {
    const value = ipv4ToInt(ip);
    return privateV4.some(([base, bits]) => {
      const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0;
      return (value & mask) === (ipv4ToInt(base) & mask);
    });
  }
  if (version === 6) {
    const lower = ip.toLowerCase();
    if (lower === '::1' || lower === '::') return true;
    if (lower.startsWith('::ffff:')) return isPrivateAddress(lower.slice(7));
    return /^(fc|fd|fe8|fe9|fea|feb)/.test(lower);
  }
  return true;
}

export async function assertPublicUrl(raw: string, allowPrivateNetwork = false): Promise<URL> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new FetchError(`Invalid URL: ${raw}`);
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new FetchError(`Unsupported protocol: ${url.protocol}`);
  }
  if (allowPrivateNetwork) return url;
  const host = url.hostname.replace(/^\[|\]$/g, '');
  const addresses = isIP(host) ? [{ address: host }] : await lookup(host, { all: true });
  if (addresses.length === 0 || addresses.some((a) => isPrivateAddress(a.address))) {
    throw new FetchError(`Refusing to fetch private or unresolvable address: ${url.hostname}`);
  }
  return url;
}

async function readLimited(response: Response, maxBytes: number): Promise<Buffer> {
  const declared = Number(response.headers.get('content-length') ?? '0');
  if (declared > maxBytes) throw new FetchError(`Response too large (${declared} bytes)`);
  if (!response.body) return Buffer.alloc(0);
  const chunks: Uint8Array[] = [];
  let total = 0;
  const reader = response.body.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      throw new FetchError(`Response exceeded ${maxBytes} bytes`);
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks);
}

export async function safeFetch(
  rawUrl: string,
  options: SafeFetchOptions,
): Promise<SafeFetchResult> {
  const maxRedirects = options.maxRedirects ?? 5;
  let current = rawUrl;
  for (let hop = 0; hop <= maxRedirects; hop += 1) {
    const url = await assertPublicUrl(current, options.allowPrivateNetwork);
    const response = await fetch(url, {
      redirect: 'manual',
      signal: AbortSignal.timeout(options.timeoutMs),
      headers: {
        'User-Agent': options.userAgent,
        Accept: options.accept ?? '*/*',
        'Accept-Language': 'bg,en;q=0.8,*;q=0.5',
      },
    });
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get('location');
      await response.body?.cancel();
      if (!location) throw new FetchError('Redirect without location', response.status);
      current = new URL(location, url).toString();
      continue;
    }
    const body = await readLimited(response, options.maxBytes ?? 5 * 1024 * 1024);
    if (!response.ok) throw new FetchError(`HTTP ${response.status} for ${url}`, response.status);
    return {
      url: url.toString(),
      status: response.status,
      contentType: response.headers.get('content-type') ?? '',
      body,
    };
  }
  throw new FetchError(`Too many redirects for ${rawUrl}`);
}
