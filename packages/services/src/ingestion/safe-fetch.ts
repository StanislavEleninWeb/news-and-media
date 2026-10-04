import { lookup as dnsLookup, type LookupAddress } from 'node:dns';
import { isIP, type LookupFunction } from 'node:net';
import { Agent, fetch as undiciFetch } from 'undici';

/**
 * Outbound HTTP for scraping. Feed items are third-party input, so every
 * request (and every redirect hop) is checked against private/internal network
 * ranges to prevent SSRF into the VPS's own services (Postgres, Typesense, ...).
 *
 * The check runs inside the connection's DNS lookup, so the address that is
 * validated is the address that is connected to — a hostname cannot resolve to
 * a public IP for the check and to an internal one for the request (DNS rebinding).
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

/** Validates scheme and IP literals; hostnames are checked at connect time (see guardedLookup). */
export function assertPublicUrl(raw: string, allowPrivateNetwork = false): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new FetchError(`Invalid URL: ${raw}`);
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new FetchError(`Unsupported protocol: ${url.protocol}`);
  }
  const host = url.hostname.replace(/^\[|\]$/g, '');
  if (!allowPrivateNetwork && isIP(host) && isPrivateAddress(host)) {
    throw new FetchError(`Refusing to fetch private address: ${url.hostname}`);
  }
  return url;
}

/** DNS lookup that refuses to hand private or internal addresses to the socket. */
export function guardedLookup(allowPrivateNetwork: boolean): LookupFunction {
  return (hostname, options, callback) => {
    dnsLookup(hostname, { ...options, all: true }, (error, addresses: LookupAddress[]) => {
      if (error) return callback(error, '', 0);
      if (
        !addresses.length ||
        (!allowPrivateNetwork && addresses.some((a) => isPrivateAddress(a.address)))
      ) {
        const refused = Object.assign(
          new FetchError(`Refusing to fetch private or unresolvable address: ${hostname}`),
          {
            code: 'ENOTFOUND',
          },
        );
        return callback(refused, '', 0);
      }
      if (options.all)
        return (callback as unknown as (e: null, a: LookupAddress[]) => void)(null, addresses);
      callback(null, addresses[0]!.address, addresses[0]!.family);
    });
  };
}

const agents = new Map<boolean, Agent>();
function agentFor(allowPrivateNetwork: boolean): Agent {
  let agent = agents.get(allowPrivateNetwork);
  if (!agent) {
    agent = new Agent({ connect: { lookup: guardedLookup(allowPrivateNetwork) } });
    agents.set(allowPrivateNetwork, agent);
  }
  return agent;
}

interface StreamingResponse {
  headers: { get(name: string): string | null };
  body: {
    getReader(): {
      read(): Promise<{ done: boolean; value?: Uint8Array }>;
      cancel(): Promise<void>;
    };
  } | null;
}

async function readLimited(response: StreamingResponse, maxBytes: number): Promise<Buffer> {
  const declared = Number(response.headers.get('content-length') ?? '0');
  if (declared > maxBytes) throw new FetchError(`Response too large (${declared} bytes)`);
  if (!response.body) return Buffer.alloc(0);
  const chunks: Uint8Array[] = [];
  let total = 0;
  const reader = response.body.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done || !value) break;
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
    const url = assertPublicUrl(current, options.allowPrivateNetwork);
    const response = await undiciFetch(url, {
      dispatcher: agentFor(options.allowPrivateNetwork ?? false),
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
