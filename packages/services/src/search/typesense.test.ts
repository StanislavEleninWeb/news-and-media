import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { TypesenseSearch } from './search';
import { TypesenseClient } from './typesense';

// A recording stub of the Typesense HTTP API. The real engine is covered by
// typesense.integration.test.ts when TYPESENSE_TEST_URL is set (CI).
type Request = { method: string; url: string; body: string; headers: Record<string, unknown> };
const requests: Request[] = [];
let base = '';
const stub = createServer((req, res) => {
  let body = '';
  req.on('data', (c) => (body += c));
  req.on('end', () => {
    requests.push({ method: req.method!, url: req.url!, body, headers: req.headers });
    res.setHeader('content-type', 'application/json');
    if (req.url!.startsWith('/collections/test_articles/documents/import')) {
      res.end(
        body
          .split('\n')
          .map(() => '{"success":true}')
          .join('\n'),
      );
    } else if (req.url!.startsWith('/collections/test_articles/documents/search')) {
      res.end(
        JSON.stringify({
          found: 1,
          page: 1,
          hits: [
            {
              document: {
                id: 'a1_bg',
                article_id: 'a1',
                locale: 'bg',
                title: 'Заглавие',
                tldr: 'Резюме',
                body: 'Текст',
                slug: 'zaglavie',
                topics: ['tech'],
                source: 'Дневник',
                source_id: 's1',
                image: 'img/x-480.webp',
                published_at: 1_790_000_000,
                is_urgent: false,
              },
              highlight: { tldr: { snippet: '<mark>Резюме</mark>' } },
            },
          ],
          facet_counts: [{ field_name: 'topics', counts: [{ value: 'tech', count: 1 }] }],
        }),
      );
    } else if (req.url === '/collections/test_articles' && req.method === 'GET') {
      res.statusCode = 404;
      res.end('{"message":"Not Found"}');
    } else {
      res.end('{}');
    }
  });
});

beforeAll(async () => {
  await new Promise<void>((resolve) => stub.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${(stub.address() as AddressInfo).port}`;
});
afterAll(() => new Promise<void>((resolve) => stub.close(() => resolve())));

describe('TypesenseSearch', () => {
  const search = () => new TypesenseSearch(new TypesenseClient(base, 'secret'), 'test_articles');

  it('creates the collection when missing', async () => {
    await search().ensure();
    const create = requests.find((r) => r.method === 'POST' && r.url === '/collections')!;
    expect(JSON.parse(create.body)).toMatchObject({
      name: 'test_articles',
      default_sorting_field: 'published_at',
    });
    expect(create.headers['x-typesense-api-key']).toBe('secret');
  });

  it('upserts documents as JSONL and deletes by article id', async () => {
    await search().upsert([
      {
        id: 'a_bg',
        article_id: 'a',
        locale: 'bg',
        title: 't',
        tldr: 't',
        body: 'b',
        slug: 's',
        topics: [],
        source: 's',
        source_id: 's',
        published_at: 1,
        is_urgent: false,
      },
      {
        id: 'a_en',
        article_id: 'a',
        locale: 'en',
        title: 't',
        tldr: 't',
        body: 'b',
        slug: 's',
        topics: [],
        source: 's',
        source_id: 's',
        published_at: 1,
        is_urgent: false,
      },
    ]);
    const imported = requests.find((r) => r.url.includes('/documents/import'))!;
    expect(imported.url).toContain('action=upsert');
    expect(imported.body.split('\n')).toHaveLength(2);

    await search().removeArticles(['a', 'b`x']);
    const deletion = requests.find((r) => r.method === 'DELETE')!;
    expect(decodeURIComponent(deletion.url)).toContain('filter_by=article_id:=[`a`,`bx`]');
  });

  it('builds a locale/topic-filtered query and maps hits', async () => {
    const result = await search().search({
      q: 'резюме',
      locale: 'bg',
      topic: 'tech',
      page: 1,
      perPage: 10,
    });
    const query = new URL(requests.at(-1)!.url, 'http://x').searchParams;
    expect(query.get('filter_by')).toBe('locale:=`bg` && topics:=`tech`');
    expect(query.get('query_by')).toBe('title,tldr,body');
    expect(query.get('sort_by')).toBe('_text_match:desc,published_at:desc');
    expect(result.hits[0]).toMatchObject({
      articleId: 'a1',
      imageUrl: '/media/img/x-480.webp',
      highlight: '<mark>Резюме</mark>',
      publishedAt: new Date(1_790_000_000_000).toISOString(),
    });
    expect(result.facets.topics).toEqual([{ slug: 'tech', count: 1 }]);
  });

  it('lists the newest articles for an empty query', async () => {
    await search().search({ q: '  ', locale: 'en' });
    const query = new URL(requests.at(-1)!.url, 'http://x').searchParams;
    expect(query.get('q')).toBe('*');
    expect(query.get('sort_by')).toBe('published_at:desc');
  });
});
