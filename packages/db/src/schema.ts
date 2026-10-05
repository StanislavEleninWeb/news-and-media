/**
 * Database schema — the contract every other part of the build codes against.
 *
 * Content model in one sentence: a *source* (managed dynamically from the admin)
 * produces *articles*; each article is rewritten into one *localization* per
 * supported locale (bg, en), tagged with *topics*, and optionally has a licensed
 * *image*. Readers (users) save, react, follow topics/sources and subscribe to
 * notifications. Background work is coordinated through *jobs* and *runs*.
 */
import { sql } from 'drizzle-orm';
import {
  bigserial,
  boolean,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  primaryKey,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

const timestamps = {
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
};

// ---------------------------------------------------------------------------
// Enums
// ---------------------------------------------------------------------------

export const locales = ['bg', 'en'] as const;
export type Locale = (typeof locales)[number];

export const localeEnum = pgEnum('locale', locales);
export const sourceKindEnum = pgEnum('source_kind', ['rss', 'html']);
export const fetchStatusEnum = pgEnum('fetch_status', ['never', 'ok', 'error']);
export const articleStatusEnum = pgEnum('article_status', [
  'ingested', // scraped, waiting for AI processing
  'processing', // claimed by a worker
  'published', // visible to readers
  'needs_review', // AI output failed a quality check — an editor decides
  'rejected', // hidden by an editor
  'failed', // processing failed too many times
]);
export const articlePriorityEnum = pgEnum('article_priority', ['normal', 'flagship']);
export const userRoleEnum = pgEnum('user_role', ['reader', 'editor', 'admin']);
export const jobStatusEnum = pgEnum('job_status', ['pending', 'running', 'done', 'failed']);
export const runStatusEnum = pgEnum('run_status', ['running', 'ok', 'partial', 'failed']);
export const adPlacementEnum = pgEnum('ad_placement', [
  'home_top',
  'feed_inline',
  'article_inline',
  'article_bottom',
  'search_inline',
]);
export const adKindEnum = pgEnum('ad_kind', ['direct', 'house']);

export type ArticleStatus = (typeof articleStatusEnum.enumValues)[number];
export type UserRole = (typeof userRoleEnum.enumValues)[number];
export type AdPlacement = (typeof adPlacementEnum.enumValues)[number];

// ---------------------------------------------------------------------------
// Taxonomy & sources
// ---------------------------------------------------------------------------

export const topics = pgTable('topics', {
  id: uuid('id').primaryKey().defaultRandom(),
  slug: text('slug').notNull().unique(),
  nameBg: text('name_bg').notNull(),
  nameEn: text('name_en').notNull(),
  isActive: boolean('is_active').notNull().default(true),
  sortOrder: integer('sort_order').notNull().default(0),
  ...timestamps,
});

/** News sources are data, not code: editors add, edit, pause and remove them in the admin. */
export const sources = pgTable(
  'sources',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    name: text('name').notNull(),
    kind: sourceKindEnum('kind').notNull().default('rss'),
    /** RSS/Atom feed URL, or the listing page for `html` sources. */
    url: text('url').notNull().unique(),
    homepageUrl: text('homepage_url'),
    /** ISO 639-1 code of the source's language (bg, en, de, ...). */
    language: text('language').notNull().default('bg'),
    defaultTopicId: uuid('default_topic_id').references(() => topics.id, { onDelete: 'set null' }),
    isActive: boolean('is_active').notNull().default(true),
    fetchIntervalMinutes: integer('fetch_interval_minutes').notNull().default(60),
    maxItemsPerFetch: integer('max_items_per_fetch').notNull().default(20),
    /** CSS selector for article links on `html` listing pages. */
    linkSelector: text('link_selector'),
    /** Only sources whose images we are licensed to reuse get images downloaded. */
    imagesAllowed: boolean('images_allowed').notNull().default(false),
    /** 1 (low) – 5 (high), editor's judgement; shown to readers as a trust signal. */
    credibilityRating: smallint('credibility_rating'),
    credibilityNote: text('credibility_note'),
    lastFetchedAt: timestamp('last_fetched_at', { withTimezone: true }),
    nextFetchAt: timestamp('next_fetch_at', { withTimezone: true }).notNull().defaultNow(),
    lastStatus: fetchStatusEnum('last_status').notNull().default('never'),
    lastError: text('last_error'),
    consecutiveFailures: integer('consecutive_failures').notNull().default(0),
    ...timestamps,
  },
  (t) => [index('sources_due_idx').on(t.isActive, t.nextFetchAt)],
);

// ---------------------------------------------------------------------------
// Users (declared before articles because articles reference editors)
// ---------------------------------------------------------------------------

export const users = pgTable(
  'users',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    email: text('email').notNull(),
    name: text('name'),
    passwordHash: text('password_hash'),
    googleSub: text('google_sub').unique(),
    role: userRoleEnum('role').notNull().default('reader'),
    locale: localeEnum('locale').notNull().default('bg'),
    lastLoginAt: timestamp('last_login_at', { withTimezone: true }),
    ...timestamps,
  },
  (t) => [uniqueIndex('users_email_lower_idx').on(sql`lower(${t.email})`)],
);

export const sessions = pgTable(
  'sessions',
  {
    /** SHA-256 of the cookie token — the raw token is never stored. */
    id: text('id').primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    userAgent: text('user_agent'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('sessions_user_idx').on(t.userId)],
);

export const passwordResetTokens = pgTable('password_reset_tokens', {
  id: text('id').primaryKey(),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  usedAt: timestamp('used_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

// ---------------------------------------------------------------------------
// Content
// ---------------------------------------------------------------------------

export const images = pgTable('images', {
  id: uuid('id').primaryKey().defaultRandom(),
  originalUrl: text('original_url'),
  storageKeyFull: text('storage_key_full').notNull(),
  storageKeyThumb: text('storage_key_thumb').notNull(),
  width: integer('width'),
  height: integer('height'),
  credit: text('credit'),
  licenseNote: text('license_note'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const articles = pgTable(
  'articles',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    sourceId: uuid('source_id')
      .notNull()
      .references(() => sources.id, { onDelete: 'restrict' }),
    originalUrl: text('original_url').notNull().unique(),
    originalTitle: text('original_title').notNull(),
    originalLanguage: text('original_language').notNull(),
    originalAuthor: text('original_author'),
    /** Clean extracted text. Never shown to readers — input for the AI rewrite only. */
    rawText: text('raw_text').notNull(),
    /** Normalised-title hash used to drop the same story syndicated by several sources. */
    contentHash: text('content_hash').notNull(),
    imageId: uuid('image_id').references(() => images.id, { onDelete: 'set null' }),
    sourcePublishedAt: timestamp('source_published_at', { withTimezone: true }),
    ingestedAt: timestamp('ingested_at', { withTimezone: true }).notNull().defaultNow(),
    publishedAt: timestamp('published_at', { withTimezone: true }),
    status: articleStatusEnum('status').notNull().default('ingested'),
    priority: articlePriorityEnum('priority').notNull().default('normal'),
    isAiRewritten: boolean('is_ai_rewritten').notNull().default(false),
    processAttempts: integer('process_attempts').notNull().default(0),
    lastProcessError: text('last_process_error'),
    reviewReason: text('review_reason'),
    /** Urgent status only counts once an editor approved it (urgentApprovedAt set). */
    isUrgent: boolean('is_urgent').notNull().default(false),
    urgentApprovedBy: uuid('urgent_approved_by').references(() => users.id, {
      onDelete: 'set null',
    }),
    urgentApprovedAt: timestamp('urgent_approved_at', { withTimezone: true }),
    urgentExpiresAt: timestamp('urgent_expires_at', { withTimezone: true }),
    indexedAt: timestamp('indexed_at', { withTimezone: true }),
    ...timestamps,
  },
  (t) => [
    index('articles_status_published_idx').on(t.status, t.publishedAt),
    index('articles_source_idx').on(t.sourceId),
    index('articles_content_hash_idx').on(t.contentHash),
    index('articles_urgent_idx').on(t.isUrgent, t.urgentExpiresAt),
  ],
);

/** The reader-facing text of an article, one row per locale. */
export const articleLocalizations = pgTable(
  'article_localizations',
  {
    articleId: uuid('article_id')
      .notNull()
      .references(() => articles.id, { onDelete: 'cascade' }),
    locale: localeEnum('locale').notNull(),
    title: text('title').notNull(),
    slug: text('slug').notNull(),
    /** "Read in 30 seconds" summary. */
    tldr: text('tldr').notNull(),
    /** Paragraphs separated by blank lines. */
    body: text('body').notNull(),
    /** True when produced by translating another localization rather than rewriting the source. */
    isTranslation: boolean('is_translation').notNull().default(false),
    model: text('model'),
    ...timestamps,
  },
  (t) => [primaryKey({ columns: [t.articleId, t.locale] })],
);

/** Public correction log: every editor change to published text is recorded here. */
export const articleCorrections = pgTable(
  'article_corrections',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    articleId: uuid('article_id')
      .notNull()
      .references(() => articles.id, { onDelete: 'cascade' }),
    locale: localeEnum('locale').notNull(),
    note: text('note').notNull(),
    previousBody: text('previous_body'),
    editorId: uuid('editor_id').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('article_corrections_article_idx').on(t.articleId)],
);

export const articleTopics = pgTable(
  'article_topics',
  {
    articleId: uuid('article_id')
      .notNull()
      .references(() => articles.id, { onDelete: 'cascade' }),
    topicId: uuid('topic_id')
      .notNull()
      .references(() => topics.id, { onDelete: 'cascade' }),
  },
  (t) => [
    primaryKey({ columns: [t.articleId, t.topicId] }),
    index('article_topics_topic_idx').on(t.topicId),
  ],
);

// ---------------------------------------------------------------------------
// Reader activity & preferences
// ---------------------------------------------------------------------------

export const userTopicPreferences = pgTable(
  'user_topic_preferences',
  {
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    topicId: uuid('topic_id')
      .notNull()
      .references(() => topics.id, { onDelete: 'cascade' }),
  },
  (t) => [primaryKey({ columns: [t.userId, t.topicId] })],
);

export const userSourceFollows = pgTable(
  'user_source_follows',
  {
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    sourceId: uuid('source_id')
      .notNull()
      .references(() => sources.id, { onDelete: 'cascade' }),
  },
  (t) => [primaryKey({ columns: [t.userId, t.sourceId] })],
);

/** Reading list. */
export const userSavedArticles = pgTable(
  'user_saved_articles',
  {
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    articleId: uuid('article_id')
      .notNull()
      .references(() => articles.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.articleId] })],
);

/**
 * One reaction per reader per article. `actorKey` is `u:<userId>` for signed-in
 * readers or `a:<random id>` from an anonymous cookie, so reactions work without an account.
 */
export const articleReactions = pgTable(
  'article_reactions',
  {
    articleId: uuid('article_id')
      .notNull()
      .references(() => articles.id, { onDelete: 'cascade' }),
    actorKey: text('actor_key').notNull(),
    reaction: text('reaction').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.articleId, t.actorKey] })],
);

/** Hourly view counters — the basis of the "trending now" surface. */
export const articleViewBuckets = pgTable(
  'article_view_buckets',
  {
    articleId: uuid('article_id')
      .notNull()
      .references(() => articles.id, { onDelete: 'cascade' }),
    bucket: timestamp('bucket', { withTimezone: true }).notNull(),
    views: integer('views').notNull().default(0),
  },
  (t) => [
    primaryKey({ columns: [t.articleId, t.bucket] }),
    index('article_view_bucket_idx').on(t.bucket),
  ],
);

export const engagementKinds = ['click', 'dwell', 'reaction', 'save', 'share'] as const;
export const engagementKindEnum = pgEnum('engagement_kind', engagementKinds);
export type EngagementKind = (typeof engagementKinds)[number];

/**
 * Behavioural signals for feed ranking (only recorded with the reader's
 * consent). `actor_key` is "u:<user id>" or "a:<anonymous install id>".
 * Pruned after ENGAGEMENT_RETENTION_DAYS by the worker.
 */
export const engagementEvents = pgTable(
  'engagement_events',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    actorKey: text('actor_key').notNull(),
    userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }),
    articleId: uuid('article_id')
      .notNull()
      .references(() => articles.id, { onDelete: 'cascade' }),
    kind: engagementKindEnum('kind').notNull(),
    /** Reading time for "dwell" events, milliseconds (capped). */
    dwellMs: integer('dwell_ms'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('engagement_actor_idx').on(t.actorKey, t.createdAt),
    index('engagement_created_idx').on(t.createdAt),
  ],
);

// ---------------------------------------------------------------------------
// Notifications
// ---------------------------------------------------------------------------

export const notificationPreferences = pgTable('notification_preferences', {
  userId: uuid('user_id')
    .primaryKey()
    .references(() => users.id, { onDelete: 'cascade' }),
  emailDigest: boolean('email_digest').notNull().default(false),
  pushDigest: boolean('push_digest').notNull().default(false),
  pushUrgent: boolean('push_urgent').notNull().default(true),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

export const pushSubscriptions = pgTable(
  'push_subscriptions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    endpoint: text('endpoint').notNull().unique(),
    p256dh: text('p256dh').notNull(),
    auth: text('auth').notNull(),
    userAgent: text('user_agent'),
    failureCount: integer('failure_count').notNull().default(0),
    lastSuccessAt: timestamp('last_success_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('push_subscriptions_user_idx').on(t.userId)],
);

export const devicePlatformEnum = pgEnum('device_platform', ['ios', 'android']);

/**
 * Native app push tokens (Expo push service → FCM on Android, APNs on iOS).
 * One row per installed app; a token moves to whoever signs in on the device.
 */
export const devicePushTokens = pgTable(
  'device_push_tokens',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    token: text('token').notNull().unique(),
    platform: devicePlatformEnum('platform').notNull(),
    failureCount: integer('failure_count').notNull().default(0),
    lastSuccessAt: timestamp('last_success_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('device_push_tokens_user_idx').on(t.userId)],
);

// ---------------------------------------------------------------------------
// Advertising
// ---------------------------------------------------------------------------

export const adSlots = pgTable(
  'ad_slots',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    name: text('name').notNull(),
    placement: adPlacementEnum('placement').notNull(),
    /** null = shown in every locale. */
    locale: localeEnum('locale'),
    kind: adKindEnum('kind').notNull().default('direct'),
    advertiser: text('advertiser'),
    imageUrl: text('image_url').notNull(),
    targetUrl: text('target_url').notNull(),
    altText: text('alt_text').notNull(),
    width: integer('width').notNull(),
    height: integer('height').notNull(),
    weight: integer('weight').notNull().default(1),
    startsAt: timestamp('starts_at', { withTimezone: true }),
    endsAt: timestamp('ends_at', { withTimezone: true }),
    isActive: boolean('is_active').notNull().default(true),
    impressions: integer('impressions').notNull().default(0),
    clicks: integer('clicks').notNull().default(0),
    ...timestamps,
  },
  (t) => [index('ad_slots_placement_idx').on(t.placement, t.isActive)],
);

// ---------------------------------------------------------------------------
// Operations
// ---------------------------------------------------------------------------

/**
 * Durable job queue (polled with FOR UPDATE SKIP LOCKED). Used for urgent push
 * fan-out, digests and manual "run now" requests from the admin.
 */
export const jobs = pgTable(
  'jobs',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    kind: text('kind').notNull(),
    payload: jsonb('payload').$type<Record<string, unknown>>().notNull().default({}),
    status: jobStatusEnum('status').notNull().default('pending'),
    attempts: integer('attempts').notNull().default(0),
    maxAttempts: integer('max_attempts').notNull().default(5),
    runAfter: timestamp('run_after', { withTimezone: true }).notNull().defaultNow(),
    lockedAt: timestamp('locked_at', { withTimezone: true }),
    lastError: text('last_error'),
    /** Prevents enqueuing the same logical job twice (e.g. one digest per user per day). */
    dedupeKey: text('dedupe_key').unique(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
  },
  (t) => [index('jobs_pending_idx').on(t.status, t.runAfter)],
);

/** One row per pipeline run, shown in the admin and used for alerting. */
export const pipelineRuns = pgTable(
  'pipeline_runs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    kind: text('kind').notNull(),
    trigger: text('trigger').notNull().default('schedule'),
    status: runStatusEnum('status').notNull().default('running'),
    stats: jsonb('stats').$type<Record<string, number>>().notNull().default({}),
    errorSummary: text('error_summary'),
    startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
  },
  (t) => [index('pipeline_runs_kind_started_idx').on(t.kind, t.startedAt)],
);

/** Token accounting for every LLM call — drives the monthly budget cap. */
export const llmUsage = pgTable(
  'llm_usage',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    articleId: uuid('article_id').references(() => articles.id, { onDelete: 'set null' }),
    /** The reader who triggered a request-time call ("ask this article"); null for the pipeline. */
    userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
    purpose: text('purpose').notNull(),
    provider: text('provider').notNull(),
    model: text('model').notNull(),
    inputTokens: integer('input_tokens').notNull().default(0),
    outputTokens: integer('output_tokens').notNull().default(0),
    cacheReadTokens: integer('cache_read_tokens').notNull().default(0),
    costUsd: numeric('cost_usd', { precision: 12, scale: 6, mode: 'number' }).notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('llm_usage_created_idx').on(t.createdAt),
    index('llm_usage_user_idx').on(t.userId, t.createdAt),
  ],
);

/** Small key/value store for operational state (worker heartbeat, alert throttling). */
export const systemState = pgTable('system_state', {
  key: text('key').primaryKey(),
  value: jsonb('value').$type<unknown>().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});
