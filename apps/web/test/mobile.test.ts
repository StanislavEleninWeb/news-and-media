import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { authTokenResponseSchema, meResponseSchema } from '@nm/contracts';
import type { Db } from '@nm/db';
import { devicePushTokens } from '@nm/db/schema';
import { registerUser } from '@nm/services/auth/accounts';
import { POST as logout } from '@/app/api/v1/auth/logout/route';
import { POST as token } from '@/app/api/v1/auth/token/route';
import { GET as me } from '@/app/api/v1/me/route';
import { DELETE as removeDevice, POST as addDevice } from '@/app/api/v1/push/devices/route';
import { ORIGIN, request, setupApiTest } from './helpers';

/** Requests exactly as the React Native app sends them: no cookies, no Origin. */
const app = (path: string, init: RequestInit & { bearer?: string } = {}) => {
  const headers = new Headers(init.headers);
  if (init.bearer) headers.set('authorization', `Bearer ${init.bearer}`);
  if (init.body) headers.set('content-type', 'application/json');
  return new Request(`${ORIGIN}${path}`, { ...init, headers });
};

let db: Db;
let close: () => Promise<void>;
beforeAll(async () => {
  ({ db, close } = await setupApiTest());
  await registerUser(db, { email: 'app@example.bg', password: 'парола-за-тест', locale: 'bg' });
});
afterAll(async () => close());

describe('mobile app API', () => {
  let bearer: string;

  it('signs in with a bearer token and no cookie', async () => {
    const wrong = await token(
      app('/api/v1/auth/token', {
        method: 'POST',
        body: JSON.stringify({ email: 'app@example.bg', password: 'wrong-password' }),
      }),
    );
    expect(wrong.status).toBe(401);
    const response = await token(
      app('/api/v1/auth/token', {
        method: 'POST',
        body: JSON.stringify({ email: 'app@example.bg', password: 'парола-за-тест' }),
      }),
    );
    expect(response.status).toBe(200);
    expect(response.headers.get('set-cookie')).toBeNull();
    const body = authTokenResponseSchema.parse(await response.json());
    bearer = body.token;
    const profile = meResponseSchema.parse(await (await me(app('/api/v1/me', { bearer }))).json());
    expect(profile.user.email).toBe('app@example.bg');
  });

  it('registers and removes a native push token', async () => {
    const device = JSON.stringify({ token: 'ExponentPushToken[abc123]', platform: 'ios' });
    expect(
      (await addDevice(app('/api/v1/push/devices', { method: 'POST', body: device }))).status,
    ).toBe(401);
    expect(
      (await addDevice(app('/api/v1/push/devices', { method: 'POST', body: device, bearer })))
        .status,
    ).toBe(204);
    expect(await db.select().from(devicePushTokens)).toHaveLength(1);
    const junk = JSON.stringify({ token: 'not-a-token', platform: 'ios' });
    expect(
      (await addDevice(app('/api/v1/push/devices', { method: 'POST', body: junk, bearer }))).status,
    ).toBe(400);
    await removeDevice(
      app('/api/v1/push/devices', {
        method: 'DELETE',
        body: JSON.stringify({ token: 'ExponentPushToken[abc123]' }),
        bearer,
      }),
    );
    expect(await db.select().from(devicePushTokens)).toHaveLength(0);
  });

  it('still rejects cross-site browser writes that carry a bearer header', async () => {
    const device = JSON.stringify({ token: 'ExponentPushToken[abc123]', platform: 'ios' });
    const crossSite = await addDevice(
      request('/api/v1/push/devices', {
        method: 'POST',
        body: device,
        origin: 'https://evil.example',
        headers: { authorization: `Bearer ${bearer}` },
      }),
    );
    expect(crossSite.status).toBe(403);
  });

  it('ends the bearer session on logout', async () => {
    expect((await logout(app('/api/v1/auth/logout', { method: 'POST', bearer }))).status).toBe(204);
    expect((await me(app('/api/v1/me', { bearer }))).status).toBe(401);
  });

  it('ignores a malformed bearer header instead of falling back to a cookie', async () => {
    const response = await me(
      app('/api/v1/me', { headers: { authorization: 'Basic abc', cookie: 'nm_session=x' } }),
    );
    expect(response.status).toBe(401);
  });
});
