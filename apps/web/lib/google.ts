import { getConfig } from '@nm/core/config';

export const GOOGLE_STATE_COOKIE = 'nm_oauth';

/** Must be registered in the Google Cloud console for every environment's APP_URL. */
export function googleRedirectUri(): string {
  return `${getConfig().APP_URL.replace(/\/$/, '')}/api/v1/auth/google/callback`;
}
