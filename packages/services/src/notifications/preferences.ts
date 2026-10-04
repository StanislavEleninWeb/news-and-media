import { eq } from 'drizzle-orm';
import type { Db } from '@nm/db';
import { notificationPreferences } from '@nm/db/schema';

export interface NotificationSettings {
  emailDigest: boolean;
  pushDigest: boolean;
  pushUrgent: boolean;
}

const defaults: NotificationSettings = { emailDigest: false, pushDigest: false, pushUrgent: true };

export async function getNotificationSettings(
  db: Db,
  userId: string,
): Promise<NotificationSettings> {
  const [row] = await db
    .select()
    .from(notificationPreferences)
    .where(eq(notificationPreferences.userId, userId));
  return row
    ? { emailDigest: row.emailDigest, pushDigest: row.pushDigest, pushUrgent: row.pushUrgent }
    : defaults;
}

export async function setNotificationSettings(
  db: Db,
  userId: string,
  input: Partial<NotificationSettings>,
): Promise<NotificationSettings> {
  const next = { ...(await getNotificationSettings(db, userId)), ...input };
  await db
    .insert(notificationPreferences)
    .values({ userId, ...next })
    .onConflictDoUpdate({ target: notificationPreferences.userId, set: next });
  return next;
}
