import { timingSafeEqual } from 'node:crypto';
import { getConfig } from '@nm/core/config';
import { getLogger } from '@nm/core/logger';
import { getDb } from '@nm/db';
import { createSession, findOrCreateGoogleUser } from '@nm/services/auth/accounts';
import { fetchGoogleProfile } from '@nm/services/auth/google';
import { safeNextPath, sessionCookie } from '@/lib/auth-cookies';
import { GOOGLE_STATE_COOKIE, googleRedirectUri } from '@/lib/google';
import { readCookie, serializeCookie } from '@/lib/http';

export const dynamic = 'force-dynamic';

function redirect(location: string, cookies: string[]) {
  const headers = new Headers({ Location: location, 'Cache-Control': 'no-store' });
  for (const cookie of cookies) headers.append('Set-Cookie', cookie);
  return new Response(null, { status: 302, headers });
}

const sameString = (a: string, b: string) =>
  a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

/** GET /api/v1/auth/google/callback — completes sign-in and returns to the page the reader came from. */
export async function GET(request: Request) {
  const config = getConfig();
  const url = new URL(request.url);
  const clearState = serializeCookie(GOOGLE_STATE_COOKIE, '', { maxAgeSeconds: 0 });
  let saved: { state: string; verifier: string; next: string } | null;
  try {
    saved = JSON.parse(readCookie(request, GOOGLE_STATE_COOKIE) ?? 'null');
  } catch {
    saved = null;
  }
  const state = url.searchParams.get('state') ?? '';
  const code = url.searchParams.get('code');
  const failure = `${safeNextPath(saved?.next, '/bg')}${saved?.next?.includes('?') ? '&' : '?'}login=failed`;
  if (
    !saved ||
    !code ||
    !sameString(state, saved.state) ||
    !config.GOOGLE_CLIENT_ID ||
    !config.GOOGLE_CLIENT_SECRET
  ) {
    return redirect(failure, [clearState]);
  }
  try {
    const profile = await fetchGoogleProfile({
      code,
      codeVerifier: saved.verifier,
      clientId: config.GOOGLE_CLIENT_ID,
      clientSecret: config.GOOGLE_CLIENT_SECRET,
      redirectUri: googleRedirectUri(),
    });
    const db = getDb();
    const user = await findOrCreateGoogleUser(db, profile);
    const session = await createSession(db, user.id, request.headers.get('user-agent'));
    return redirect(safeNextPath(saved.next), [clearState, sessionCookie(session.token)]);
  } catch (error) {
    getLogger({ service: 'auth' }).warn({ err: (error as Error).message }, 'google sign-in failed');
    return redirect(failure, [clearState]);
  }
}
