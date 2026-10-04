'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import type { Locale } from '@/i18n/config';
import { getMessages } from '@/i18n/messages';
import { api } from '@/lib/client-api';

/** Step 1 (no token): request a link. Step 2 (token in URL): choose a new password. */
export function ResetClient({ locale }: { locale: Locale }) {
  const t = getMessages(locale).account;
  const token = useSearchParams().get('token');
  const [state, setState] = useState<'idle' | 'busy' | 'done' | 'error'>('idle');

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setState('busy');
    try {
      if (token) {
        await api('/api/v1/auth/password-reset/confirm', {
          method: 'POST',
          body: { token, password: form.get('password') },
        });
      } else {
        await api('/api/v1/auth/password-reset', {
          method: 'POST',
          body: { email: form.get('email') },
        });
      }
      setState('done');
    } catch {
      setState('error');
    }
  }

  return (
    <form className="form-card" onSubmit={submit}>
      <h1>{t.reset.requestTitle}</h1>
      {state === 'done' ? (
        <>
          <p className="alert alert--ok">{token ? t.reset.done : t.reset.sent}</p>
          {token ? (
            <Link className="button" href={`/${locale}/account`}>
              {t.signIn}
            </Link>
          ) : null}
        </>
      ) : (
        <>
          {state === 'error' ? (
            <p className="alert">{token ? t.reset.invalid : t.errors.generic}</p>
          ) : null}
          {token ? (
            <label className="field">
              {t.reset.newPassword}
              <input
                className="input"
                name="password"
                type="password"
                autoComplete="new-password"
                minLength={10}
                required
              />
              <span className="hint">{t.passwordHint}</span>
            </label>
          ) : (
            <>
              <p className="hint">{t.reset.requestHint}</p>
              <label className="field">
                {t.email}
                <input className="input" name="email" type="email" autoComplete="email" required />
              </label>
            </>
          )}
          <button className="button" type="submit" disabled={state === 'busy'}>
            {token ? t.reset.confirm : t.reset.send}
          </button>
        </>
      )}
    </form>
  );
}
