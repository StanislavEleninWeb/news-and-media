/**
 * Public API contract (/api/v1). The web app and the mobile app (apps/mobile)
 * code against these schemas; route tests validate every response with them.
 */
import { z } from 'zod';

export const localeSchema = z.enum(['bg', 'en']);

export const topicRefSchema = z.object({ slug: z.string(), name: z.string() });

export const articleCardSchema = z.object({
  id: z.string().uuid(),
  locale: localeSchema,
  title: z.string(),
  tldr: z.string(),
  slug: z.string(),
  /** Site-relative URL of the article page. */
  path: z.string(),
  imageUrl: z.string().nullable(),
  imageThumbUrl: z.string().nullable(),
  source: z.object({ id: z.string().uuid(), name: z.string() }),
  topics: z.array(topicRefSchema),
  publishedAt: z.string().datetime(),
  isUrgent: z.boolean(),
});
export type ArticleCard = z.infer<typeof articleCardSchema>;

export const feedResponseSchema = z.object({
  items: z.array(articleCardSchema),
  page: z.number().int(),
  perPage: z.number().int(),
  hasMore: z.boolean(),
  personalized: z.boolean(),
});
export type FeedResponse = z.infer<typeof feedResponseSchema>;

export const reactionKinds = ['like', 'insightful', 'surprising', 'sad', 'angry'] as const;
export const reactionSchema = z.enum(reactionKinds);
export type Reaction = z.infer<typeof reactionSchema>;

export const reactionSummarySchema = z.object({
  counts: z.record(reactionSchema, z.number().int()),
  mine: reactionSchema.nullable(),
});
export type ReactionSummary = z.infer<typeof reactionSummarySchema>;

export const correctionSchema = z.object({
  locale: localeSchema,
  note: z.string(),
  createdAt: z.string().datetime(),
});

export const articleDetailSchema = articleCardSchema.extend({
  /** Paragraphs of the body. */
  body: z.array(z.string()),
  isAiRewritten: z.boolean(),
  isTranslation: z.boolean(),
  originalUrl: z.string().url(),
  source: z.object({
    id: z.string().uuid(),
    name: z.string(),
    homepageUrl: z.string().nullable(),
    credibilityRating: z.number().int().nullable(),
    credibilityNote: z.string().nullable(),
  }),
  imageCredit: z.string().nullable(),
  corrections: z.array(correctionSchema),
  alternates: z.array(z.object({ locale: localeSchema, path: z.string() })),
  related: z.array(articleCardSchema),
});
export type ArticleDetail = z.infer<typeof articleDetailSchema>;

export const searchResponseSchema = z.object({
  found: z.number().int(),
  page: z.number().int(),
  perPage: z.number().int(),
  engine: z.enum(['typesense', 'postgres']),
  hits: z.array(
    z.object({
      id: z.string(),
      locale: localeSchema,
      title: z.string(),
      tldr: z.string(),
      path: z.string(),
      source: z.string(),
      topics: z.array(z.string()),
      imageUrl: z.string().nullable(),
      publishedAt: z.string().datetime(),
      isUrgent: z.boolean(),
      highlight: z.string().nullable(),
    }),
  ),
  facets: z.object({ topics: z.array(z.object({ slug: z.string(), count: z.number().int() })) }),
});
export type SearchResponse = z.infer<typeof searchResponseSchema>;

export const topicsResponseSchema = z.object({
  topics: z.array(topicRefSchema.extend({ id: z.string().uuid() })),
});

export const adPlacements = [
  'home_top',
  'feed_inline',
  'article_inline',
  'article_bottom',
  'search_inline',
] as const;
export const adPlacementSchema = z.enum(adPlacements);

export const adSchema = z.object({
  id: z.string().uuid(),
  kind: z.enum(['direct', 'house']),
  imageUrl: z.string(),
  targetUrl: z.string(),
  altText: z.string(),
  width: z.number().int(),
  height: z.number().int(),
  advertiser: z.string().nullable(),
  /** Per-reader daily cap the browser enforces (with consent); null = none. */
  frequencyCapPerDay: z.number().int().nullable(),
});
export type Ad = z.infer<typeof adSchema>;

/**
 * Creative sizes per placement for the ad server, as [minViewportWidth, sizes]
 * from widest to narrowest. Every size fits the fixed slot box (no layout shift).
 */
export const adSizeMapping: Record<(typeof adPlacements)[number], [number, [number, number][]][]> =
  {
    home_top: [
      [
        1000,
        [
          [970, 90],
          [728, 90],
        ],
      ],
      [740, [[728, 90]]],
      [
        0,
        [
          [320, 100],
          [320, 50],
        ],
      ],
    ],
    article_bottom: [
      [
        1000,
        [
          [970, 90],
          [728, 90],
        ],
      ],
      [740, [[728, 90]]],
      [
        0,
        [
          [320, 100],
          [320, 50],
        ],
      ],
    ],
    feed_inline: [
      [740, [[728, 90]]],
      [
        0,
        [
          [320, 100],
          [320, 50],
        ],
      ],
    ],
    article_inline: [
      [740, [[728, 90]]],
      [
        0,
        [
          [320, 100],
          [320, 50],
        ],
      ],
    ],
    search_inline: [
      [740, [[728, 90]]],
      [
        0,
        [
          [320, 100],
          [320, 50],
        ],
      ],
    ],
  };

/** GET /api/v1/ads/config — how the browser should fill ad slots (runtime, per environment). */
export const adServerConfigSchema = z.object({
  provider: z.enum(['direct', 'gam']),
  gam: z
    .object({
      networkCode: z.string(),
      adUnitPrefix: z.string(),
      /** Google CMP (TCF) tag; when absent GPT runs in "limited ads" mode. */
      cmpScriptUrl: z.string().nullable(),
    })
    .nullable(),
  prebid: z
    .object({
      scriptUrl: z.string(),
      timeoutMs: z.number().int(),
      bidders: z.record(
        z.string(),
        z.array(z.object({ bidder: z.string(), params: z.record(z.string(), z.unknown()) })),
      ),
    })
    .nullable(),
});
export type AdServerConfig = z.infer<typeof adServerConfigSchema>;

export const gamAdUnitPath = (
  gam: { networkCode: string; adUnitPrefix: string },
  placement: string,
) => `/${gam.networkCode}/${gam.adUnitPrefix}/${placement}`;

export const articlePath = (locale: string, id: string, slug: string) =>
  `/${locale}/a/${id}/${slug}`;

// ---------------------------------------------------------------------------
// Accounts & devices (shared with the mobile app)
// ---------------------------------------------------------------------------

export const sessionUserSchema = z.object({
  id: z.string().uuid(),
  email: z.string(),
  name: z.string().nullable(),
  role: z.enum(['reader', 'editor', 'admin']),
  locale: localeSchema,
});
export type SessionUserDto = z.infer<typeof sessionUserSchema>;

/**
 * POST /api/v1/auth/token — the mobile app's sign-in. The token is a normal
 * session id, sent back as `Authorization: Bearer <token>`.
 */
export const authTokenResponseSchema = z.object({
  token: z.string(),
  expiresAt: z.string().datetime(),
  user: sessionUserSchema,
});
export type AuthTokenResponse = z.infer<typeof authTokenResponseSchema>;

export const meResponseSchema = z.object({
  user: sessionUserSchema,
  preferences: z.object({
    /** Followed topic slugs. */
    topics: z.array(z.string()),
    sourceIds: z.array(z.string().uuid()),
  }),
});
export type MeResponse = z.infer<typeof meResponseSchema>;

export const savedResponseSchema = z.object({ items: z.array(articleCardSchema) });

export const devicePlatforms = ['ios', 'android'] as const;

/** POST /api/v1/push/devices — register a native (Expo → FCM/APNs) push token. */
export const deviceTokenInputSchema = z.object({
  token: z
    .string()
    .max(200)
    .regex(/^(ExponentPushToken|ExpoPushToken)\[[A-Za-z0-9_-]+\]$/, 'Expo push token'),
  platform: z.enum(devicePlatforms),
});
export type DeviceTokenInput = z.infer<typeof deviceTokenInputSchema>;

/** Data carried by every push (web and native) so a tap can open the story. */
export const pushDataSchema = z.object({ url: z.string(), tag: z.string().optional() });

// ---------------------------------------------------------------------------
// Behavioural personalisation & "ask this article"
// ---------------------------------------------------------------------------

/**
 * POST /api/v1/events — reading signals from clients (reactions and saves are
 * recorded by the server itself). Ignored unless the reader consented.
 */
export const engagementBatchSchema = z.object({
  events: z
    .array(
      z.object({
        articleId: z.string().uuid(),
        kind: z.enum(['click', 'dwell', 'share']),
        dwellMs: z.number().int().min(0).max(3_600_000).optional(),
      }),
    )
    .min(1)
    .max(20),
});
export type EngagementBatch = z.infer<typeof engagementBatchSchema>;

/** Header native clients send when the reader allowed personalisation. */
export const CONSENT_HEADER = 'x-nm-consent';

export const chatRequestSchema = z.object({
  locale: localeSchema,
  question: z.string().trim().min(2).max(500),
  /** Earlier turns, oldest first; the server keeps the last few. */
  history: z
    .array(z.object({ role: z.enum(['user', 'assistant']), content: z.string().max(2_000) }))
    .max(20)
    .default([]),
});
export type ChatRequest = z.input<typeof chatRequestSchema>;

export const chatResponseSchema = z.object({
  answer: z.string(),
  /** True when the article does not cover the question (the model declined). */
  refused: z.boolean(),
});
export type ChatResponse = z.infer<typeof chatResponseSchema>;
