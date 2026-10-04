'use client';

import { useEffect, useState } from 'react';
import type { Locale } from '@/i18n/config';

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

/** Registers the service worker (production builds only). */
export function ServiceWorkerRegistration() {
  useEffect(() => {
    if (process.env.NODE_ENV !== 'production' || !('serviceWorker' in navigator)) return;
    void navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch(() => {});
  }, []);
  return null;
}

/** "Install the app" button, shown only when the browser offers installation. */
export function InstallButton({ locale }: { locale: Locale }) {
  const [promptEvent, setPromptEvent] = useState<BeforeInstallPromptEvent | null>(null);
  useEffect(() => {
    const onPrompt = (event: Event) => {
      event.preventDefault();
      setPromptEvent(event as BeforeInstallPromptEvent);
    };
    window.addEventListener('beforeinstallprompt', onPrompt);
    return () => window.removeEventListener('beforeinstallprompt', onPrompt);
  }, []);
  if (!promptEvent) return null;
  return (
    <button
      className="button button--ghost"
      type="button"
      onClick={async () => {
        await promptEvent.prompt();
        setPromptEvent(null);
      }}
    >
      {locale === 'bg' ? 'Инсталирай приложението' : 'Install the app'}
    </button>
  );
}
