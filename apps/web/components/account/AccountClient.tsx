'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useState, type FormEvent } from 'react';
import type { Locale } from '@/i18n/config';
import { getMessages } from '@/i18n/messages';
import { api, ApiError } from '@/lib/client-api';
import { useViewer } from '../ViewerProvider';
import { NotificationSettings } from './NotificationSettings';

type Option = { slug: string; name: string };
type SourceOption = { id: string; name: string };

function errorText(locale: Locale, error: unknown) {
  const errors = getMessages(locale).account.errors;
  const code = error instanceof ApiError ? error.code : 'generic';
  return (errors as Record<string, string>)[code] ?? errors.generic;
}

function LoginFailedNotice({ locale }: { locale: Locale }) {
  const params = useSearchParams();
  return params.get('login') === 'failed' ? (
    <p className="alert">{getMessages(locale).account.errors.loginFailed}</p>
  ) : null;
}

function SignInForm({ locale, googleEnabled }: { locale: Locale; googleEnabled: boolean }) {
  const t = getMessages(locale).account;
  const viewer = useViewer();
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setBusy(true);
    setError(null);
    try {
      await api(mode === 'login' ? '/api/v1/auth/login' : '/api/v1/auth/register', {
        method: 'POST',
        body: {
          email: form.get('email'),
          password: form.get('password'),
          ...(mode === 'register' ? { name: form.get('name') || undefined, locale } : {}),
        },
      });
      await viewer.refresh();
    } catch (e) {
      setError(errorText(locale, e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="form-card" onSubmit={submit}>
      <h1>{mode === 'login' ? t.signInTitle : t.registerTitle}</h1>
      <Suspense>
        <LoginFailedNotice locale={locale} />
      </Suspense>
      {error ? (
        <p className="alert" role="alert">
          {error}
        </p>
      ) : null}
      {mode === 'register' ? (
        <label className="field">
          {t.name}
          <input className="input" name="name" autoComplete="name" maxLength={100} />
        </label>
      ) : null}
      <label className="field">
        {t.email}
        <input className="input" name="email" type="email" autoComplete="email" required />
      </label>
      <label className="field">
        {t.password}
        <input
          className="input"
          name="password"
          type="password"
          autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
          minLength={mode === 'register' ? 10 : undefined}
          required
        />
        {mode === 'register' ? <span className="hint">{t.passwordHint}</span> : null}
      </label>
      <button className="button" type="submit" disabled={busy}>
        {mode === 'login' ? t.signIn : t.register}
      </button>
      {mode === 'login' ? (
        <Link className="hint" href={`/${locale}/account/reset`}>
          {t.forgot}
        </Link>
      ) : null}
      {googleEnabled ? (
        <>
          <div className="divider">или / or</div>
          <a className="button button--ghost" href={`/api/v1/auth/google?next=/${locale}/account`}>
            {t.google}
          </a>
        </>
      ) : null}
      <p className="hint">
        {mode === 'login' ? t.noAccount : t.haveAccount}{' '}
        <button
          type="button"
          className="text-button"
          style={{ height: 'auto', padding: 0, textDecoration: 'underline' }}
          onClick={() => setMode(mode === 'login' ? 'register' : 'login')}
        >
          {mode === 'login' ? t.register : t.signIn}
        </button>
      </p>
    </form>
  );
}

function Preferences({
  locale,
  topics,
  sources,
}: {
  locale: Locale;
  topics: Option[];
  sources: SourceOption[];
}) {
  const t = getMessages(locale).account;
  const viewer = useViewer();
  const router = useRouter();
  const [status, setStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setStatus('saving');
    try {
      await api('/api/v1/me/preferences', {
        method: 'PUT',
        body: { topics: form.getAll('topics'), sourceIds: form.getAll('sources') },
      });
      await viewer.refresh();
      setStatus('saved');
    } catch {
      setStatus('error');
    }
  }

  async function signOut() {
    await api('/api/v1/auth/logout', { method: 'POST' });
    await viewer.refresh();
    router.push(`/${locale}`);
  }

  return (
    <div style={{ maxWidth: 760, margin: '0 auto', display: 'grid', gap: '1.5rem' }}>
      <div>
        <h1 className="page-title">{t.title}</h1>
        <p className="card__meta">
          {t.signedInAs} <strong>{viewer.user?.email}</strong>{' '}
          <button className="text-button" type="button" onClick={signOut}>
            {t.signOut}
          </button>
        </p>
      </div>
      <form onSubmit={save} style={{ display: 'grid', gap: '1.25rem' }}>
        <div>
          <h2 className="section-title">{t.interests}</h2>
          <p className="card__meta">{t.interestsHint}</p>
        </div>
        <fieldset style={{ border: 0, padding: 0, margin: 0 }}>
          <legend className="field" style={{ marginBottom: '0.5rem' }}>
            {t.topics}
          </legend>
          <div className="chips">
            {topics.map((topic) => (
              <label className="chip" key={topic.slug}>
                <input
                  type="checkbox"
                  name="topics"
                  value={topic.slug}
                  defaultChecked={viewer.preferences.topics.includes(topic.slug)}
                />
                {topic.name}
              </label>
            ))}
          </div>
        </fieldset>
        {sources.length ? (
          <fieldset style={{ border: 0, padding: 0, margin: 0 }}>
            <legend className="field" style={{ marginBottom: '0.5rem' }}>
              {t.sources}
            </legend>
            <div className="chips">
              {sources.map((source) => (
                <label className="chip" key={source.id}>
                  <input
                    type="checkbox"
                    name="sources"
                    value={source.id}
                    defaultChecked={viewer.preferences.sourceIds.includes(source.id)}
                  />
                  {source.name}
                </label>
              ))}
            </div>
          </fieldset>
        ) : null}
        <div>
          <button className="button" type="submit" disabled={status === 'saving'}>
            {status === 'saved' ? `✓ ${t.saved}` : t.save}
          </button>
          {status === 'error' ? (
            <p className="alert">{getMessages(locale).account.errors.generic}</p>
          ) : null}
        </div>
      </form>
      <NotificationSettings locale={locale} />
    </div>
  );
}

export function AccountClient({
  locale,
  googleEnabled,
  topics,
  sources,
}: {
  locale: Locale;
  googleEnabled: boolean;
  topics: Option[];
  sources: SourceOption[];
}) {
  const viewer = useViewer();
  if (viewer.status === 'loading') return <p className="empty">{getMessages(locale).loading}</p>;
  if (viewer.status === 'anonymous')
    return <SignInForm locale={locale} googleEnabled={googleEnabled} />;
  return <Preferences key={viewer.user?.id} locale={locale} topics={topics} sources={sources} />;
}
