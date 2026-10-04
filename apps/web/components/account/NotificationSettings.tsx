'use client';

import { useEffect, useState } from 'react';
import type { Locale } from '@/i18n/config';
import { getMessages } from '@/i18n/messages';
import { api } from '@/lib/client-api';

type Settings = { emailDigest: boolean; pushDigest: boolean; pushUrgent: boolean };
type PushState = 'unknown' | 'unsupported' | 'unavailable' | 'denied' | 'off' | 'on';

function urlBase64ToUint8Array(base64: string): Uint8Array {
  const padded = (base64 + '='.repeat((4 - (base64.length % 4)) % 4))
    .replace(/-/g, '+')
    .replace(/_/g, '/');
  const raw = atob(padded);
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

export function NotificationSettings({ locale }: { locale: Locale }) {
  const t = getMessages(locale).notifications;
  const [settings, setSettings] = useState<Settings | null>(null);
  const [push, setPush] = useState<PushState>('unknown');

  useEffect(() => {
    void api<{ settings: Settings }>('/api/v1/me/notifications').then((r) =>
      setSettings(r.settings),
    );
    (async () => {
      if (
        !('serviceWorker' in navigator) ||
        !('PushManager' in window) ||
        !('Notification' in window)
      )
        return setPush('unsupported');
      if (Notification.permission === 'denied') return setPush('denied');
      const registration = await navigator.serviceWorker.getRegistration();
      const existing = await registration?.pushManager.getSubscription();
      setPush(existing ? 'on' : 'off');
    })().catch(() => setPush('unsupported'));
  }, []);

  const update = async (patch: Partial<Settings>) => {
    const r = await api<{ settings: Settings }>('/api/v1/me/notifications', {
      method: 'PUT',
      body: patch,
    });
    setSettings(r.settings);
  };

  async function enablePush() {
    const { key } = await api<{ key: string | null }>('/api/v1/push/vapid-public-key');
    if (!key) return setPush('unavailable');
    const permission = await Notification.requestPermission();
    if (permission !== 'granted') return setPush('denied');
    const registration =
      (await navigator.serviceWorker.getRegistration()) ??
      (await navigator.serviceWorker.register('/sw.js'));
    await navigator.serviceWorker.ready;
    const subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(key) as BufferSource,
    });
    await api('/api/v1/push/subscriptions', { method: 'POST', body: subscription.toJSON() });
    setPush('on');
  }

  async function disablePush() {
    const registration = await navigator.serviceWorker.getRegistration();
    const subscription = await registration?.pushManager.getSubscription();
    if (subscription) {
      await api('/api/v1/push/subscriptions', {
        method: 'DELETE',
        body: { endpoint: subscription.endpoint },
      });
      await subscription.unsubscribe();
    }
    setPush('off');
  }

  if (!settings) return null;
  return (
    <section style={{ display: 'grid', gap: '0.75rem' }}>
      <h2 className="section-title">{t.title}</h2>
      <label className="toggle">
        <input
          type="checkbox"
          checked={settings.emailDigest}
          onChange={(e) => update({ emailDigest: e.target.checked })}
        />
        {t.emailDigest}
      </label>
      <label className="toggle">
        <input
          type="checkbox"
          checked={settings.pushUrgent}
          onChange={(e) => update({ pushUrgent: e.target.checked })}
        />
        {t.urgent}
      </label>
      <label className="toggle">
        <input
          type="checkbox"
          checked={settings.pushDigest}
          onChange={(e) => update({ pushDigest: e.target.checked })}
        />
        {t.pushDigest}
      </label>
      <div>
        {push === 'off' ? (
          <button
            className="button button--ghost"
            type="button"
            onClick={() => void enablePush().catch(() => setPush('unavailable'))}
          >
            {t.enablePush}
          </button>
        ) : push === 'on' ? (
          <p className="hint">
            {t.pushEnabled}{' '}
            <button className="text-button" type="button" onClick={() => void disablePush()}>
              {t.disablePush}
            </button>
          </p>
        ) : push === 'denied' ? (
          <p className="hint">{t.pushDenied}</p>
        ) : push === 'unsupported' ? (
          <p className="hint">{t.pushUnsupported}</p>
        ) : push === 'unavailable' ? (
          <p className="hint">{t.pushUnavailable}</p>
        ) : null}
      </div>
    </section>
  );
}
