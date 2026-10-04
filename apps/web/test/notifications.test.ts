import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { resetConfig } from '@nm/core/config';
import type { Db } from '@nm/db';
import { pushSubscriptions } from '@nm/db/schema';
import { GET as getSettings, PUT as putSettings } from '@/app/api/v1/me/notifications/route';
import { DELETE as unsubscribe, POST as subscribe } from '@/app/api/v1/push/subscriptions/route';
import { GET as vapidKey } from '@/app/api/v1/push/vapid-public-key/route';
import { request, setupApiTest, signedInCookie } from './helpers';

let db: Db;
let close: () => Promise<void>;
beforeAll(async () => {
  ({ db, close } = await setupApiTest());
});
afterAll(async () => {
  delete process.env.VAPID_PUBLIC_KEY;
  resetConfig();
  await close();
});

const subscription = {
  endpoint: 'https://fcm.googleapis.com/fcm/send/abc',
  keys: {
    p256dh:
      'BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1XbjhazAkj7I99e8QcYP7DkM',
    auth: 'tBHItJI5svbpez7KI4CCXg',
  },
};

describe('push API', () => {
  it('serves the VAPID public key at runtime', async () => {
    expect((await (await vapidKey()).json()).key).toBeNull();
    process.env.VAPID_PUBLIC_KEY = 'BPublicKey';
    resetConfig();
    expect((await (await vapidKey()).json()).key).toBe('BPublicKey');
  });

  it('stores and removes this device for a signed-in reader', async () => {
    const body = JSON.stringify(subscription);
    expect(
      (await subscribe(request('/api/v1/push/subscriptions', { method: 'POST', body }))).status,
    ).toBe(401);
    const { cookie } = await signedInCookie(db);
    expect(
      (await subscribe(request('/api/v1/push/subscriptions', { method: 'POST', body, cookie })))
        .status,
    ).toBe(204);
    expect(await db.select().from(pushSubscriptions)).toHaveLength(1);
    const insecure = JSON.stringify({ ...subscription, endpoint: 'http://evil.test/x' });
    expect(
      (
        await subscribe(
          request('/api/v1/push/subscriptions', { method: 'POST', body: insecure, cookie }),
        )
      ).status,
    ).toBe(400);
    await unsubscribe(
      request('/api/v1/push/subscriptions', {
        method: 'DELETE',
        body: JSON.stringify({ endpoint: subscription.endpoint }),
        cookie,
      }),
    );
    expect(await db.select().from(pushSubscriptions)).toHaveLength(0);
  });
});

describe('notification settings', () => {
  it('defaults to urgent push on, digests off, and saves changes', async () => {
    const { cookie } = await signedInCookie(db);
    expect(
      (await (await getSettings(request('/api/v1/me/notifications', { cookie }))).json()).settings,
    ).toEqual({
      emailDigest: false,
      pushDigest: false,
      pushUrgent: true,
    });
    const updated = await putSettings(
      request('/api/v1/me/notifications', {
        method: 'PUT',
        cookie,
        body: JSON.stringify({ emailDigest: true, pushUrgent: false }),
      }),
    );
    expect((await updated.json()).settings).toEqual({
      emailDigest: true,
      pushDigest: false,
      pushUrgent: false,
    });
  });
});
