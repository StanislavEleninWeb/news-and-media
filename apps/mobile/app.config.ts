import { existsSync } from 'node:fs';
import type { ConfigContext, ExpoConfig } from 'expo/config';

/**
 * One codebase, three variants. EAS build profiles (eas.json) set APP_VARIANT
 * and EXPO_PUBLIC_API_URL; the variants install side by side on a device.
 *
 *   development  dev client, staging API (or a LAN URL via EXPO_PUBLIC_API_URL)
 *   staging      internal distribution, staging API
 *   production   App Store / Play Store, production API
 */
type Variant = 'development' | 'staging' | 'production';
const variant = (process.env.APP_VARIANT ?? 'development') as Variant;

// Bundle ids — change "co.seweb.news" to your own reverse domain before the first store build.
const BASE_ID = 'co.seweb.news';
const ids: Record<Variant, { suffix: string; name: string }> = {
  development: { suffix: '.dev', name: 'News (dev)' },
  staging: { suffix: '.staging', name: 'News (staging)' },
  production: { suffix: '', name: 'News' },
};

function googleServices(): string | undefined {
  if (process.env.GOOGLE_SERVICES_JSON) return process.env.GOOGLE_SERVICES_JSON;
  return existsSync('./google-services.json') ? './google-services.json' : undefined;
}

const apiUrl = process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:3000';
if (variant !== 'development' && !process.env.EXPO_PUBLIC_API_URL)
  throw new Error(`EXPO_PUBLIC_API_URL is required for the ${variant} build`);

export default ({ config }: ConfigContext): ExpoConfig => ({
  ...config,
  platforms: ['ios', 'android'],
  name: ids[variant].name,
  slug: 'news-and-media',
  scheme: 'newsmedia',
  version: '1.0.0',
  orientation: 'portrait',
  icon: './assets/icon.png',
  userInterfaceStyle: 'automatic',
  ios: {
    bundleIdentifier: BASE_ID + ids[variant].suffix,
    supportsTablet: true,
    config: { usesNonExemptEncryption: false },
  },
  android: {
    package: BASE_ID + ids[variant].suffix,
    adaptiveIcon: { foregroundImage: './assets/icon.png', backgroundColor: '#13233a' },
    // FCM credentials for Android push (see apps/mobile/README.md). On EAS the
    // file comes from the GOOGLE_SERVICES_JSON file secret; locally from ./google-services.json.
    googleServicesFile: googleServices(),
  },
  plugins: [
    'expo-router',
    'expo-secure-store',
    'expo-localization',
    'expo-web-browser',
    [
      'expo-notifications',
      { color: '#b42318', defaultChannel: 'default', enableBackgroundRemoteNotifications: false },
    ],
  ],
  experiments: { typedRoutes: false },
  extra: {
    variant,
    apiUrl,
    // Lets internal builds through the staging basic-auth gate (Caddy X-Staging-Key).
    stagingKey: variant === 'production' ? undefined : process.env.EXPO_PUBLIC_STAGING_KEY,
    eas: { projectId: process.env.EAS_PROJECT_ID },
  },
});
