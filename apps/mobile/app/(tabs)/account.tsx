import { useEffect, useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';
import { ApiError } from '@/api';
import { Button, Chip } from '@/components/ui';
import { t } from '@/i18n';
import { isPushRegistered, registerForPush, unregisterPush, type PushState } from '@/push';
import { useSession } from '@/session';
import { radius, space, usePalette } from '@/theme';

export default function AccountScreen() {
  const c = usePalette();
  const { api, locale, setLocale, user, signIn, signOut, personalize, setPersonalize } =
    useSession();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [push, setPush] = useState<PushState | 'off'>('off');

  useEffect(() => {
    isPushRegistered().then((on) => setPush(on ? 'enabled' : 'off'));
  }, [user]);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await signIn(email, password);
      setPassword('');
      // Offer breaking-news push right after signing in.
      setPush(await registerForPush(api).catch(() => 'off' as const));
    } catch (e) {
      setError(
        e instanceof ApiError && e.status === 401
          ? t(locale, 'invalidCredentials')
          : t(locale, 'error'),
      );
    } finally {
      setBusy(false);
    }
  };

  const togglePush = async (on: boolean) => {
    try {
      if (on) setPush(await registerForPush(api));
      else {
        await unregisterPush(api);
        setPush('off');
      }
    } catch {
      setPush('off');
    }
  };

  const input = [styles.input, { color: c.ink, backgroundColor: c.chip }];
  return (
    <KeyboardAvoidingView
      style={{ flex: 1 }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView style={{ backgroundColor: c.paper }} contentContainerStyle={styles.page}>
        <Text style={[styles.heading, { color: c.muted }]}>{t(locale, 'language')}</Text>
        <View style={styles.row}>
          <Chip label="Български" active={locale === 'bg'} onPress={() => setLocale('bg')} />
          <Chip label="English" active={locale === 'en'} onPress={() => setLocale('en')} />
        </View>

        <Text style={[styles.heading, { color: c.muted }]}>{t(locale, 'personalization')}</Text>
        <View style={[styles.setting, { borderColor: c.rule }]}>
          <Text style={[styles.settingLabel, { color: c.ink }]}>{t(locale, 'personalizeOn')}</Text>
          <Switch
            value={personalize}
            onValueChange={setPersonalize}
            trackColor={{ true: c.accent }}
          />
        </View>
        <Text style={{ color: c.muted, fontSize: 13, lineHeight: 18 }}>
          {t(locale, 'personalizeNote')}
        </Text>

        {user ? (
          <>
            <Text style={[styles.heading, { color: c.muted }]}>{t(locale, 'notifications')}</Text>
            <View style={[styles.setting, { borderColor: c.rule }]}>
              <Text style={[styles.settingLabel, { color: c.ink }]}>{t(locale, 'pushOn')}</Text>
              <Switch
                value={push === 'enabled'}
                onValueChange={togglePush}
                trackColor={{ true: c.accent }}
              />
            </View>
            {push === 'denied' ? (
              <Text style={{ color: c.accent }}>{t(locale, 'pushDenied')}</Text>
            ) : null}

            <Text style={[styles.heading, { color: c.muted }]}>{t(locale, 'account')}</Text>
            <Text style={{ color: c.ink, fontSize: 16 }}>
              {t(locale, 'signedInAs')} {user.email}
            </Text>
            <Button label={t(locale, 'signOut')} kind="secondary" onPress={signOut} />
          </>
        ) : (
          <>
            <Text style={[styles.heading, { color: c.muted }]}>{t(locale, 'signIn')}</Text>
            <TextInput
              style={input}
              value={email}
              onChangeText={setEmail}
              placeholder={t(locale, 'email')}
              placeholderTextColor={c.muted}
              autoCapitalize="none"
              autoComplete="email"
              keyboardType="email-address"
              textContentType="username"
            />
            <TextInput
              style={input}
              value={password}
              onChangeText={setPassword}
              placeholder={t(locale, 'password')}
              placeholderTextColor={c.muted}
              secureTextEntry
              autoComplete="current-password"
              textContentType="password"
              onSubmitEditing={submit}
            />
            {error ? <Text style={{ color: c.accent }}>{error}</Text> : null}
            <Button
              label={t(locale, 'signIn')}
              onPress={submit}
              disabled={busy || !email || !password}
            />
            <Text style={{ color: c.muted, fontSize: 14 }}>{t(locale, 'noAccount')}</Text>
          </>
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  page: { padding: space.m, gap: space.m },
  heading: {
    fontSize: 13,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.6,
    marginTop: space.m,
  },
  row: { flexDirection: 'row', gap: space.s },
  input: { padding: 12, borderRadius: radius, fontSize: 17 },
  setting: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius,
    padding: space.m,
  },
  settingLabel: { fontSize: 16, flex: 1, paddingRight: space.m },
});
