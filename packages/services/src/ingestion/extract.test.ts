import { describe, expect, it } from 'vitest';
import { articleHtml, longBgParagraphs } from '../testing/fixtures';
import { extractArticle, extractListingLinks, htmlToText } from './extract';

describe('extractArticle', () => {
  const html = articleHtml({
    title: 'Парламентът прие промени в данъците',
    image: '/img/hero.jpg',
    published: '2026-10-01T08:30:00+03:00',
  });
  const article = extractArticle(html, 'https://example.bg/politika/123')!;

  it('keeps the article body and drops navigation, sidebars and footers', () => {
    expect(article.text).toContain(longBgParagraphs[0]);
    expect(article.text).toContain(longBgParagraphs[3]);
    expect(article.text).not.toContain('Най-четени');
    expect(article.text).not.toContain('Всички права запазени');
  });

  it('separates paragraphs with blank lines', () => {
    expect(article.text.split('\n\n').length).toBeGreaterThanOrEqual(4);
  });

  it('reads metadata', () => {
    expect(article.title).toContain('Парламентът прие промени в данъците');
    expect(article.imageUrl).toBe('https://example.bg/img/hero.jpg');
    expect(article.publishedAt?.toISOString()).toBe('2026-10-01T05:30:00.000Z');
    expect(article.lang).toBe('bg');
  });

  it('returns null for pages without readable content', () => {
    expect(extractArticle('<html><body><nav>menu</nav></body></html>', 'https://e.bg/')).toBeNull();
  });
});

describe('htmlToText', () => {
  it('does not duplicate text of nested blocks', () => {
    expect(htmlToText('<ul><li><p>one</p></li><li>two</li></ul><p>three</p>')).toBe(
      'one\n\ntwo\n\nthree',
    );
  });
});

describe('extractListingLinks', () => {
  it('returns unique same-site links matched by the selector', () => {
    const html = `<div class="news"><a href="/a/1">1</a></div><div class="news"><h2><a href="/a/2?x=1">2</a></h2></div>
      <div class="news"><a href="https://other.example/a/3">3</a></div><div class="news"><a href="/a/1">dup</a></div>`;
    expect(extractListingLinks(html, 'https://example.bg/list', '.news')).toEqual([
      'https://example.bg/a/1',
      'https://example.bg/a/2?x=1',
    ]);
  });
});
