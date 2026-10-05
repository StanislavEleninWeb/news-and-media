import Ionicons from '@expo/vector-icons/Ionicons';
import { Tabs } from 'expo-router';
import type { ComponentProps } from 'react';
import type { ColorValue } from 'react-native';
import { t } from '@/i18n';
import { useSession } from '@/session';
import { fonts, usePalette } from '@/theme';

type IconName = ComponentProps<typeof Ionicons>['name'];
const icon =
  (name: IconName) =>
  ({ color, size }: { color: ColorValue; size: number }) => (
    <Ionicons name={name} color={color as string} size={size} />
  );

export default function TabsLayout() {
  const c = usePalette();
  const { locale } = useSession();
  return (
    <Tabs
      screenOptions={{
        headerStyle: { backgroundColor: c.paper },
        headerTitleStyle: { fontFamily: fonts.serif, fontSize: 22, color: c.ink },
        headerShadowVisible: false,
        tabBarActiveTintColor: c.accent,
        tabBarInactiveTintColor: c.muted,
        tabBarStyle: { backgroundColor: c.paper, borderTopColor: c.rule },
        sceneStyle: { backgroundColor: c.paper },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{ title: t(locale, 'feed'), tabBarIcon: icon('newspaper-outline') }}
      />
      <Tabs.Screen
        name="search"
        options={{ title: t(locale, 'search'), tabBarIcon: icon('search-outline') }}
      />
      <Tabs.Screen
        name="saved"
        options={{ title: t(locale, 'saved'), tabBarIcon: icon('bookmark-outline') }}
      />
      <Tabs.Screen
        name="account"
        options={{ title: t(locale, 'account'), tabBarIcon: icon('person-outline') }}
      />
    </Tabs>
  );
}
