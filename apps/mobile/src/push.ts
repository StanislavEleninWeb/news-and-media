import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import { router } from 'expo-router';
import * as SecureStore from 'expo-secure-store';
import { useEffect } from 'react';
import { Platform } from 'react-native';
import type { Api } from './api';
import { env } from './env';
import { routeForPath } from './links';

const TOKEN_KEY = 'nm.pushToken';

// Show breaking news even while the app is open.
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

export type PushState = 'enabled' | 'denied' | 'unsupported';

/**
 * Asks for permission, gets this install's Expo push token (backed by FCM on
 * Android and APNs on iOS) and registers it for the signed-in reader. Who gets
 * what (topics, quiet settings) is decided by the server, as for web push.
 */
export async function registerForPush(api: Api): Promise<PushState> {
  if (!Device.isDevice) return 'unsupported'; // simulators cannot receive remote push
  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('breaking', {
      name: 'Breaking news',
      importance: Notifications.AndroidImportance.MAX,
      lightColor: '#b42318',
    });
    await Notifications.setNotificationChannelAsync('default', {
      name: 'Daily briefing',
      importance: Notifications.AndroidImportance.DEFAULT,
    });
  }
  let { status } = await Notifications.getPermissionsAsync();
  if (status !== 'granted') ({ status } = await Notifications.requestPermissionsAsync());
  if (status !== 'granted') return 'denied';
  const { data: token } = await Notifications.getExpoPushTokenAsync({ projectId: env.projectId });
  await api.registerDevice({ token, platform: Platform.OS === 'ios' ? 'ios' : 'android' });
  await SecureStore.setItemAsync(TOKEN_KEY, token);
  return 'enabled';
}

export async function unregisterPush(api: Api): Promise<void> {
  const token = await SecureStore.getItemAsync(TOKEN_KEY);
  if (!token) return;
  await SecureStore.deleteItemAsync(TOKEN_KEY);
  await api.unregisterDevice(token);
}

export async function isPushRegistered(): Promise<boolean> {
  return Boolean(await SecureStore.getItemAsync(TOKEN_KEY));
}

/** Opens the story when a notification is tapped (also on a cold start). */
export function usePushNavigation() {
  useEffect(() => {
    const open = (response: Notifications.NotificationResponse | null) => {
      const url = response?.notification.request.content.data?.url;
      if (typeof url === 'string') router.push(routeForPath(url) as never);
    };
    open(Notifications.getLastNotificationResponse());
    const subscription = Notifications.addNotificationResponseReceivedListener(open);
    return () => subscription.remove();
  }, []);
}
