import { getConfig } from '@nm/core/config';
import { createPkce, googleAuthorizeUrl } from '@nm/services/auth/google';
import { safeNextPath } from '@/lib/auth-cookies';
import { GOOGLE_STATE_COOKIE, googleRedirectUri } from '@/lib/google';
import { problem, serializeCookie } from '@/lib/http';

export const dynamic = 'force-dynamic';

/** GET /api/v1/auth/google?next=/bg — starts "Sign in with Google" (authorization code + PKCE). */
export function GET(request: Request) {
  const config = getConfig();
  if (!config.GOOGLE_CLIENT_ID || !config.GOOGLE_CLIENT_SECRET)
    return problem(404, 'google_sign_in_disabled');
  const next = safeNextPath(new URL(request.url).searchParams.get('next'));
  const { verifier, challenge, state } = createPkce();
  const location = googleAuthorizeUrl({
    clientId: config.GOOGLE_CLIENT_ID,
    redirectUri: googleRedirectUri(),
    state,
    codeChallenge: challenge,
  });
  const headers = new Headers({ Location: location, 'Cache-Control': 'no-store' });
  headers.append(
    'Set-Cookie',
    serializeCookie(GOOGLE_STATE_COOKIE, JSON.stringify({ state, verifier, next }), {
      maxAgeSeconds: 600,
    }),
  );
  return new Response(null, { status: 302, headers });
}
