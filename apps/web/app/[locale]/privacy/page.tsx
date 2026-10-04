import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { isLocale } from '@/i18n/config';
import { siteName } from '@/lib/site';

export const revalidate = 86_400;

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  return { title: locale === 'en' ? 'Privacy and cookies' : 'Поверителност и бисквитки' };
}

const cookies = [
  [
    'nm_session',
    { bg: 'Вход в профила (само ако влезете).', en: 'Keeps you signed in (only if you sign in).' },
  ],
  ['nm_locale', { bg: 'Запомня избрания език.', en: 'Remembers your language.' }],
  [
    'nm_aid',
    {
      bg: 'Анонимен идентификатор, за да запомним реакцията ви към статия.',
      en: 'Anonymous id that remembers your reaction to an article.',
    },
  ],
  ['nm_consent', { bg: 'Запомня избора ви за бисквитките.', en: 'Remembers your cookie choice.' }],
] as const;

/**
 * Plain-language privacy notice for the MVP. Have it reviewed by a lawyer
 * before launch (see the discovery document, section D).
 */
export default async function PrivacyPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  const bg = locale === 'bg';
  return (
    <div className="container article">
      <h1 className="article__title">{bg ? 'Поверителност и бисквитки' : 'Privacy and cookies'}</h1>
      <div className="article__body" style={{ fontFamily: 'var(--sans)', fontSize: '1rem' }}>
        <p>
          {bg
            ? `${siteName()} събира минимално количество данни. Нямаме рекламни мрежи, проследяване между сайтове или външни инструменти за анализ.`
            : `${siteName()} collects as little data as possible. There are no ad networks, cross-site trackers or third-party analytics.`}
        </p>
        <h2 className="section-title" style={{ marginTop: '2rem' }}>
          {bg ? 'Необходими бисквитки' : 'Necessary cookies'}
        </h2>
        <ul>
          {cookies.map(([name, description]) => (
            <li key={name}>
              <code>{name}</code> — {description[locale]}
            </li>
          ))}
        </ul>
        <h2 className="section-title" style={{ marginTop: '2rem' }}>
          {bg ? 'Измерване на рекламите (само със съгласие)' : 'Ad measurement (only with consent)'}
        </h2>
        <p>
          {bg
            ? 'Ако приемете всички бисквитки, броим колко пъти е показана и кликната всяка реклама. Броят се само общи числа — без профил, без идентификатор и без данни за други сайтове.'
            : 'If you accept all cookies, we count how often each ad is shown and clicked. Only totals are kept — no profile, no identifier and nothing about other sites.'}
        </p>
        <h2 className="section-title" style={{ marginTop: '2rem' }}>
          {bg ? 'Настройки на устройството' : 'On your device'}
        </h2>
        <p>
          {bg
            ? 'Настройките за четене (размер на текста, тема) и офлайн копията на запазени статии се пазят само в браузъра ви.'
            : 'Reading settings (text size, theme) and offline copies of saved articles stay in your browser only.'}
        </p>
        <h2 className="section-title" style={{ marginTop: '2rem' }}>
          {bg ? 'Профил и известия' : 'Account and notifications'}
        </h2>
        <p>
          {bg
            ? 'Ако си направите профил, пазим имейла, интересите ви и настройките за известия, за да персонализираме новините. Можете да поискате изтриване по всяко време.'
            : 'If you create an account we keep your e-mail, interests and notification settings to personalise your news. You can ask for deletion at any time.'}
        </p>
      </div>
    </div>
  );
}
