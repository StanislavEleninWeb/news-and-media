import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { parseConfig, resetConfig } from '@nm/core/config';
import type { Db } from '@nm/db';
import { notificationPreferences, sessions, users } from '@nm/db/schema';
import { seedTopics } from '@nm/db/seed';
import { createTestDb } from '@nm/db/testing';
import { isDeliveryAllowed, resetMailer, sendMail, useTestOutbox } from '../mail/mailer';
import { createSource } from '../testing/content';
import {
  AccountError,
  authenticate,
  createPasswordReset,
  createSession,
  deleteSession,
  findOrCreateGoogleUser,
  registerUser,
  resetPassword,
  upsertStaffUser,
} from './accounts';
import { fetchGoogleProfile, googleAuthorizeUrl, createPkce } from './google';
import { hashPassword, verifyPassword } from './password';
import { getPreferences, setPreferences } from './preferences';
import { getSessionUser } from './session';

let db: Db;
let close: () => Promise<void>;
beforeAll(async () => {
  ({ db, close } = await createTestDb());
  await seedTopics(db);
});
afterAll(async () => close());

describe('passwords', () => {
  it('hashes with a random salt and verifies', async () => {
    const a = await hashPassword('correct horse battery');
    const b = await hashPassword('correct horse battery');
    expect(a).not.toBe(b);
    expect(a.startsWith('scrypt$16384$8$1$')).toBe(true);
    expect(await verifyPassword('correct horse battery', a)).toBe(true);
    expect(await verifyPassword('wrong horse battery', a)).toBe(false);
    expect(await verifyPassword('x', 'garbage')).toBe(false);
  });
});

describe('accounts and sessions', () => {
  it('registers with a normalised e-mail and default notification settings', async () => {
    const user = await registerUser(db, {
      email: '  Maria@Example.BG ',
      password: 'дълга-парола-123',
      locale: 'bg',
    });
    expect(user).toMatchObject({ email: 'maria@example.bg', role: 'reader', locale: 'bg' });
    const [prefs] = await db
      .select()
      .from(notificationPreferences)
      .where(eq(notificationPreferences.userId, user.id));
    expect(prefs).toMatchObject({ pushUrgent: true, emailDigest: false });
    await expect(
      registerUser(db, { email: 'MARIA@example.bg', password: 'another-password' }),
    ).rejects.toThrow(AccountError);
    await expect(
      registerUser(db, { email: 'short@example.bg', password: 'short' }),
    ).rejects.toThrow(/10 characters/);
  });

  it('authenticates and rejects wrong passwords or unknown users the same way', async () => {
    expect((await authenticate(db, 'maria@EXAMPLE.bg', 'дълга-парола-123')).email).toBe(
      'maria@example.bg',
    );
    await expect(authenticate(db, 'maria@example.bg', 'wrong-password')).rejects.toMatchObject({
      code: 'invalid_credentials',
    });
    await expect(authenticate(db, 'nobody@example.bg', 'whatever-123')).rejects.toMatchObject({
      code: 'invalid_credentials',
    });
  });

  it('stores only a hash of the session token and honours expiry', async () => {
    const user = await authenticate(db, 'maria@example.bg', 'дълга-парола-123');
    const { token } = await createSession(db, user.id, 'test-agent');
    const stored = await db.select().from(sessions).where(eq(sessions.userId, user.id));
    expect(stored.some((s) => s.id === token)).toBe(false);
    expect((await getSessionUser(db, token))?.id).toBe(user.id);
    expect(await getSessionUser(db, token, new Date(Date.now() + 31 * 86_400_000))).toBeNull();
    await deleteSession(db, token);
    expect(await getSessionUser(db, token)).toBeNull();
  });

  it('resets a password once and signs the user out everywhere', async () => {
    const user = await authenticate(db, 'maria@example.bg', 'дълга-парола-123');
    const { token: sessionToken } = await createSession(db, user.id);
    expect(await createPasswordReset(db, 'nobody@example.bg')).toBeNull();
    const reset = (await createPasswordReset(db, 'Maria@example.bg'))!;
    await resetPassword(db, reset.token, 'нова-парола-456');
    expect(await getSessionUser(db, sessionToken)).toBeNull();
    expect((await authenticate(db, 'maria@example.bg', 'нова-парола-456')).id).toBe(user.id);
    await expect(resetPassword(db, reset.token, 'трета-парола-789')).rejects.toMatchObject({
      code: 'invalid_token',
    });
  });

  it('creates and promotes staff accounts', async () => {
    const admin = await upsertStaffUser(db, {
      email: 'editor@seweb.co',
      password: 'editor-password-1',
      role: 'editor',
    });
    expect(admin.role).toBe('editor');
    expect(
      (
        await upsertStaffUser(db, {
          email: 'editor@seweb.co',
          password: 'editor-password-2',
          role: 'admin',
        })
      ).role,
    ).toBe('admin');
    expect((await authenticate(db, 'editor@seweb.co', 'editor-password-2')).role).toBe('admin');
  });
});

describe('Sign in with Google', () => {
  it('links by Google id, then by verified e-mail, else creates an account', async () => {
    const linkedByEmail = await findOrCreateGoogleUser(db, {
      sub: 'g-1',
      email: 'maria@example.bg',
      emailVerified: true,
    });
    const [maria] = await db.select().from(users).where(eq(users.email, 'maria@example.bg'));
    expect(linkedByEmail.id).toBe(maria!.id);
    expect(
      (
        await findOrCreateGoogleUser(db, {
          sub: 'g-1',
          email: 'changed@example.bg',
          emailVerified: true,
        })
      ).id,
    ).toBe(maria!.id);
    const created = await findOrCreateGoogleUser(db, {
      sub: 'g-2',
      email: 'new@gmail.com',
      emailVerified: true,
      name: 'Нов',
    });
    expect(created).toMatchObject({ email: 'new@gmail.com', name: 'Нов', role: 'reader' });
    await expect(
      findOrCreateGoogleUser(db, { sub: 'g-3', email: 'x@y.bg', emailVerified: false }),
    ).rejects.toThrow(AccountError);
  });

  it('builds a PKCE authorize URL and exchanges the code', async () => {
    const pkce = createPkce();
    const url = new URL(
      googleAuthorizeUrl({
        clientId: 'cid',
        redirectUri: 'https://n.bg/cb',
        state: pkce.state,
        codeChallenge: pkce.challenge,
      }),
    );
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
    expect(url.searchParams.get('scope')).toBe('openid email profile');

    const seen: string[] = [];
    const server = createServer((req, res) => {
      let body = '';
      req.on('data', (c) => (body += c));
      req.on('end', () => {
        seen.push(`${req.url} ${body} ${req.headers.authorization ?? ''}`);
        res.setHeader('content-type', 'application/json');
        res.end(
          req.url === '/token'
            ? '{"access_token":"at-1"}'
            : '{"sub":"g-9","email":"a@b.bg","email_verified":true,"name":"A"}',
        );
      });
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const profile = await fetchGoogleProfile({
      code: 'code-1',
      codeVerifier: pkce.verifier,
      clientId: 'cid',
      clientSecret: 'secret',
      redirectUri: 'https://n.bg/cb',
      endpoints: {
        authorize: `${base}/auth`,
        token: `${base}/token`,
        userinfo: `${base}/userinfo`,
      },
    });
    server.close();
    expect(profile).toEqual({ sub: 'g-9', email: 'a@b.bg', emailVerified: true, name: 'A' });
    expect(seen[0]).toContain(`code_verifier=${pkce.verifier}`);
    expect(seen[1]).toContain('Bearer at-1');
  });
});

describe('preferences', () => {
  it('replaces followed topics and sources, ignoring unknown ones', async () => {
    const [maria] = await db.select().from(users).where(eq(users.email, 'maria@example.bg'));
    const source = await createSource(db);
    await setPreferences(db, maria!.id, {
      topics: ['sport', 'tech', 'astrology'],
      sourceIds: [source.id],
    });
    let prefs = await getPreferences(db, maria!.id);
    expect(prefs.topics).toEqual(['tech', 'sport']);
    expect(prefs.sourceIds).toEqual([source.id]);
    await setPreferences(db, maria!.id, { topics: [] });
    prefs = await getPreferences(db, maria!.id);
    expect(prefs.topics).toEqual([]);
    expect(prefs.sourceIds).toEqual([source.id]); // untouched when not provided
  });
});

describe('mailer safety net', () => {
  it('only delivers to allowlisted addresses outside production', async () => {
    const dev = parseConfig({ NOTIFY_ALLOWLIST: 'Me@SEWEB.co, qa@seweb.co' });
    expect(isDeliveryAllowed('me@seweb.co', dev)).toBe(true);
    expect(isDeliveryAllowed('reader@gmail.com', dev)).toBe(false);
    const prod = parseConfig({
      APP_ENV: 'production',
      APP_URL: 'https://n.bg',
      DATABASE_URL: 'x',
      TYPESENSE_URL: 'x',
      TYPESENSE_API_KEY: 'x',
    });
    expect(isDeliveryAllowed('reader@gmail.com', prod)).toBe(true);

    process.env.NOTIFY_ALLOWLIST = 'me@seweb.co';
    resetConfig();
    const outbox = useTestOutbox();
    expect(await sendMail({ to: 'reader@gmail.com', subject: 's', text: 't' })).toEqual({
      delivered: false,
      reason: 'not_allowlisted',
    });
    expect(await sendMail({ to: 'me@seweb.co', subject: 's', text: 't' })).toEqual({
      delivered: true,
    });
    expect(outbox).toHaveLength(1);
    resetMailer();
    delete process.env.NOTIFY_ALLOWLIST;
    resetConfig();
  });
});
