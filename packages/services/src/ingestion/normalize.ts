import { createHash } from 'node:crypto';

const trackingParams =
  /^(utm_\w+|fbclid|gclid|dclid|msclkid|mc_cid|mc_eid|igshid|ref|ref_src|cmpid|ocid)$/i;

/** Canonical form of an article URL, used to recognise the same story twice. */
export function normalizeUrl(raw: string, base?: string): string {
  const url = new URL(raw, base);
  url.hash = '';
  url.hostname = url.hostname.toLowerCase();
  for (const key of [...url.searchParams.keys()]) {
    if (trackingParams.test(key)) url.searchParams.delete(key);
  }
  url.searchParams.sort();
  if (
    (url.protocol === 'https:' && url.port === '443') ||
    (url.protocol === 'http:' && url.port === '80')
  ) {
    url.port = '';
  }
  if (url.pathname.length > 1 && url.pathname.endsWith('/'))
    url.pathname = url.pathname.slice(0, -1);
  return url.toString();
}

/** Lower-cased title without punctuation; works for Latin and Cyrillic. */
export function normalizeTitle(title: string): string {
  return title
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

/** Hash used to detect one story syndicated under the same headline by several sources. */
export function titleHash(title: string): string {
  return createHash('sha256').update(normalizeTitle(title)).digest('hex').slice(0, 32);
}

export function collapseWhitespace(text: string): string {
  return text
    .replace(/\r\n?/g, '\n')
    .replace(/[^\S\n]+/g, ' ') // any whitespace except newlines (incl. nbsp)
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
