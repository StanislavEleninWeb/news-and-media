import { NextResponse, type NextRequest } from 'next/server';
import { isLocale, LOCALE_COOKIE, localeFromAcceptLanguage } from './i18n/config';

/**
 * Every public page lives under /bg or /en. Requests without a locale prefix
 * are redirected using the reader's last choice (cookie) or browser language.
 */
export function middleware(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  const first = pathname.split('/')[1];

  if (isLocale(first)) {
    const response = NextResponse.next();
    if (request.cookies.get(LOCALE_COOKIE)?.value !== first) {
      response.cookies.set(LOCALE_COOKIE, first, {
        path: '/',
        maxAge: 365 * 86_400,
        sameSite: 'lax',
      });
    }
    return response;
  }

  const saved = request.cookies.get(LOCALE_COOKIE)?.value;
  const locale = isLocale(saved)
    ? saved
    : localeFromAcceptLanguage(request.headers.get('accept-language'));
  const url = request.nextUrl.clone();
  url.pathname = `/${locale}${pathname === '/' ? '' : pathname}`;
  url.search = search;
  return NextResponse.redirect(url);
}

export const config = {
  // Skip API, admin, Next internals, media and any file with an extension (icons, sw.js, ...).
  matcher: ['/((?!api|admin|_next|media|.*\\..*).*)'],
};
