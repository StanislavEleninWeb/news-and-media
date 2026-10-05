import type { Locale } from './api';

const strings = {
  bg: {
    feed: 'Новини',
    search: 'Търсене',
    saved: 'Запазени',
    account: 'Профил',
    all: 'Всички',
    breaking: 'Извънредно',
    loadMore: 'Още новини',
    retry: 'Опитай отново',
    offline: 'Няма връзка. Показваме последно заредените новини.',
    error: 'Нещо се обърка.',
    searchPlaceholder: 'Търсете новини…',
    noResults: 'Няма резултати.',
    savedEmpty: 'Запазете статия, за да я прочетете по-късно.',
    signInToSave: 'Влезте, за да запазвате статии.',
    signIn: 'Вход',
    signOut: 'Изход',
    email: 'Имейл',
    password: 'Парола',
    invalidCredentials: 'Грешен имейл или парола.',
    signedInAs: 'Влезли сте като',
    language: 'Език',
    notifications: 'Известия',
    pushOn: 'Извънредни новини на това устройство',
    pushDenied: 'Известията са изключени в настройките на телефона.',
    save: 'Запази',
    unsave: 'Запазено',
    readOriginal: 'Прочетете оригинала',
    source: 'Източник',
    aiNote: 'Текстът е обобщен с помощта на ИИ и е редактиран.',
    translated: 'Преведено автоматично',
    related: 'Свързани',
    corrections: 'Корекции',
    reactions: 'Вашата реакция',
    noAccount: 'Нямате профил? Регистрирайте се на сайта.',
    personalization: 'Персонализация',
    personalizeOn: 'Подреждай новините според това, което чета',
    personalizeNote:
      'Записваме кои статии отваряте и колко време ги четете, само за подреждането на новините тук. Изключването изтрива историята.',
    askTitle: 'Попитайте статията',
    askIntro: 'Отговорите идват само от текста на тази статия.',
    askPlaceholder: 'Вашият въпрос…',
    askSend: 'Питай',
    askSignIn: 'Влезте, за да задавате въпроси.',
    askLimit: 'Достигнахте лимита за въпроси. Опитайте по-късно.',
    askUnavailable: 'Функцията временно не е налична.',
  },
  en: {
    feed: 'News',
    search: 'Search',
    saved: 'Saved',
    account: 'Account',
    all: 'All',
    breaking: 'Breaking',
    loadMore: 'More stories',
    retry: 'Try again',
    offline: 'You are offline. Showing the last loaded stories.',
    error: 'Something went wrong.',
    searchPlaceholder: 'Search the news…',
    noResults: 'No results.',
    savedEmpty: 'Save a story to read it later.',
    signInToSave: 'Sign in to save stories.',
    signIn: 'Sign in',
    signOut: 'Sign out',
    email: 'E-mail',
    password: 'Password',
    invalidCredentials: 'Wrong e-mail or password.',
    signedInAs: 'Signed in as',
    language: 'Language',
    notifications: 'Notifications',
    pushOn: 'Breaking news on this device',
    pushDenied: 'Notifications are turned off in the phone settings.',
    save: 'Save',
    unsave: 'Saved',
    readOriginal: 'Read the original',
    source: 'Source',
    aiNote: 'Summarised with the help of AI and reviewed.',
    translated: 'Machine-translated',
    related: 'Related',
    corrections: 'Corrections',
    reactions: 'Your reaction',
    noAccount: 'No account? Register on the website.',
    personalization: 'Personalisation',
    personalizeOn: 'Rank stories by what I read',
    personalizeNote:
      'We record which stories you open and how long you read, only to rank the news here. Turning it off deletes the history.',
    askTitle: 'Ask this article',
    askIntro: 'Answers come only from the text of this article.',
    askPlaceholder: 'Your question…',
    askSend: 'Ask',
    askSignIn: 'Sign in to ask questions.',
    askLimit: "You've reached the question limit. Try again later.",
    askUnavailable: 'This feature is temporarily unavailable.',
  },
} as const;

export type StringKey = keyof (typeof strings)['bg'];
export const t = (locale: Locale, key: StringKey) => strings[locale][key];

export const reactionEmoji = {
  like: '👍',
  insightful: '💡',
  surprising: '😮',
  sad: '😢',
  angry: '😠',
} as const;

export function timeAgo(iso: string, locale: Locale, now = Date.now()): string {
  const minutes = Math.max(0, Math.round((now - Date.parse(iso)) / 60_000));
  const rtf = new Intl.RelativeTimeFormat(locale === 'bg' ? 'bg' : 'en', { numeric: 'auto' });
  if (minutes < 60) return rtf.format(-minutes, 'minute');
  const hours = Math.round(minutes / 60);
  if (hours < 24) return rtf.format(-hours, 'hour');
  return rtf.format(-Math.round(hours / 24), 'day');
}
