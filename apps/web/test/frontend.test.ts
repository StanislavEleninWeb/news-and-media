import { NextRequest } from 'next/server';
import { describe, expect, it } from 'vitest';
import { localeFromAcceptLanguage } from '@/i18n/config';
import { getMessages } from '@/i18n/messages';
import { safeNextPath } from '@/lib/auth-cookies';
import { formatRelative } from '@/lib/format';
import { middleware } from '@/middleware';

describe('locale routing', () => {
  it('prefers English only when the browser ranks it above Bulgarian', () => {
    expect(localeFromAcceptLanguage(null)).toBe('bg');
    expect(localeFromAcceptLanguage('en-GB,en;q=0.9')).toBe('en');
    expect(localeFromAcceptLanguage('bg-BG,bg;q=0.9,en;q=0.8')).toBe('bg');
    expect(localeFromAcceptLanguage('de-DE,de;q=0.9')).toBe('bg');
    expect(localeFromAcceptLanguage('de;q=0.9,en;q=0.5')).toBe('en');
  });

  it('redirects prefix-less URLs and remembers the chosen language', () => {
    const fromBrowser = middleware(
      new NextRequest('http://localhost/t/tech?x=1', { headers: { 'accept-language': 'en' } }),
    );
    expect(fromBrowser.headers.get('location')).toBe('http://localhost/en/t/tech?x=1');

    const fromCookie = middleware(
      new NextRequest('http://localhost/', {
        headers: { cookie: 'nm_locale=bg', 'accept-language': 'en' },
      }),
    );
    expect(fromCookie.headers.get('location')).toBe('http://localhost/bg');

    const visit = middleware(new NextRequest('http://localhost/en/a/x/y'));
    expect(visit.headers.get('location')).toBeNull();
    expect(visit.cookies.get('nm_locale')?.value).toBe('en');
  });
});

describe('formatting & messages', () => {
  it('formats relative times in both languages', () => {
    const now = Date.parse('2026-10-04T12:00:00Z');
    expect(formatRelative('2026-10-04T11:55:00Z', 'en', now)).toBe('5 minutes ago');
    expect(formatRelative('2026-10-04T09:00:00Z', 'bg', now)).toBe('преди 3 часа');
  });

  it('has the same message keys in Bulgarian and English', () => {
    const keys = (value: unknown, prefix = ''): string[] =>
      typeof value === 'object' && value !== null
        ? Object.entries(value).flatMap(([k, v]) => keys(v, `${prefix}${k}.`))
        : [prefix];
    expect(keys(getMessages('bg')).sort()).toEqual(keys(getMessages('en')).sort());
  });
});

describe('safeNextPath', () => {
  it('only allows same-site relative paths', () => {
    expect(safeNextPath('/bg/account')).toBe('/bg/account');
    expect(safeNextPath('//evil.example')).toBe('/');
    expect(safeNextPath('/\\evil.example')).toBe('/');
    expect(safeNextPath('https://evil.example')).toBe('/');
    expect(safeNextPath(null, '/en')).toBe('/en');
  });
});
