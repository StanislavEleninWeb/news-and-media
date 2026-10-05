import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { isLocale } from '@/i18n/config';
import { getAdServerConfig } from '@nm/services/content/ads';
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
      bg: 'Анонимен идентификатор, за да запомним реакцията ви към статия (и, със съгласие, какво четете).',
      en: 'Anonymous id that remembers your reaction to an article (and, with consent, what you read).',
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
  const adManager = getAdServerConfig().provider === 'gam';
  return (
    <div className="container article">
      <h1 className="article__title">{bg ? 'Поверителност и бисквитки' : 'Privacy and cookies'}</h1>
      <div className="article__body" style={{ fontFamily: 'var(--sans)', fontSize: '1rem' }}>
        <p>
          {adManager
            ? bg
              ? `${siteName()} събира минимално количество данни и няма външни инструменти за анализ. Рекламите се показват чрез Google Ad Manager — вижте по-долу.`
              : `${siteName()} collects as little data as possible and uses no third-party analytics. Ads are served through Google Ad Manager — see below.`
            : bg
              ? `${siteName()} събира минимално количество данни. Нямаме рекламни мрежи, проследяване между сайтове или външни инструменти за анализ.`
              : `${siteName()} collects as little data as possible. There are no ad networks, cross-site trackers or third-party analytics.`}
        </p>
        {adManager ? (
          <>
            <h2 className="section-title" style={{ marginTop: '2rem' }}>
              {bg ? 'Реклами от Google' : 'Ads from Google'}
            </h2>
            <p>
              {bg
                ? 'Рекламните места се обслужват от Google Ad Manager и партньорите в рекламния търг. Персонализирани реклами и бисквитки на Google се използват само ако се съгласите в прозореца за поверителност на Google; иначе се показват само „ограничени“ реклами без бисквитки и без профилиране.'
                : 'Ad slots are served by Google Ad Manager and the partners in its auction. Personalised ads and Google cookies are used only if you agree in Google’s privacy message; otherwise only “limited” ads without cookies or profiling are shown.'}
            </p>
          </>
        ) : null}
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
          {bg
            ? 'Персонализация по четене (само със съгласие)'
            : 'Personalisation from your reading (only with consent)'}
        </h2>
        <p>
          {bg
            ? 'Ако приемете всички бисквитки (или включите персонализацията в приложението), записваме кои статии отваряте, колко време ги четете и на кои реагирате или запазвате. От тях подреждаме новините по темите и източниците, които четете най-често. Данните се използват само в този сайт, пазят се до 90 дни и се изтриват веднага, щом оттеглите съгласието си.'
            : 'If you accept all cookies (or switch on personalisation in the app), we record which stories you open, how long you read them and which you react to or save. We use this only to rank news from the topics and sources you read most. It never leaves this site, is kept for up to 90 days and is deleted as soon as you withdraw consent.'}
        </p>
        <h2 className="section-title" style={{ marginTop: '2rem' }}>
          {bg ? '„Попитай статията“' : '“Ask this article”'}
        </h2>
        <p>
          {bg
            ? 'Въпросите ви и текстът на статията се изпращат на доставчика на езиковия модел (Anthropic), за да се генерира отговор. Не пазим текста на разговорите — само броя въпроси за ограничаване на злоупотреби.'
            : 'Your questions and the article text are sent to the language-model provider (Anthropic) to generate the answer. We do not keep the conversation text — only the number of questions, to prevent abuse.'}
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
