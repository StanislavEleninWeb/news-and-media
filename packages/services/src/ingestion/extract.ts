import { Readability } from '@mozilla/readability';
import { parseHTML } from 'linkedom';
import { collapseWhitespace } from './normalize';

export interface ExtractedArticle {
  title: string | null;
  /** Plain text, paragraphs separated by blank lines. */
  text: string;
  byline: string | null;
  imageUrl: string | null;
  publishedAt: Date | null;
  lang: string | null;
}

const BLOCKS = 'p, h2, h3, h4, li, blockquote, pre';

/** Converts an HTML fragment to paragraphs of plain text. */
export function htmlToText(html: string): string {
  const { document } = parseHTML(`<!doctype html><html><body>${html}</body></html>`);
  const blocks = [...document.querySelectorAll(BLOCKS)].filter(
    (el) => !el.parentElement?.closest(BLOCKS),
  );
  const paragraphs = blocks.length
    ? blocks.map((el) => el.textContent ?? '')
    : [document.body?.textContent ?? ''];
  return collapseWhitespace(
    paragraphs
      .map((p) => p.replace(/\s+/g, ' ').trim())
      .filter((p) => p.length > 0)
      .join('\n\n'),
  );
}

function meta(document: Document, selector: string): string | null {
  return document.querySelector(selector)?.getAttribute('content')?.trim() || null;
}

/** Extracts the main article from a full HTML page (Mozilla Readability). */
export function extractArticle(html: string, pageUrl: string): ExtractedArticle | null {
  const { document } = parseHTML(html);
  const imageRaw =
    meta(document, 'meta[property="og:image"]') ?? meta(document, 'meta[name="twitter:image"]');
  const publishedRaw =
    meta(document, 'meta[property="article:published_time"]') ??
    document.querySelector('time[datetime]')?.getAttribute('datetime') ??
    null;
  const lang = document.documentElement?.getAttribute('lang')?.slice(0, 2).toLowerCase() || null;

  const parsed = new Readability(document as unknown as Document, { charThreshold: 300 }).parse();
  if (!parsed?.content) return null;
  const text = htmlToText(parsed.content);
  if (text.length < 80) return null;

  let imageUrl: string | null = null;
  if (imageRaw) {
    try {
      imageUrl = new URL(imageRaw, pageUrl).toString();
    } catch {
      imageUrl = null;
    }
  }
  const published = publishedRaw ? new Date(publishedRaw) : null;
  return {
    title: parsed.title?.trim() || null,
    text,
    byline: parsed.byline?.trim() || null,
    imageUrl,
    publishedAt: published && !Number.isNaN(published.getTime()) ? published : null,
    lang,
  };
}

/** Article links on an HTML listing page, selected with the source's CSS selector. */
export function extractListingLinks(html: string, pageUrl: string, selector: string): string[] {
  const { document } = parseHTML(html);
  const origin = new URL(pageUrl).origin;
  const links = new Set<string>();
  for (const element of document.querySelectorAll(selector)) {
    const anchor = element.tagName === 'A' ? element : element.querySelector('a[href]');
    const href = anchor?.getAttribute('href');
    if (!href || href.startsWith('#') || href.startsWith('javascript:')) continue;
    try {
      const url = new URL(href, pageUrl);
      if (url.origin === origin) links.add(url.toString());
    } catch {
      // ignore malformed links
    }
  }
  return [...links];
}
