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
