import { and, eq, exists, inArray, notExists, or, sql } from 'drizzle-orm';
import { getConfig } from '@nm/core/config';
import type { Db } from '@nm/db';
import {
  articleTopics,
  devicePushTokens,
  notificationPreferences,
  pushSubscriptions,
  userTopicPreferences,
  users,
  type Locale,
} from '@nm/db/schema';
import { getArticle } from '../content/article';
import { getFeed } from '../content/feed';
import { getPreferences } from '../auth/preferences';
import { enqueueJob } from '../jobs/queue';
import { sendMail } from '../mail/mailer';
import { renderDigestEmail } from './digest-email';
import { getNotificationSettings } from './preferences';
import { hasPushChannel, pushToUser, type PushChannels } from './push';

/**
 * Breaking-news push after an editor approved an article as urgent. Goes to
 * readers who allow urgent pushes and follow one of the article's topics —
 * or follow no topics at all (they have not narrowed their interests).
 */
export async function sendUrgentPush(db: Db, channels: PushChannels | null, articleId: string) {
  if (!hasPushChannel(channels)) return { recipients: 0, sent: 0, reason: 'push not configured' };
  const bg = await getArticle(db, articleId, 'bg');
  const en = await getArticle(db, articleId, 'en');
  const article = bg ?? en;
  if (!article?.isUrgent)
    return { recipients: 0, sent: 0, reason: 'article is not (or no longer) urgent' };

  const topicIds = (
    await db
      .select({ id: articleTopics.topicId })
      .from(articleTopics)
      .where(eq(articleTopics.articleId, articleId))
  ).map((r) => r.id);
  const followsTopic = topicIds.length
    ? exists(
        db
          .select({ one: sql`1` })
          .from(userTopicPreferences)
          .where(
            and(
              eq(userTopicPreferences.userId, users.id),
              inArray(userTopicPreferences.topicId, topicIds),
            ),
          ),
      )
    : sql`false`;
  const followsNothing = notExists(
    db
      .select({ one: sql`1` })
      .from(userTopicPreferences)
      .where(eq(userTopicPreferences.userId, users.id)),
  );

  // Readers with at least one browser or app registered for push.
  const hasDevice = or(
    exists(
      db
        .select({ one: sql`1` })
        .from(pushSubscriptions)
        .where(eq(pushSubscriptions.userId, users.id)),
    ),
    exists(
      db
        .select({ one: sql`1` })
        .from(devicePushTokens)
        .where(eq(devicePushTokens.userId, users.id)),
    ),
  );

  const recipients = await db
    .select({ id: users.id, email: users.email, locale: users.locale })
    .from(users)
    .leftJoin(notificationPreferences, eq(notificationPreferences.userId, users.id))
    .where(
      and(
        hasDevice,
        sql`coalesce(${notificationPreferences.pushUrgent}, true)`,
        or(followsTopic, followsNothing),
      ),
    );

  let sent = 0;
  for (const user of recipients) {
    const version = (user.locale === 'en' ? en : bg) ?? article;
    const label = version.locale === 'bg' ? 'Извънредно' : 'Breaking';
    const result = await pushToUser(
      db,
      channels,
      user,
      {
        title: `${label}: ${version.title}`,
        body: version.tldr,
        url: version.path,
        tag: `urgent-${articleId}`,
      },
      'high',
    );
    sent += result.sent;
  }
  return { recipients: recipients.length, sent };
}

/** Local calendar date and hour in the digest time zone. */
export function localClock(now: Date, timeZone: string): { date: string; hour: number } {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      hour12: false,
    })
      .formatToParts(now)
      .map((p) => [p.type, p.value]),
  );
  return { date: `${parts.year}-${parts.month}-${parts.day}`, hour: Number(parts.hour) % 24 };
}

/**
 * Called every few minutes; at DIGEST_HOUR (local time) it queues one digest
 * job per opted-in reader. The dedupe key makes it exactly once per reader per day.
 */
export async function scheduleDigests(db: Db, now = new Date()): Promise<number> {
  const config = getConfig();
  const clock = localClock(now, config.DIGEST_TIMEZONE);
  if (clock.hour !== config.DIGEST_HOUR) return 0;
  const readers = await db
    .select({ userId: notificationPreferences.userId })
    .from(notificationPreferences)
    .where(
      or(
        eq(notificationPreferences.emailDigest, true),
        eq(notificationPreferences.pushDigest, true),
      ),
    );
  let queued = 0;
  for (const reader of readers) {
    const id = await enqueueJob(
      db,
      'digest',
      { userId: reader.userId, date: clock.date },
      { dedupeKey: `digest:${reader.userId}:${clock.date}` },
    );
    if (id) queued += 1;
  }
  return queued;
}

/** Builds and sends one reader's daily briefing (e-mail and/or push). */
export async function sendDigest(
  db: Db,
  push: PushChannels | null,
  userId: string,
  now = new Date(),
) {
  const config = getConfig();
  const [user] = await db.select().from(users).where(eq(users.id, userId));
  if (!user) return { sent: false, reason: 'user not found' };
  const settings = await getNotificationSettings(db, userId);
  if (!settings.emailDigest && !settings.pushDigest)
    return { sent: false, reason: 'digest disabled' };

  const locale: Locale = user.locale;
  const prefs = await getPreferences(db, userId);
  const feed = await getFeed(db, { locale, perPage: 40, personalization: prefs, now });
  const since = now.getTime() - 24 * 3_600_000;
  const items = feed.items
    .filter((item) => Date.parse(item.publishedAt) >= since)
    .slice(0, config.DIGEST_SIZE);
  if (items.length === 0) return { sent: false, reason: 'no new stories' };

  const siteUrl = config.APP_URL.replace(/\/$/, '');
  const dateLabel = new Intl.DateTimeFormat(locale === 'bg' ? 'bg-BG' : 'en-GB', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    timeZone: config.DIGEST_TIMEZONE,
  }).format(now);
  const channels: string[] = [];
  if (settings.emailDigest) {
    const email = renderDigestEmail({
      locale,
      siteName: config.SITE_NAME,
      siteUrl,
      dateLabel,
      items,
    });
    const result = await sendMail({
      to: user.email,
      subject: email.subject,
      html: email.html,
      text: email.text,
      headers: { 'List-Unsubscribe': `<${email.manageUrl}>` },
    });
    if (result.delivered) channels.push('email');
  }
  if (settings.pushDigest && hasPushChannel(push)) {
    const result = await pushToUser(db, push, user, {
      title: locale === 'bg' ? 'Вашият дневен бюлетин' : 'Your daily briefing',
      body:
        items[0]!.title +
        (items.length > 1
          ? locale === 'bg'
            ? ` и още ${items.length - 1}`
            : ` and ${items.length - 1} more`
          : ''),
      url: `/${locale}`,
      tag: 'digest',
    });
    if (result.sent) channels.push('push');
  }
  return { sent: channels.length > 0, channels, items: items.length };
}
