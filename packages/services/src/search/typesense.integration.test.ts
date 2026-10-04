import { describe, expect, it } from 'vitest';
import { TypesenseSearch } from './search';
import { TypesenseClient } from './typesense';

/** Runs against a real Typesense when TYPESENSE_TEST_URL is set (CI service container). */
const url = process.env.TYPESENSE_TEST_URL;
const key = process.env.TYPESENSE_TEST_API_KEY ?? 'test-key';

describe.skipIf(!url)('Typesense (real engine)', () => {
  it('indexes and finds a Bulgarian article with a typo', async () => {
    const search = new TypesenseSearch(new TypesenseClient(url!, key), `it_${Date.now()}_articles`);
    await search.reset();
    await search.upsert([
      {
        id: 'x_bg',
        article_id: 'x',
        locale: 'bg',
        title: 'Парламентът прие бюджета',
        tldr: 'Депутатите гласуваха бюджета за 2027 г.',
        body: 'Народното събрание прие бюджета на второ четене.',
        slug: 'parlamentat',
        topics: ['politics'],
        source: 'Дневник',
        source_id: 's',
        published_at: 1_790_000_000,
        is_urgent: false,
      },
    ]);
    const result = await search.search({ q: 'бюджта', locale: 'bg' });
    expect(result.found).toBe(1);
    expect((await search.search({ q: 'бюджета', locale: 'bg', topic: 'sport' })).found).toBe(0);
    await search.removeArticles(['x']);
    expect((await search.search({ q: 'бюджета', locale: 'bg' })).found).toBe(0);
  });
});
