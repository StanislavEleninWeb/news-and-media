import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { resetConfig } from '@nm/core/config';
import type { Db } from '@nm/db';
import { resetMailer, useTestOutbox } from '@nm/services/mail/mailer';
import { createPublishedArticle, createSource } from '@nm/services/testing/content';
import { GET as googleCallback } from '@/app/api/v1/auth/google/callback/route';
import { GET as googleStart } from '@/app/api/v1/auth/google/route';
import { POST as login } from '@/app/api/v1/auth/login/route';
import { POST as logout } from '@/app/api/v1/auth/logout/route';
import { POST as confirmReset } from '@/app/api/v1/auth/password-reset/confirm/route';
import { POST as requestReset } from '@/app/api/v1/auth/password-reset/route';
import { POST as register } from '@/app/api/v1/auth/register/route';
import { GET as feed } from '@/app/api/v1/feed/route';
import { PUT as putPreferences } from '@/app/api/v1/me/preferences/route';
import { GET as me } from '@/app/api/v1/me/route';
import { GET as listSources } from '@/app/api/v1/sources/route';
import { request, setupApiTest } from './helpers';

let db: Db;
let close: () => Promise<void>;
const cookieOf = (response: Response) => response.headers.get('set-cookie')!.split(';')[0]!;

beforeAll(async () => {
  process.env.NOTIFY_ALLOWLIST = 'reader@example.bg';
  ({ db, close } = await setupApiTest());
});
afterAll(async () => {
  delete process.env.NOTIFY_ALLOWLIST;
  delete process.env.GOOGLE_CLIENT_ID;
  delete process.env.GOOGLE_CLIENT_SECRET;
  resetConfig();
  resetMailer();
  await close();
});

const post = (path: string, body: unknown, cookie?: string) =>
  request(path, { method: 'POST', body: JSON.stringify(body), cookie });

describe('register, me, logout, login', () => {
  let cookie: string;

  it('registers and signs in with a secure session cookie', async () => {
    const response = await register(
      post('/api/v1/auth/register', {
        email: 'Reader@Example.bg',
        password: 'парола-за-тест',
        locale: 'en',
      }),
    );
    expect(response.status).toBe(201);
    expect(response.headers.get('set-cookie')).toMatch(
      /^nm_session=[\w-]{40,}; Path=\/; Max-Age=2592000; HttpOnly; SameSite=Lax$/,
    );
    cookie = cookieOf(response);
    const body = await (await me(request('/api/v1/me', { cookie }))).json();
    expect(body).toMatchObject({
      user: { email: 'reader@example.bg', locale: 'en' },
      preferences: { topics: [], sourceIds: [] },
    });
  });

  it('rejects duplicate accounts and weak passwords', async () => {
    expect(
      (
        await register(
          post('/api/v1/auth/register', { email: 'reader@example.bg', password: 'парола-за-тест' }),
        )
      ).status,
    ).toBe(409);
    expect(
      (await register(post('/api/v1/auth/register', { email: 'x@example.bg', password: '123' })))
        .status,
    ).toBe(400);
  });

  it('logs out and in again', async () => {
    const out = await logout(request('/api/v1/auth/logout', { method: 'POST', cookie }));
    expect(out.headers.get('set-cookie')).toContain('Max-Age=0');
    expect((await me(request('/api/v1/me', { cookie }))).status).toBe(401);
    expect(
      (
        await login(
          post('/api/v1/auth/login', { email: 'reader@example.bg', password: 'wrong-password' }),
        )
      ).status,
    ).toBe(401);
    const ok = await login(
      post('/api/v1/auth/login', { email: 'READER@example.bg', password: 'парола-за-тест' }),
    );
    expect(ok.status).toBe(200);
  });

  it('throttles repeated login attempts for one account', async () => {
    let last = 0;
    for (let i = 0; i < 12; i += 1) {
      last = (
        await login(
          post('/api/v1/auth/login', { email: 'target@example.bg', password: 'guess-' + i }),
        )
      ).status;
    }
    expect(last).toBe(429);
  });
});

describe('password reset', () => {
  it('e-mails a one-time link and accepts it once', async () => {
    const outbox = useTestOutbox();
    expect(
      (await requestReset(post('/api/v1/auth/password-reset', { email: 'nobody@example.bg' })))
        .status,
    ).toBe(202);
    expect(outbox).toHaveLength(0);
    expect(
      (await requestReset(post('/api/v1/auth/password-reset', { email: 'reader@example.bg' })))
        .status,
    ).toBe(202);
    expect(outbox[0]).toMatchObject({ to: 'reader@example.bg', subject: 'Reset your password' });
    const token = /token=([\w%-]+)/.exec(outbox[0]!.text)![1]!;
    expect(outbox[0]!.text).toContain('http://localhost:3000/en/account/reset?token=');

    expect(
      (
        await confirmReset(
          post('/api/v1/auth/password-reset/confirm', {
            token: decodeURIComponent(token),
            password: 'съвсем-нова-парола',
          }),
        )
      ).status,
    ).toBe(204);
    expect(
      (
        await confirmReset(
          post('/api/v1/auth/password-reset/confirm', {
            token: decodeURIComponent(token),
            password: 'съвсем-нова-парола',
          }),
        )
      ).status,
    ).toBe(400);
    expect(
      (
        await login(
          post('/api/v1/auth/login', {
            email: 'reader@example.bg',
            password: 'съвсем-нова-парола',
          }),
        )
      ).status,
    ).toBe(200);
  });
});

describe('personalized feed', () => {
  it('lifts followed topics for the signed-in reader only', async () => {
    const source = await createSource(db);
    const sport = await createPublishedArticle(db, {
      sourceId: source.id,
      topicSlugs: ['sport'],
      publishedAt: new Date(Date.now() - 5 * 3_600_000),
    });
    await createPublishedArticle(db, {
      sourceId: source.id,
      topicSlugs: ['tech'],
      publishedAt: new Date(Date.now() - 3_600_000),
    });

    const cookie = cookieOf(
      await login(
        post('/api/v1/auth/login', { email: 'reader@example.bg', password: 'съвсем-нова-парола' }),
      ),
    );
    const saved = await putPreferences(
      request('/api/v1/me/preferences', {
        method: 'PUT',
        cookie,
        body: JSON.stringify({ topics: ['sport'] }),
      }),
    );
    expect((await saved.json()).preferences.topics).toEqual(['sport']);

    const mine = await (await feed(request('/api/v1/feed?locale=bg', { cookie }))).json();
    expect(mine.personalized).toBe(true);
    expect(mine.items[0].id).toBe(sport.id);
    const anonymous = await (await feed(request('/api/v1/feed?locale=bg'))).json();
    expect(anonymous.personalized).toBe(false);
    expect(anonymous.items[0].id).not.toBe(sport.id);
  });

  it('lists followable sources', async () => {
    const body = await (await listSources()).json();
    expect(body.sources.length).toBeGreaterThan(0);
  });
});

describe('Sign in with Google (routes)', () => {
  it('is hidden until configured', async () => {
    expect((await googleStart(request('/api/v1/auth/google'))).status).toBe(404);
  });

  it('redirects with PKCE and refuses a callback whose state does not match', async () => {
    process.env.GOOGLE_CLIENT_ID = 'client-id';
    process.env.GOOGLE_CLIENT_SECRET = 'client-secret';
    resetConfig();
    const start = await googleStart(request('/api/v1/auth/google?next=/en/t/tech'));
    expect(start.status).toBe(302);
    const location = new URL(start.headers.get('location')!);
    expect(location.origin).toBe('https://accounts.google.com');
    expect(location.searchParams.get('redirect_uri')).toBe(
      'http://localhost:3000/api/v1/auth/google/callback',
    );
    const stateCookie = cookieOf(start);

    const bad = await googleCallback(
      request('/api/v1/auth/google/callback?code=c&state=forged', { cookie: stateCookie }),
    );
    expect(bad.status).toBe(302);
    expect(bad.headers.get('location')).toBe('/en/t/tech?login=failed');
  });

  it('never redirects off-site after login', async () => {
    const start = await googleStart(request('/api/v1/auth/google?next=//evil.example/phish'));
    const saved = JSON.parse(decodeURIComponent(cookieOf(start).split('=').slice(1).join('=')));
    expect(saved.next).toBe('/');
  });
});
