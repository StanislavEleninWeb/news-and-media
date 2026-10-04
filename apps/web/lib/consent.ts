/** Cookie consent: "all" allows ad measurement; "necessary" keeps only what the site needs to work. */
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
}

export function hasAdConsent(cookieHeader: string | null): boolean {
  return /(?:^|;\s*)nm_consent=all(?:;|$)/.test(cookieHeader ?? '');
}
