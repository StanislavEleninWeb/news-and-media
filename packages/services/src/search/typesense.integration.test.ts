import { describe, expect, it } from 'vitest';
import { TypesenseSearch } from './search';
import { TypesenseClient } from './typesense';

/** Runs against a real Typesense when TYPESENSE_TEST_URL is set (CI service container). */
const url = process.env.TYPESENSE_TEST_URL;
const key = process.env.TYPESENSE_TEST_API_KEY ?? 'test-key';

const doc = (id: string, locale: 'bg' | 'en', title: string, body: string) => ({
  id: `${id}_${locale}`,
  article_id: id,
  locale,
  title,
  tldr: title,
  body,
  slug: id,
  topics: ['politics'],
  source: 'Дневник',
  source_id: 's',
  published_at: 1_790_000_000,
  is_urgent: false,
});

describe.skipIf(!url)('Typesense (real engine)', () => {
  it('finds Bulgarian articles by word and prefix, English ones despite a typo', async () => {
    const search = new TypesenseSearch(new TypesenseClient(url!, key), `it_${Date.now()}_articles`);
    await search.reset();
    await search.upsert([
      doc(
        'x',
        'bg',
        'Парламентът прие бюджета',
        'Народното събрание прие бюджета на второ четене.',
      ),
      doc(
        'x',
        'en',
        'Parliament adopts the budget',
        'The National Assembly adopted the budget at second reading.',
      ),
    ]);

    expect((await search.search({ q: 'бюджета', locale: 'bg' })).found).toBe(1);
    expect((await search.search({ q: 'бюдж', locale: 'bg' })).found).toBe(1); // prefix while typing
    expect((await search.search({ q: 'budjet', locale: 'en' })).found).toBe(1); // one typo
    expect((await search.search({ q: 'бюджета', locale: 'en' })).found).toBe(0); // locale filter
    expect((await search.search({ q: 'бюджета', locale: 'bg', topic: 'sport' })).found).toBe(0);

    await search.removeArticles(['x']);
    expect((await search.search({ q: 'бюджета', locale: 'bg' })).found).toBe(0);
  });
});
