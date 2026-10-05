/**
 * Cookie consent: "all" allows ad measurement and reading-based personalisation;
 * "necessary" keeps only what the site needs to work.
 */
export const CONSENT_COOKIE = 'nm_consent';
export type Consent = 'all' | 'necessary';
export const CONSENT_EVENT = 'nm-consent-change';

export function readConsent(): Consent | null {
  if (typeof document === 'undefined') return null;
  const match = document.cookie.match(/(?:^|;\s*)nm_consent=(all|necessary)/);
  return (match?.[1] as Consent | undefined) ?? null;
}

export function writeConsent(value: Consent | null): void {
  const secure = location.protocol === 'https:' ? '; Secure' : '';
  document.cookie =
    value === null
      ? `${CONSENT_COOKIE}=; Path=/; Max-Age=0; SameSite=Lax${secure}`
      : `${CONSENT_COOKIE}=${value}; Path=/; Max-Age=${180 * 86_400}; SameSite=Lax${secure}`;
  window.dispatchEvent(new CustomEvent(CONSENT_EVENT, { detail: value }));
  // Withdrawing consent deletes the reading history kept for personalisation.
  if (value !== 'all') void fetch('/api/v1/events', { method: 'DELETE' }).catch(() => undefined);
}

export function hasAdConsent(cookieHeader: string | null): boolean {
  return /(?:^|;\s*)nm_consent=all(?:;|$)/.test(cookieHeader ?? '');
}

/**
 * May reading behaviour be recorded and used for ranking? Web: consent "all".
 * Native app: the reader switched on personalisation (header x-nm-consent).
 */
export function hasPersonalizationConsent(request: Request): boolean {
  if (/(?:^|;\s*)nm_consent=all(?:;|$)/.test(request.headers.get('cookie') ?? '')) return true;
  return (request.headers.get('x-nm-consent') ?? '')
    .split(',')
    .some((v) => v.trim() === 'personalization');
}
