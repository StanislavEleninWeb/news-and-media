# news-and-media

Self-running news & media trends platform in Bulgarian and English, by SEWEB.

## Stack

Next.js 15 web app (site + API + admin) · Node worker · PostgreSQL · Typesense · Caddy ·
Docker Compose on a VPS · GitHub Actions. Details: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md),
deployment: [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md).

```
apps/web       Next.js — public site, /api, /admin
apps/worker    background jobs and operator CLI
packages/core  configuration, logging, shared services
infra/         compose files, Caddy edge, VPS bootstrap, deploy script
```

## Local development

Requirements: Node 22, pnpm 10 (`corepack enable`), Docker.

```bash
pnpm install
cp .env.example .env
pnpm dev:services          # postgres, typesense, mailpit
pnpm dev                   # web on http://localhost:3000 and the worker, with hot reload
```

| Command | What it does |
| --- | --- |
| `pnpm lint` / `pnpm typecheck` / `pnpm test` | Quality gates (same as CI) |
| `pnpm format` | Prettier |
| `pnpm build` | Production builds of web and worker |
| `pnpm --filter @nm/worker cli help` | Operator commands |

Mail sent in development is caught by Mailpit at http://localhost:8025.
