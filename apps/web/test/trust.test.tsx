import { runInNewContext } from 'node:vm';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { ArticleDetail } from '@nm/services/content/contracts';
import { TrustPanel } from '@/components/article/TrustPanel';
import { displayPrefsScript } from '@/lib/display-prefs';

const article: ArticleDetail = {
  id: '00000000-0000-4000-8000-000000000001',
  locale: 'bg',
  title: 'Заглавие',
  tldr: 'Резюме',
  slug: 'zaglavie',
  path: '/bg/a/00000000-0000-4000-8000-000000000001/zaglavie',
  imageUrl: null,
  imageThumbUrl: null,
  imageCredit: null,
  topics: [],
  publishedAt: '2026-10-04T08:00:00.000Z',
  isUrgent: false,
  body: ['Текст.'],
  isAiRewritten: true,
  isTranslation: true,
  originalUrl: 'https://www.dnevnik.bg/a/1',
  source: {
    id: '00000000-0000-4000-8000-000000000002',
    name: 'Дневник',
    homepageUrl: null,
    credibilityRating: 4,
    credibilityNote: 'Утвърдена медия',
  },
  corrections: [{ locale: 'bg', note: 'Поправена дата', createdAt: '2026-10-04T10:00:00.000Z' }],
  alternates: [],
  related: [],
};

describe('TrustPanel', () => {
  it('discloses AI rewriting, translation, source reliability, the original and corrections', () => {
    const html = renderToStaticMarkup(createElement(TrustPanel, { article, locale: 'bg' }));
    expect(html).toContain('Пренаписано с ИИ');
    expect(html).toContain('въз основа на публикация на Дневник');
    expect(html).toContain('Автоматичен превод');
    expect(html).toContain('Надеждност на източника: <strong>висока</strong>');
    expect(html).toContain('href="https://www.dnevnik.bg/a/1"');
    expect(html).toContain('rel="noopener noreferrer nofollow"');
    expect(html).toContain('Поправена дата');
  });

  it('omits what does not apply', () => {
    const html = renderToStaticMarkup(
      createElement(TrustPanel, {
        article: {
          ...article,
          isAiRewritten: false,
          isTranslation: false,
          corrections: [],
          source: { ...article.source, credibilityRating: null },
        },
        locale: 'en',
      }),
    );
    expect(html).not.toContain('AI-rewritten');
    expect(html).not.toContain('Corrections');
    expect(html).not.toContain('reliability');
  });
});

describe('display preferences script', () => {
  function run(stored: object | null, connection?: object) {
    const dataset: Record<string, string> = {};
    const styles: Record<string, string> = {};
    runInNewContext(displayPrefsScript, {
      localStorage: { getItem: () => (stored ? JSON.stringify(stored) : null) },
      document: {
        documentElement: {
          dataset,
          style: { setProperty: (k: string, v: string) => (styles[k] = v) },
        },
      },
      navigator: { connection },
    });
    return { dataset, styles };
  }

  it('applies saved size, theme and contrast before paint', () => {
    expect(run({ scale: 1.3, theme: 'dark', contrast: 'high' })).toEqual({
      dataset: { theme: 'dark', contrast: 'high' },
      styles: { '--font-scale': '1.3' },
    });
  });

  it('turns on lite mode for data-saver or 2G connections unless the reader opted out', () => {
    expect(run(null, { saveData: true }).dataset.lite).toBe('on');
    expect(run(null, { effectiveType: 'slow-2g' }).dataset.lite).toBe('on');
    expect(run({ lite: false }, { saveData: true }).dataset.lite).toBeUndefined();
    expect(run(null, { effectiveType: '4g' }).dataset.lite).toBeUndefined();
  });

  it('never throws on corrupt storage', () => {
    expect(() =>
      runInNewContext(displayPrefsScript, {
        localStorage: { getItem: () => '{oops' },
        document: {},
        navigator: {},
      }),
    ).not.toThrow();
  });
});
