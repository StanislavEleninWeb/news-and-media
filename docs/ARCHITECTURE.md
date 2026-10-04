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
by relevance then recency, with typo tolerance and highlighted snippets. Collections are namespaced per
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
