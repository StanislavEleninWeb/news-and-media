'use client';

import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { api, ApiError } from '@/lib/client-api';

export function LoginForm({ forbidden }: { forbidden: boolean }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(
    forbidden ? 'This account has no editor access.' : null,
  );
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setBusy(true);
    setError(null);
    try {
      await api('/api/v1/auth/login', {
        method: 'POST',
        body: { email: form.get('email'), password: form.get('password') },
      });
      router.replace('/admin');
      router.refresh();
    } catch (e) {
      setError(
        e instanceof ApiError && e.code === 'rate_limited'
          ? 'Too many attempts — wait a few minutes.'
          : 'Wrong email or password.',
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="form-card" onSubmit={submit}>
      <h1>Newsroom sign-in</h1>
      {error ? <p className="alert">{error}</p> : null}
      <label className="field">
        Email
        <input className="input" name="email" type="email" autoComplete="username" required />
      </label>
      <label className="field">
        Password
        <input
          className="input"
          name="password"
          type="password"
          autoComplete="current-password"
          required
        />
      </label>
      <button className="button" type="submit" disabled={busy}>
        Sign in
      </button>
    </form>
  );
}
