import 'server-only';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { getDb } from '@nm/db';
import { getSessionUser, SESSION_COOKIE, type SessionUser } from '@nm/services/auth/session';

/** Editors and admins only. Every admin page and server action calls this. */
export async function requireStaff(role: 'editor' | 'admin' = 'editor'): Promise<SessionUser> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  const user = await getSessionUser(getDb(), token);
  if (!user) redirect('/admin/login');
  const allowed =
    role === 'admin' ? user.role === 'admin' : user.role === 'admin' || user.role === 'editor';
  if (!allowed) redirect('/admin/login?error=forbidden');
  return user;
}
