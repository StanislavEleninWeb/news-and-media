import { randomUUID } from 'expo-crypto';
import { getLocales } from 'expo-localization';
import * as SecureStore from 'expo-secure-store';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import type { SessionUserDto } from '@nm/contracts';
import { createApi, type Api, type Locale } from './api';
import { env } from './env';
import { unregisterPush } from './push';

const KEYS = {
  token: 'nm.session',
  anon: 'nm.anon',
  locale: 'nm.locale',
  personalize: 'nm.personalize',
} as const;

interface Session {
  ready: boolean;
  api: Api;
  locale: Locale;
  setLocale: (locale: Locale) => void;
  user: SessionUserDto | null;
  /** Reading-based personalisation (opt-in; off deletes the history on the server). */
  personalize: boolean;
  setPersonalize: (on: boolean) => Promise<void>;
  signIn: (email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
}

const SessionContext = createContext<Session | null>(null);

const deviceLocale = (): Locale => (getLocales()[0]?.languageCode === 'bg' ? 'bg' : 'en');

/**
 * Session token, anonymous install id and reading language. The token lives in
 * the iOS Keychain / Android Keystore (expo-secure-store), never in plain storage.
 */
export function SessionProvider({ children }: { children: ReactNode }) {
  const token = useRef<string | null>(null);
  const anon = useRef<string | null>(null);
  const personalizeRef = useRef(false);
  const [personalize, setPersonalizeState] = useState(false);
  const [ready, setReady] = useState(false);
  const [locale, setLocaleState] = useState<Locale>(deviceLocale);
  const [user, setUser] = useState<SessionUserDto | null>(null);

  const api = useMemo(
    () =>
      createApi({
        baseUrl: env.apiUrl,
        stagingKey: env.stagingKey,
        getToken: () => token.current,
        anonId: () => anon.current,
        personalization: () => personalizeRef.current,
      }),
    [],
  );

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [storedToken, storedAnon, storedLocale, storedPersonalize] = await Promise.all([
        SecureStore.getItemAsync(KEYS.token),
        SecureStore.getItemAsync(KEYS.anon),
        SecureStore.getItemAsync(KEYS.locale),
        SecureStore.getItemAsync(KEYS.personalize),
      ]);
      personalizeRef.current = storedPersonalize === 'on';
      setPersonalizeState(personalizeRef.current);
      anon.current = storedAnon ?? randomUUID();
      if (!storedAnon) await SecureStore.setItemAsync(KEYS.anon, anon.current);
      if (storedLocale === 'bg' || storedLocale === 'en') setLocaleState(storedLocale);
      token.current = storedToken;
      if (storedToken) {
        try {
          const me = await api.me();
          if (!cancelled) setUser(me.user);
        } catch {
          // Expired or revoked session: forget it. Offline: keep it and stay signed out for now.
          token.current = null;
          await SecureStore.deleteItemAsync(KEYS.token);
        }
      }
      if (!cancelled) setReady(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [api]);

  const setLocale = useCallback((next: Locale) => {
    setLocaleState(next);
    void SecureStore.setItemAsync(KEYS.locale, next);
  }, []);

  const setPersonalize = useCallback(
    async (on: boolean) => {
      personalizeRef.current = on;
      setPersonalizeState(on);
      await SecureStore.setItemAsync(KEYS.personalize, on ? 'on' : 'off');
      if (!on) await api.forgetEvents().catch(() => undefined);
    },
    [api],
  );

  const signIn = useCallback(
    async (email: string, password: string) => {
      const result = await api.signIn(email.trim(), password);
      token.current = result.token;
      await SecureStore.setItemAsync(KEYS.token, result.token);
      setUser(result.user);
    },
    [api],
  );

  const signOut = useCallback(async () => {
    try {
      await unregisterPush(api);
      await api.signOut();
    } catch {
      // Sign out locally even when the server cannot be reached.
    }
    token.current = null;
    await SecureStore.deleteItemAsync(KEYS.token);
    setUser(null);
  }, [api]);

  const value = useMemo(
    () => ({ ready, api, locale, setLocale, user, personalize, setPersonalize, signIn, signOut }),
    [ready, api, locale, setLocale, user, personalize, setPersonalize, signIn, signOut],
  );
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): Session {
  const session = useContext(SessionContext);
  if (!session) throw new Error('useSession outside SessionProvider');
  return session;
}
