import { describe, expect, it } from 'vitest';
import { costUsd, startOfMonthUtc } from './budget';
import { copiedShare } from './originality';
import { extractJson, normaliseBody, parseModelJson, rewriteSchema } from './parse';
import { slugify } from './slug';

describe('parse', () => {
  it('extracts JSON from fenced or chatty answers', () => {
    expect(extractJson('Sure!\n```json\n{"a":1}\n```')).toEqual({ a: 1 });
    expect(extractJson('Here: {"a": {"b": 2}} done')).toEqual({ a: { b: 2 } });
    expect(() => extractJson('no json here')).toThrow();
  });

  it('validates the rewrite shape and normalises topics', () => {
    const body = 'Параграф. '.repeat(40);
    const parsed = parseModelJson(
      JSON.stringify({
        title: 'Заглавие на статия',
        tldr: 'Кратко резюме на новината.',
        body,
        topics: ['Tech', ' sport '],
      }),
      rewriteSchema,
    );
    expect(parsed.topics).toEqual(['tech', 'sport']);
    expect(() => parseModelJson('{"title":"x"}', rewriteSchema)).toThrow(/validation/);
  });

  it('turns model formatting into plain paragraphs', () => {
    expect(normaliseBody('## Heading\nline one\nline two\n\n\n\nsecond')).toBe(
      'Heading line one line two\n\nsecond',
    );
  });
});

describe('copiedShare', () => {
  const source =
    'The council approved a new plan for public transport on Tuesday after months of consultation with residents and operators across the city.';
  it('is high for a verbatim copy and low for a real rewrite', () => {
    expect(copiedShare(source, source)).toBe(1);
    expect(
      copiedShare(
        'After lengthy talks with locals and transport companies, city councillors backed a fresh public transit strategy this week.',
        source,
      ),
    ).toBe(0);
  });
  it('detects partial copying', () => {
    const mixed = `Officials said that ${source.slice(0, 90)} and more details will follow later this month according to the mayor.`;
    expect(copiedShare(mixed, source)).toBeGreaterThan(0.2);
  });
});

describe('slugify', () => {
  it('transliterates Bulgarian with the official system', () => {
    expect(slugify('Щастливи деца в „Юнашка“ гимназия')).toBe(
      'shtastlivi-detsa-v-yunashka-gimnaziya',
    );
    expect(slugify('Ще има ли ток през зимата?')).toBe('shte-ima-li-tok-prez-zimata');
  });
  it('cuts long titles on a word boundary', () => {
    const slug = slugify('word '.repeat(40), 30);
    expect(slug.length).toBeLessThanOrEqual(30);
    expect(slug.endsWith('-')).toBe(false);
  });
});

describe('budget', () => {
  it('prices calls per million tokens', () => {
    expect(
      costUsd({
        usage: { inputTokens: 2_000, outputTokens: 800, cacheReadTokens: 1_000 },
        prices: { input: 1, output: 5, cacheRead: 0.1 },
      }),
    ).toBeCloseTo(0.0061, 6);
  });
  it('starts the month in UTC', () => {
    expect(startOfMonthUtc(new Date('2026-10-31T23:30:00-02:00')).toISOString()).toBe(
      '2026-11-01T00:00:00.000Z',
    );
  });
});
