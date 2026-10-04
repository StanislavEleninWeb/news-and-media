import { and, eq, gt, isNull, sql } from 'drizzle-orm';
import { z } from 'zod';
import type { Db } from '@nm/db';
import {
  notificationPreferences,
  passwordResetTokens,
  sessions,
  users,
  type Locale,
} from '@nm/db/schema';
import { dummyPasswordHash, hashPassword, verifyPassword } from './password';
import { hashToken, newToken, SESSION_TTL_DAYS, type SessionUser } from './session';

export const emailSchema = z.string().trim().toLowerCase().email().max(254);
export const passwordSchema = z.string().min(10, 'at least 10 characters').max(200);

export class AccountError extends Error {
  constructor(public readonly code: 'email_taken' | 'invalid_credentials' | 'invalid_token') {
    super(code);
    this.name = 'AccountError';
  }
}

const toSessionUser = (u: typeof users.$inferSelect): SessionUser => ({
  id: u.id,
  email: u.email,
  name: u.name,
  role: u.role,
  locale: u.locale,
});

async function findByEmail(db: Db, email: string) {
  const [user] = await db
    .select()
    .from(users)
    .where(eq(sql`lower(${users.email})`, email.toLowerCase()));
  return user;
}

export async function registerUser(
  db: Db,
  input: { email: string; password: string; name?: string | null; locale?: Locale },
): Promise<SessionUser> {
  const email = emailSchema.parse(input.email);
  const password = passwordSchema.parse(input.password);
  if (await findByEmail(db, email)) throw new AccountError('email_taken');
  const [user] = await db
    .insert(users)
    .values({
      email,
      passwordHash: await hashPassword(password),
      name: input.name?.trim() || null,
      locale: input.locale ?? 'bg',
    })
    .returning();
  await db.insert(notificationPreferences).values({ userId: user!.id }).onConflictDoNothing();
  return toSessionUser(user!);
}

export async function authenticate(
  db: Db,
  emailInput: string,
  password: string,
): Promise<SessionUser> {
  const email = emailSchema.safeParse(emailInput);
  const user = email.success ? await findByEmail(db, email.data) : undefined;
  if (!user?.passwordHash) {
    await verifyPassword(password, await dummyPasswordHash());
    throw new AccountError('invalid_credentials');
  }
  if (!(await verifyPassword(password, user.passwordHash)))
    throw new AccountError('invalid_credentials');
  await db.update(users).set({ lastLoginAt: new Date() }).where(eq(users.id, user.id));
  return toSessionUser(user);
}

export async function createSession(
  db: Db,
  userId: string,
  userAgent?: string | null,
): Promise<{ token: string; expiresAt: Date }> {
  const token = newToken();
  const expiresAt = new Date(Date.now() + SESSION_TTL_DAYS * 86_400_000);
  await db.insert(sessions).values({
    id: hashToken(token),
    userId,
    expiresAt,
    userAgent: userAgent?.slice(0, 300) ?? null,
  });
  return { token, expiresAt };
}

export async function deleteSession(db: Db, token: string): Promise<void> {
  await db.delete(sessions).where(eq(sessions.id, hashToken(token)));
}

/** Creates a one-hour reset token; null when no password account exists (caller responds the same way). */
export async function createPasswordReset(
  db: Db,
  emailInput: string,
): Promise<{ token: string; user: SessionUser } | null> {
  const email = emailSchema.safeParse(emailInput);
  if (!email.success) return null;
  const user = await findByEmail(db, email.data);
  if (!user) return null;
  const token = newToken();
  await db
    .insert(passwordResetTokens)
    .values({ id: hashToken(token), userId: user.id, expiresAt: new Date(Date.now() + 3_600_000) });
  return { token, user: toSessionUser(user) };
}

/** Sets a new password and signs the user out everywhere. */
export async function resetPassword(db: Db, token: string, newPassword: string): Promise<void> {
  const password = passwordSchema.parse(newPassword);
  const [reset] = await db
    .select()
    .from(passwordResetTokens)
    .where(
      and(
        eq(passwordResetTokens.id, hashToken(token)),
        isNull(passwordResetTokens.usedAt),
        gt(passwordResetTokens.expiresAt, new Date()),
      ),
    );
  if (!reset) throw new AccountError('invalid_token');
  await db.transaction(async (tx) => {
    await tx
      .update(users)
      .set({ passwordHash: await hashPassword(password) })
      .where(eq(users.id, reset.userId));
    await tx
      .update(passwordResetTokens)
      .set({ usedAt: new Date() })
      .where(eq(passwordResetTokens.id, reset.id));
    await tx.delete(sessions).where(eq(sessions.userId, reset.userId));
  });
}

/** Sign-in with Google: link by Google id, then by verified e-mail, else create the account. */
export async function findOrCreateGoogleUser(
  db: Db,
  profile: {
    sub: string;
    email: string;
    emailVerified: boolean;
    name?: string | null;
    locale?: Locale;
  },
): Promise<SessionUser> {
  const [linked] = await db.select().from(users).where(eq(users.googleSub, profile.sub));
  if (linked) return toSessionUser(linked);
  if (!profile.emailVerified) throw new AccountError('invalid_credentials');
  const email = emailSchema.parse(profile.email);
  const existing = await findByEmail(db, email);
  if (existing) {
    const [updated] = await db
      .update(users)
      .set({ googleSub: profile.sub })
      .where(eq(users.id, existing.id))
      .returning();
    return toSessionUser(updated!);
  }
  const [created] = await db
    .insert(users)
    .values({
      email,
      googleSub: profile.sub,
      name: profile.name ?? null,
      locale: profile.locale ?? 'bg',
    })
    .returning();
  await db.insert(notificationPreferences).values({ userId: created!.id }).onConflictDoNothing();
  return toSessionUser(created!);
}

/** Operator CLI: create or promote an editor/admin account. */
export async function upsertStaffUser(
  db: Db,
  input: { email: string; password: string; role: 'editor' | 'admin' },
): Promise<SessionUser> {
  const email = emailSchema.parse(input.email);
  const passwordHash = await hashPassword(passwordSchema.parse(input.password));
  const existing = await findByEmail(db, email);
  if (existing) {
    const [updated] = await db
      .update(users)
      .set({ role: input.role, passwordHash })
      .where(eq(users.id, existing.id))
      .returning();
    return toSessionUser(updated!);
  }
  const [created] = await db
    .insert(users)
    .values({ email, passwordHash, role: input.role })
    .returning();
  await db.insert(notificationPreferences).values({ userId: created!.id }).onConflictDoNothing();
  return toSessionUser(created!);
}
