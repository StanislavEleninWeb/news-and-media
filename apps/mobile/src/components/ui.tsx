import type { ReactNode } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import type { Locale } from '../api';
import { t } from '../i18n';
import { radius, space, usePalette } from '../theme';

export function Loading() {
  const c = usePalette();
  return (
    <View style={[styles.center, { backgroundColor: c.paper }]}>
      <ActivityIndicator color={c.accent} />
    </View>
  );
}

export function ErrorState({ locale, onRetry }: { locale: Locale; onRetry: () => void }) {
  const c = usePalette();
  return (
    <View style={[styles.center, { backgroundColor: c.paper }]}>
      <Text style={[styles.message, { color: c.inkSoft }]}>{t(locale, 'error')}</Text>
      <Button label={t(locale, 'retry')} onPress={onRetry} />
    </View>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  const c = usePalette();
  return (
    <View style={styles.empty}>
      <Text style={[styles.message, { color: c.muted }]}>{children}</Text>
    </View>
  );
}

export function Button({
  label,
  onPress,
  kind = 'primary',
  disabled,
}: {
  label: string;
  onPress: () => void;
  kind?: 'primary' | 'secondary';
  disabled?: boolean;
}) {
  const c = usePalette();
  const primary = kind === 'primary';
  return (
    <Pressable
      accessibilityRole="button"
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        {
          backgroundColor: primary ? c.brand : 'transparent',
          borderColor: primary ? c.brand : c.rule,
          opacity: disabled ? 0.5 : pressed ? 0.85 : 1,
        },
      ]}
    >
      <Text style={[styles.buttonLabel, { color: primary ? c.paper : c.ink }]}>{label}</Text>
    </Pressable>
  );
}

export function Chip({
  label,
  active,
  onPress,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
}) {
  const c = usePalette();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      onPress={onPress}
      style={[styles.chip, { backgroundColor: active ? c.brand : c.chip }]}
    >
      <Text style={{ color: active ? c.paper : c.inkSoft, fontWeight: '600', fontSize: 14 }}>
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.m,
    padding: space.l,
  },
  empty: { padding: space.xl, alignItems: 'center' },
  message: { fontSize: 16, textAlign: 'center', lineHeight: 22 },
  button: {
    borderWidth: 1,
    borderRadius: radius,
    paddingVertical: 12,
    paddingHorizontal: space.l,
    alignItems: 'center',
  },
  buttonLabel: { fontSize: 16, fontWeight: '600' },
  chip: { paddingVertical: 7, paddingHorizontal: 14, borderRadius: 999 },
});
