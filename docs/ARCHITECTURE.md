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
