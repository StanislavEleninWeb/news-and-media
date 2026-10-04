'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { Locale } from '@/i18n/config';
import { getMessages } from '@/i18n/messages';
import { DisplaySettings } from './DisplaySettings';
import { BookmarkIcon, SearchIcon, UserIcon } from './Icons';
import { useViewer } from './ViewerProvider';

export function LanguageSwitch({ locale }: { locale: Locale }) {
  const pathname = usePathname() ?? `/${locale}`;
  const other: Locale = locale === 'bg' ? 'en' : 'bg';
  const target = pathname.replace(/^\/(bg|en)(?=\/|$)/, `/${other}`);
  return (
    <Link
      className="text-button lang-switch"
      href={target}
      hrefLang={other}
      lang={other}
      prefetch={false}
    >
      {other.toUpperCase()}
    </Link>
  );
}

export function HeaderActions({ locale }: { locale: Locale }) {
  const t = getMessages(locale);
  const viewer = useViewer();
  return (
    <div className="masthead__actions">
      <Link
        className="icon-button"
        href={`/${locale}/search`}
        aria-label={t.nav.search}
        prefetch={false}
      >
        <SearchIcon />
      </Link>
      {viewer.status === 'signed-in' ? (
        <Link
          className="icon-button"
          href={`/${locale}/saved`}
          aria-label={t.nav.saved}
          prefetch={false}
        >
          <BookmarkIcon />
        </Link>
      ) : null}
      <DisplaySettings locale={locale} />
      <LanguageSwitch locale={locale} />
      <Link className="text-button" href={`/${locale}/account`} prefetch={false}>
        <UserIcon />
        <span>{viewer.status === 'signed-in' ? t.nav.account : t.nav.signIn}</span>
      </Link>
    </div>
  );
}

export function TopicNav({
  locale,
  topics,
}: {
  locale: Locale;
  topics: { slug: string; name: string }[];
}) {
  const pathname = usePathname();
  const t = getMessages(locale);
  const items = [
    { href: `/${locale}`, label: t.nav.home },
    ...topics.map((topic) => ({ href: `/${locale}/t/${topic.slug}`, label: topic.name })),
  ];
  return (
    <nav className="topic-nav" aria-label={t.nav.topics}>
      <ul className="container topic-nav__list">
        {items.map((item) => (
          <li key={item.href}>
            <Link
              className="topic-nav__link"
              href={item.href}
              aria-current={pathname === item.href ? 'page' : undefined}
            >
              {item.label}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
