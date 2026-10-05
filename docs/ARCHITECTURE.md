# Architecture

| Part | Technology | Notes |
| --- | --- | --- |
| Monorepo | pnpm workspaces | `apps/*`, `packages/*` |
| Web | Next.js 15 (App Router), React 19 | Public site, JSON API (`/api/v1`), admin CMS (`/admin`) in one app |
| Worker | Node 22, bundled with esbuild | Ingestion, AI rewrite/translate, search sync, notifications, scheduled jobs |
| Shared code | `@nm/core` (config, logging, services), `@nm/db` (schema, migrations) | TypeScript sources consumed directly |
| Database | PostgreSQL 17 | Self-hosted container per environment |
| Search | Typesense | Self-hosted container per environment |
| Reverse proxy | Caddy 2 | Automatic HTTPS, serves media from disk |
| Deploy | Docker Compose on a Contabo VPS, GitHub Actions + GHCR | See DEPLOYMENT.md |

## Decisions

* **VPS instead of Vercel/Supabase.** Everything runs in containers we control; configuration is
  plain environment variables in a per-environment `.env` on the server. No vendor-specific config.
* **Same image in every environment.** No build-time environment variables (`NEXT_PUBLIC_*`); values
  the browser needs are served by the API at runtime.
* **Lazy configuration.** `getConfig()` validates on first use, so builds and tests never need secrets.
* **No LLM calls on the request path.** AI work happens in the worker; pages and API read from
  Postgres/Typesense (discovery doc, section A).

## Data model

Defined in `packages/db/src/schema.ts` (Drizzle), migrations in `packages/db/migrations`.

* **sources** — managed from the admin at runtime (add, edit, pause, delete). Each has a kind
  (`rss` or `html` listing page), language, fetch interval, default topic, credibility rating and an
  `images_allowed` flag: images are only downloaded from sources we are licensed to reuse.
* **articles** — one row per scraped story with the raw text (never shown to readers), status
  (`ingested → processing → published | needs_review | rejected | failed`), urgency (only active once an
  editor approved it) and priority.
* **article_localizations** — the reader-facing title, slug, TL;DR and body per locale (`bg`, `en`).
* **article_corrections** — public correction log for edits to published text.
* **topics** — editable list (general, politics, business, tech, culture, sport to start).
* Reader tables: users, sessions, preferences, follows, saved articles, reactions, push subscriptions.
* Operations: `jobs` (durable queue), `pipeline_runs`, `llm_usage` (budget cap), `system_state`.

Migrations run automatically on deploy and are generated with `pnpm db:generate`. Tests run against
an in-process PostgreSQL (PGlite), so no database server is needed to run the suite.

## Ingestion (worker)

Every minute the worker picks the sources whose `next_fetch_at` has passed (so each source's own
interval, set in the admin, controls frequency):

1. Read the RSS/Atom feed — or, for `html` sources, collect article links from the listing page with
   the source's CSS selector.
2. Normalise URLs (tracking parameters removed) and skip known ones.
3. Respect `robots.txt` (cached per site for 6 h) and fetch the article page through a guarded client
   that refuses private/internal addresses, caps size and time, and follows at most 5 redirects.
4. Extract the main text with Mozilla Readability (falls back to the feed's content), decode
   windows-1251 pages, skip texts shorter than `INGEST_MIN_TEXT_LENGTH`.
5. Drop the same headline syndicated by several sources within 72 h.
6. Download the image **only if the source is marked `images_allowed`** (licensing — discovery doc,
   section D), convert it to webp renditions (1280 px and 480 px for lite mode).
7. Store the article as `ingested`; the AI step picks it up next.

Failing sources back off exponentially (up to 8× their interval). Every run is recorded in
`pipeline_runs`. Operator commands: `cli ingest`, `cli ingest --source <id>`, `cli test-source <id>`,
`cli add-source --url … --name …`.

## AI rewrite & translation (worker)

Every minute the worker claims up to `LLM_MAX_ARTICLES_PER_RUN` articles in `ingested` state
(flagship first; `FOR UPDATE SKIP LOCKED`, so parallel workers never double-process) and for each:

1. **Rewrite** in the primary language — the source's language if it is Bulgarian or English,
   otherwise Bulgarian — with Claude Haiku (`claude-haiku-4-5-20251001`) by default. The prompt forbids
   adding facts and reusing the source's wording, requires attribution, and returns JSON with title,
   TL;DR ("read in 30 seconds"), body and 1–3 topics from the live topic list.
2. **Originality guard** — the share of the rewrite's 8-word sequences found in the source. Above
   `LLM_SIMILARITY_THRESHOLD` (20 %) the model is asked once more with stricter instructions; if it is
   still too close the article goes to `needs_review` instead of being published.
3. **Translate** into the other language (LLM; DeepL instead for flagship articles when
   `DEEPL_API_KEY` is set).
4. Save both localizations, topics (fallback: the source's default topic), mark the article
   `published` and AI-rewritten. Invalid model output is retried once; an article that fails three
   times becomes `failed`.

**Cost control.** Every call is logged in `llm_usage` with its cost. Processing stops when the month's
spend reaches `LLM_MONTHLY_BUDGET_USD` (production default $50, elsewhere $5) and the run is recorded
as failed so alerting picks it up. The shared system prompt is sent with Anthropic prompt caching;
it only takes effect once that prefix exceeds the model's minimum cacheable length.

**Switching provider** is configuration only: `LLM_PROVIDER=openai` with `OPENAI_COMPAT_*` uses any
OpenAI-compatible API (DeepSeek, Groq, …), and `LLM_FALLBACK_PROVIDER` adds an automatic fallback
when the primary is down. Operator commands: `cli process`, `cli reprocess <id>`, `cli llm-spend`.

## Search

Typesense holds one document per article **and locale** (`<id>_bg`, `<id>_en`) with title, TL;DR,
body, topics, source and publish time; queries are filtered by locale (and optionally topic), ranked
by relevance then recency, with highlighted snippets. English queries tolerate one typo; Bulgarian
queries use exact and prefix matching only, because Typesense counts typos in bytes and a Cyrillic
letter takes two. Collections are namespaced per
environment (`TYPESENSE_COLLECTION_PREFIX`, default `<APP_ENV>_`).

The worker's `search-sync` task (every 30 s, all environments) indexes newly published articles and
re-indexes or removes articles whose `updated_at` is newer than `indexed_at` — so anything that edits
an article only needs to touch the article row. `cli reindex` rebuilds a collection from PostgreSQL
(new environment, schema change) without re-scraping. Without `TYPESENSE_URL`, the API falls back to a
simple PostgreSQL search, which is enough for local development.

## Web frontend

* **Routing:** every public page lives under `/bg` or `/en` (`app/[locale]`). `middleware.ts` sends
  prefix-less URLs to the reader's last language (cookie) or browser language; Bulgarian is the default.
  Article URLs are `/<locale>/a/<id>/<slug>`; a wrong or other-language slug redirects to the canonical
  one, and `hreflang` alternates link the two language versions.
* **Speed:** pages are server components rendered on first request and then served from the Next.js
  cache (ISR — home and topics 60 s, articles 5 min); nothing is prerendered at build time, so builds
  need no database. Pages contain no per-user data: who is signed in, the "For you" tab and "load
  more" are fetched in the browser from `/api/v1`. No web fonts, no client-side data libraries, images
  lazy-loaded with fixed dimensions, ad space reserved up front (no layout shift).
* **Design:** editorial and typography-led (most stories have no licensed image), serif headlines and
  system sans body text that both cover Cyrillic, light/dark following the system setting, focus
  styles and a skip link for keyboard users.
* **SEO:** per-page metadata, canonical + `hreflang`, Open Graph, `NewsArticle` JSON-LD (with
  `isBasedOn` pointing at the original), `sitemap.xml` and `robots.txt` (staging/dev disallow all).

## Engagement & trust (reader-facing)

* **Reading list** — save/unsave on every article (signed-in readers), `/<locale>/saved`.
* **Reactions** — five reactions, one per reader per article, no account needed.
* **Transparency on every article** — an "AI-rewritten" label in the byline and a disclosure naming the
  source, a note when the text is a machine translation, the source's reliability rating (set by
  editors), a prominent link to the original, and the public correction log.
* **Reading settings** — text size, theme (system/light/dark) and high contrast in the "Aa" menu,
  stored in the browser and applied by a tiny inline script before first paint (no flash, and pages
  stay identical for everyone so they remain cacheable). Lite mode switches on automatically on
  data-saver/2G connections.

## PWA & offline

The site is an installable Progressive Web App (manifest, maskable icons, install button where the
browser offers it) — the MVP's stand-in for native apps. `public/sw.js`:

* pages: network first with a 4-second timeout, then the cached copy, then `/offline.html`;
* articles the reader **saves** are cached in a separate store that is never evicted, so they open
  offline; un-saving removes the copy; the reading list itself is remembered for offline display;
* hashed Next.js assets and icons: cache first; images (`/media`): cache first, bounded to 150;
* `/api` and `/admin` are never cached.

**Lite mode** hides photos entirely (they are never requested). It turns on automatically on
data-saver or 2G connections and can be toggled in the "Aa" menu.

## Admin CMS (`/admin`)

English-language newsroom UI for editors and admins (role on `users`; create the first one with
`cli create-admin`). Every page and server action re-checks the session and role; `/admin` is
`noindex`, excluded in `robots.txt`, and staging is additionally behind HTTP basic auth.

* **Review queue** — articles the originality guard sent to `needs_review`, failed ones, everything
  else filterable by status and title. The editor shows the source text next to the Bulgarian and
  English versions.
* **Editing** — changing published text requires a correction note, which is published in the
  article's correction log together with the previous version.
* **Breaking news** — "Approve as urgent" (with a 1–24 h pin) is the *only* way a story becomes
  urgent; it records the editor and time and queues the push notification. The AI never sets it.
* **Sources** — add, edit, pause, delete (or deactivate when they have articles) at runtime; "Test
  fetch" dry-runs the scraper and shows what it would pick up; "Fetch now" queues a run.
* **Topics** — add, rename, reorder, deactivate (slugs are permanent: they are in URLs and the AI's
  classification list).
* **Runs & jobs** — pipeline history, the job queue, and buttons to fetch, process or rebuild the
  search index now.

Admin actions that change what readers see revalidate the cached public pages immediately. Manual
"run now" requests go through the PostgreSQL job queue (`jobs` table, `FOR UPDATE SKIP LOCKED`), which
the worker polls every 5 s in every environment.

## Notifications

Self-hosted, no third-party notification service:

* **Web push** via the standard Web Push protocol with VAPID keys (`web-push`), delivered by the
  browser vendors' push services — works on Android, desktop browsers and iOS 16.4+ once the site is
  added to the Home Screen. Readers turn it on per device in their account; expired subscriptions are
  removed automatically. Generate keys once per environment with `cli generate-vapid-keys`; the public
  key is served at runtime by `/api/v1/push/vapid-public-key`.
* **Breaking news** — approving a story as urgent in the admin queues an `urgent_push` job; the worker
  sends it (high urgency, one notification per story per device) to readers who allow urgent pushes and
  follow one of the story's topics, or follow no topics at all.
* **Daily briefing** — at `DIGEST_HOUR` (default 07:00 `Europe/Sofia`) the production schedule queues one
  `digest` job per opted-in reader (exactly once per day); each gets the top `DIGEST_SIZE` stories of
  the last 24 h from their personalised feed, by e-mail (HTML + text, `List-Unsubscribe`) and/or push.
* **Native app push** — the mobile app registers an Expo push token (`/api/v1/push/devices`, table
  `device_push_tokens`). The same `urgent_push` and `digest` jobs fan out to both channels through
  `PushChannels {web, native}`; native messages go to the Expo push service, which relays them to FCM
  (Android) and APNs (iOS) using the credentials stored in EAS — the VPS holds no Apple/Google keys.
  Breaking news uses high priority and the Android `breaking` channel. `DeviceNotRegistered` tickets
  remove the token. `NATIVE_PUSH_ENABLED=false` switches the channel off; `EXPO_ACCESS_TOKEN` is
  optional (Expo "enhanced push security").
* **Safety net** — outside production nothing is delivered except to `NOTIFY_ALLOWLIST`.

Operator commands: `cli send-digest --email <e>`, `cli test-push --email <e>`.

## Behavioural personalisation

Opt-in only: web readers who chose "Accept all", app readers who switched on *Rank stories by what
I read* (sent as `x-nm-consent: personalization`). Without consent nothing is recorded or used.

* **Signals** (`engagement_events`): article opened (`click`), visible reading time (`dwell`, from
  `visibilitychange`/`pagehide` via `sendBeacon`, capped at 10 min), `reaction`, `save`, `share`.
  Clients post opens/dwell/shares to `/api/v1/events`; reactions and saves are recorded by the server.
* **Profile** (`content/behavior.ts`): last 60 days, weights click 1 · dwell up to 3 (1 per 30 s) ·
  reaction 3 · share 3 · save 4, halved every 14 days; normalised to 0–1 per topic and per source.
* **Ranking** (`getFeed`): on top of followed topics/sources (+12 h), a graded lift of up to +8 h for
  the reader's most-read topic and +4 h for the most-read source, and −6 h for stories opened in the
  last 3 days. All bounded, so a fresh story always beats an old favourite.
* **Privacy**: anonymous readers are keyed by the `nm_aid` id; withdrawing consent (or switching it off
  in the app) calls `DELETE /api/v1/events`; the worker deletes events after
  `ENGAGEMENT_RETENTION_DAYS` (90); account deletion cascades.

## "Ask this article" chat

`POST /api/v1/articles/:id/chat` — the only LLM call made at request time.

* **Narrow context**: only that article's rewritten title, summary and body in the reader's language
  go into the system prompt (cacheable per article). No corpus retrieval. The model must answer from
  the article or reply `NOT_IN_ARTICLE`, which the API turns into a polite refusal (`refused: true`).
  Article text is marked as data; instructions inside it are ignored.
* **Cost control**: own key `CHAT_ANTHROPIC_API_KEY` (no fallback to the pipeline key), signed-in readers
  only, `CHAT_MAX_PER_HOUR`/`CHAT_MAX_PER_DAY` counted in `llm_usage` (persistent), a 5/min burst
  guard, `CHAT_MONTHLY_BUDGET_USD`, 500 output tokens, last 6 turns of history, 30 s timeout.
  `llm_usage.purpose = 'chat'` with `user_id`; the pipeline budget excludes chat; the admin dashboard
  shows both.

## Mobile app (`apps/mobile`)

Expo SDK 57 / React Native, Expo Router. Screens: feed (topic chips, pull-to-refresh, infinite
scroll), article (reactions, save, share, original source, corrections, related), topic, search,
reading list, account (language, sign-in, push toggle). Same design tokens as the website, light and
dark.

* **Contracts** — the app calls the public `/api/v1` and validates every response with the zod
  schemas in `packages/contracts`, the same ones the route tests use.
* **Auth** — `POST /api/v1/auth/token` returns a normal session token, stored in the Keychain /
  Keystore (`expo-secure-store`) and sent as `Authorization: Bearer`. A bearer header always wins over
  cookies. The app sends neither cookies nor `Origin`, so CSRF checks pass it through; browser
  requests with cookies or a cross-site `Origin` are still checked. Anonymous reactions use an install
  id in `X-NM-Anon-Id`.
* **Variants** — `APP_VARIANT` = development / staging / production with separate bundle ids, set by the
  EAS profiles in `eas.json`. Internal builds pass the staging basic-auth gate with `X-Staging-Key`
  (Caddy `STAGING_APP_KEY`).
* **CI** — `ci.yml` exports the iOS and Android JS bundles on every PR; `mobile.yml` queues EAS builds
  (develop → staging, main → production) when `EXPO_TOKEN` is set. Store submission is manual.

## Ads

Five placements (`home_top`, `feed_inline`, `article_inline`, `article_bottom`, `search_inline`) are
part of the page layout from day one, each a fixed-size box (970×90 / 728×90, 320×100 on phones) so a
creative arriving — or not — never shifts the content. Creatives load in the browser from
`/api/v1/ads`, which keeps cached pages identical for everyone and rotates creatives per view.

* **Direct-sold and house ads** are managed in `/admin/ads`: placement, language, schedule, rotation
  weight, upload (re-encoded to WebP) or image URL, click-through URL, alt text. Direct-sold ads win
  over house ads; impressions, clicks and CTR are shown per ad.
* **Consent first** — a cookie banner offers "accept all" or "necessary only". Impression beacons and
  click counting happen only with consent; without it the ad links straight to the advertiser. No
  third-party ad scripts are loaded at all in the MVP. Click redirects use the URL stored for the ad,
  never one from the request (no open redirect).
* **Programmatic** exchanges (e.g. Google Ad Manager with header bidding) are deferred to v1; they slot
  into the same placements.

`/<locale>/privacy` explains the cookies in plain language — have it reviewed before launch.

## Observability

* Structured JSON logs from every service (`docker compose logs`), secrets redacted.
* Error tracking: unhandled errors in pages, API routes, server actions (Next.js `onRequestError`),
  scheduled tasks and jobs go to Sentry/GlitchTip when `SENTRY_DSN` is set, tagged by environment,
  service and release (commit SHA) — dev noise never mixes with production. A ~100-line client speaks
  the Sentry envelope protocol directly (no SDK), so nothing heavy is bundled.
* Health: `/api/health` (database + search, used by deploys) and `/api/health/worker` (heartbeat
  younger than 5 minutes) for external uptime monitors.
* Alerts: pipeline checks every 10 minutes, throttled to one per kind per 6 hours, to a webhook and/or
  e-mail.
* Performance budget: a Lighthouse CI job (performance and accessibility ≥ 90, CLS ≤ 0.1) runs on
  every pull request against a production build with sample content.
* Security headers: CSP (production), HSTS (Caddy), `nosniff`, `DENY` framing, strict referrer policy.
