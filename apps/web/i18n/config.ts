export const locales = ['bg', 'en'] as const;
export type Locale = (typeof locales)[number];
export const defaultLocale: Locale = 'bg';
export const LOCALE_COOKIE = 'nm_locale';

export function isLocale(value: string | undefined | null): value is Locale {
  return value === 'bg' || value === 'en';
}

/** Picks bg or en from an Accept-Language header (Bulgarian is the default). */
export function localeFromAcceptLanguage(header: string | null): Locale {
  if (!header) return defaultLocale;
  const ranked = header
    .split(',')
    .map((part) => {
      const [tag = '', q] = part.trim().split(';q=');
      return { lang: tag.slice(0, 2).toLowerCase(), q: q ? Number(q) : 1 };
    })
    .sort((a, b) => b.q - a.q);
  for (const { lang } of ranked) if (isLocale(lang)) return lang;
  return defaultLocale;
}

export const intlLocale = (locale: Locale) => (locale === 'bg' ? 'bg-BG' : 'en-GB');
