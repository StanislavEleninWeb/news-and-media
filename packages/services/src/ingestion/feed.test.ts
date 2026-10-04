import { describe, expect, it } from 'vitest';
import { rssFeed } from '../testing/fixtures';
import { parseFeed } from './feed';

describe('parseFeed', () => {
  it('parses RSS items with dates, images and relative links', async () => {
    const xml = rssFeed([
      {
        title: 'Първа новина',
        link: '/a/1',
        date: 'Wed, 01 Oct 2026 08:00:00 GMT',
        image: 'https://cdn.example.bg/1.jpg',
      },
      { title: 'Втора новина', link: 'https://example.bg/a/2', description: '<p>Кратко</p>' },
      { title: '', link: '/a/3' },
    ]);
    const items = await parseFeed(xml, 'https://example.bg/rss');
    expect(items).toHaveLength(2);
    expect(items[0]).toMatchObject({
      title: 'Първа новина',
      link: 'https://example.bg/a/1',
      imageUrl: 'https://cdn.example.bg/1.jpg',
      author: 'Редакция',
    });
    expect(items[0]!.publishedAt?.toISOString()).toBe('2026-10-01T08:00:00.000Z');
    expect(items[1]!.content).toContain('Кратко');
  });

  it('parses Atom feeds', async () => {
    const atom = `<?xml version="1.0" encoding="utf-8"?>
<feed xmlns="http://www.w3.org/2005/Atom"><title>T</title>
<entry><title>Atom story</title><link href="https://example.com/s/1"/><updated>2026-10-02T10:00:00Z</updated><id>1</id></entry>
</feed>`;
    const items = await parseFeed(atom, 'https://example.com/atom');
    expect(items[0]).toMatchObject({ title: 'Atom story', link: 'https://example.com/s/1' });
  });
});
