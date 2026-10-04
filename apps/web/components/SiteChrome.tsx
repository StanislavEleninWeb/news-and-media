import Link from 'next/link';
import type { Locale } from '@/i18n/config';
import { getMessages } from '@/i18n/messages';
import { formatDate } from '@/lib/format';
import { HeaderActions, TopicNav } from './HeaderClient';
import { InstallButton } from './PwaSupport';

export function SiteHeader({
  locale,
  siteName,
  topics,
}: {
  locale: Locale;
  siteName: string;
  topics: { slug: string; name: string }[];
}) {
  return (
    <header className="masthead">
      <div className="container masthead__bar">
        <div>
          <Link className="brand" href={`/${locale}`}>
            {siteName}
            <span className="brand__dot">.</span>
          </Link>
          <div className="masthead__date" suppressHydrationWarning>
            {formatDate(new Date(), locale)}
          </div>
        </div>
        <HeaderActions locale={locale} />
      </div>
      <TopicNav locale={locale} topics={topics} />
    </header>
  );
}

export function SiteFooter({ locale, siteName }: { locale: Locale; siteName: string }) {
  const t = getMessages(locale);
  return (
    <footer className="site-footer">
      <div className="container site-footer__inner">
        <div>
          <div className="brand">
            {siteName}
            <span className="brand__dot">.</span>
          </div>
          <p style={{ marginTop: '0.5rem', maxWidth: '60ch' }}>{t.footer.about}</p>
        </div>
        <div>
          <p>
            {t.footer.language}:{' '}
            <Link href="/bg" hrefLang="bg">
              Български
            </Link>{' '}
            ·{' '}
            <Link href="/en" hrefLang="en">
              English
            </Link>
          </p>
          <p style={{ marginTop: '0.5rem' }}>
            © {new Date().getFullYear()} {siteName}. {t.footer.rights}
          </p>
          <div style={{ marginTop: '0.75rem' }}>
            <InstallButton locale={locale} />
          </div>
        </div>
      </div>
    </footer>
  );
}
