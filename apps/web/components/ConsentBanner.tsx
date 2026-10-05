'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import type { Locale } from '@/i18n/config';
import { CONSENT_EVENT, readConsent, writeConsent } from '@/lib/consent';

const text = {
  bg: {
    body: 'Използваме само необходимите бисквитки, за да работи сайтът. С ваше съгласие подреждаме новините според това, което четете, и броим показванията и кликовете на рекламите (без проследяване между сайтове).',
    accept: 'Приемам всички',
    necessary: 'Само необходимите',
    more: 'Повече',
    settings: 'Настройки за бисквитки',
  },
  en: {
    body: 'We only use the cookies the site needs to work. With your consent we also rank stories by what you read and count ad views and clicks (no cross-site tracking).',
    accept: 'Accept all',
    necessary: 'Necessary only',
    more: 'Learn more',
    settings: 'Cookie settings',
  },
};

export function ConsentBanner({ locale }: { locale: Locale }) {
  const t = text[locale];
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const update = () => setVisible(readConsent() === null);
    update();
    window.addEventListener(CONSENT_EVENT, update);
    return () => window.removeEventListener(CONSENT_EVENT, update);
  }, []);
  if (!visible) return null;
  return (
    <div className="consent" role="region" aria-label={t.settings}>
      <p>
        {t.body} <Link href={`/${locale}/privacy`}>{t.more}</Link>
      </p>
      <div className="consent__actions">
        <button
          className="button button--ghost"
          type="button"
          onClick={() => writeConsent('necessary')}
        >
          {t.necessary}
        </button>
        <button className="button" type="button" onClick={() => writeConsent('all')}>
          {t.accept}
        </button>
      </div>
    </div>
  );
}

/** Footer link that re-opens the consent choice. */
export function CookieSettingsLink({ locale }: { locale: Locale }) {
  return (
    <button
      className="text-button"
      style={{ padding: 0, height: 'auto' }}
      type="button"
      onClick={() => writeConsent(null)}
    >
      {text[locale].settings}
    </button>
  );
}
