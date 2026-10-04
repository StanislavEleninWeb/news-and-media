import { describe, expect, it } from 'vitest';
import { decodeBody, detectCharset } from './decode';

describe('decodeBody', () => {
  it('decodes windows-1251 declared in a meta tag', () => {
    // "Новини" in windows-1251
    const bytes = Buffer.from([0xcd, 0xee, 0xe2, 0xe8, 0xed, 0xe8]);
    const html = Buffer.concat([
      Buffer.from('<html><head><meta charset="windows-1251"></head><body>'),
      bytes,
      Buffer.from('</body></html>'),
    ]);
    expect(detectCharset(html, 'text/html')).toBe('windows-1251');
    expect(decodeBody(html, 'text/html')).toContain('Новини');
  });
  it('prefers the Content-Type header and defaults to utf-8', () => {
    expect(
      detectCharset(
        Buffer.from('<?xml version="1.0" encoding="ISO-8859-1"?>'),
        'text/xml; charset=UTF-8',
      ),
    ).toBe('utf-8');
    expect(decodeBody(Buffer.from('Здравей'), '')).toBe('Здравей');
  });
});
