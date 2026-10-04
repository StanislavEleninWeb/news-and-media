import { describe, expect, it } from 'vitest';
import { collapseWhitespace, normalizeTitle, normalizeUrl, titleHash } from './normalize';

describe('normalizeUrl', () => {
  it('drops tracking parameters, fragments and default ports', () => {
    expect(
      normalizeUrl('HTTPS://Example.COM:443/news/item/?utm_source=x&id=5&fbclid=abc#top'),
    ).toBe('https://example.com/news/item?id=5');
  });
  it('resolves relative links against a base', () => {
    expect(normalizeUrl('/a/1.html', 'https://example.com/feed')).toBe(
      'https://example.com/a/1.html',
    );
  });
  it('sorts the remaining query so equivalent URLs match', () => {
    expect(normalizeUrl('https://e.com/p?b=2&a=1')).toBe(normalizeUrl('https://e.com/p?a=1&b=2'));
  });
});

describe('titles', () => {
  it('normalises Cyrillic and Latin titles the same way', () => {
    expect(normalizeTitle('  Парламентът прие БЮДЖЕТА!  ')).toBe('парламентът прие бюджета');
    expect(normalizeTitle('Budget — passed, finally.')).toBe('budget passed finally');
  });
  it('gives syndicated copies of a headline the same hash', () => {
    expect(titleHash('Парламентът прие бюджета')).toBe(titleHash('ПАРЛАМЕНТЪТ прие бюджета.'));
    expect(titleHash('A')).not.toBe(titleHash('B'));
  });
});

describe('collapseWhitespace', () => {
  it('keeps paragraph breaks but removes noise', () => {
    expect(collapseWhitespace('a   b\r\n\r\n\r\n\n c d ')).toBe('a b\n\nc d');
  });
});
