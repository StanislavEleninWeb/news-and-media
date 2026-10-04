import type { Metadata, Viewport } from 'next';
import { notFound } from 'next/navigation';
import type { ReactNode } from 'react';
import '@/styles/globals.css';
import { SiteFooter, SiteHeader } from '@/components/SiteChrome';
import { ViewerProvider } from '@/components/ViewerProvider';
import { isLocale } from '@/i18n/config';
import { getMessages } from '@/i18n/messages';
import { displayPrefsScript } from '@/lib/display-prefs';
import { getNavTopics, siteName, siteUrl } from '@/lib/site';

// Pages are rendered on first request and then served from cache (ISR) —
// nothing is pre-rendered at build time, so builds never need a database.
export function generateStaticParams() {
  return [];
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  if (!isLocale(locale)) return {};
  const name = siteName();
  return {
    metadataBase: new URL(siteUrl()),
    title: { default: `${name} — ${getMessages(locale).siteTagline}`, template: `%s · ${name}` },
    description: getMessages(locale).siteTagline,
    alternates: { languages: { bg: '/bg', en: '/en' } },
    openGraph: { siteName: name, locale: locale === 'bg' ? 'bg_BG' : 'en_GB', type: 'website' },
  };
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#fbfaf7' },
    { media: '(prefers-color-scheme: dark)', color: '#0f1115' },
  ],
};

export default async function LocaleLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  const topics = await getNavTopics(locale);
  const name = siteName();
  return (
    <html lang={locale} suppressHydrationWarning>
      <head>
        {/* Applies saved reading preferences before first paint (no theme flash). */}
        <script dangerouslySetInnerHTML={{ __html: displayPrefsScript }} />
      </head>
      <body>
        <a className="skip-link" href="#content">
          {locale === 'bg' ? 'Към съдържанието' : 'Skip to content'}
        </a>
        <ViewerProvider>
          <SiteHeader locale={locale} siteName={name} topics={topics} />
          <main id="content">{children}</main>
          <SiteFooter locale={locale} siteName={name} />
        </ViewerProvider>
      </body>
    </html>
  );
}
