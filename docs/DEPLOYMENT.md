# Deployment (Contabo VPS)

One VPS runs both **staging** and **production** as separate Docker Compose projects behind a shared
Caddy proxy that terminates HTTPS. Nothing depends on a hosting platform's config or key storage:
images are built by GitHub Actions, pushed to GitHub Container Registry (GHCR), and started on the
VPS by `infra/deploy/deploy.sh`.

```
                 ┌──────────────── VPS ────────────────────────────────────────────┐
 Internet ──443──▶ caddy (edge) ──▶ newsmedia-production: web ─┬─ postgres         │
                 │     │                                 worker ┴─ typesense        │
                 │     └────────▶ newsmedia-staging:    web ─┬─ postgres         │
                 │  /media/* served from disk            worker ┴─ typesense        │
                 └─────────────────────────────────────────────────────────────────┘
```

## Environments

| | Local dev | Staging | Production |
| --- | --- | --- | --- |
| Branch | any | `develop` | `main` |
| Database | `infra/compose/dev.yml` Postgres | own Postgres container + volume | own Postgres container + volume |
| Search | dev Typesense | own Typesense | own Typesense |
| Media | docker volume | `/srv/newsmedia/staging/data/media` | `/srv/newsmedia/production/data/media` |
| Schedules (`SCHEDULER_ENABLED`) | off — run from admin/CLI | off by default | on |
| Secrets | `.env` (git-ignored) | `/srv/newsmedia/staging/.env` | `/srv/newsmedia/production/.env` |
| Access | localhost | HTTP basic auth, `noindex` | public |

The same image tag is promoted from staging to production; only `.env` differs.

## Release flow

1. Open a PR → **CI** runs format check, lint, typecheck, tests, a full build and both Docker builds.
2. Merge into `develop` → CI passes → **Deploy** builds `web`/`worker` images tagged with the commit
   SHA, uploads `app.yml` + `deploy.sh`, and runs them against **staging**.
3. Merge `develop` into `main` → the same happens for **production**.
4. `deploy.sh` pulls the images, applies database migrations (`migrate` service), restarts `web`
   and `worker`, and waits for `/api/health`. A failed health check fails the workflow.

**Rollback:** Actions → Deploy → *Run workflow* → pick the environment and a previous SHA from
`/srv/newsmedia/<env>/deployments.log`. Migrations are forward-only (see RUNBOOK).

## One-time setup

### 1. VPS

```bash
# as root on a fresh Ubuntu 22.04/24.04 VPS
bash infra/vps/bootstrap.sh
```

This installs Docker, enables the firewall (22/80/443 only), disables SSH passwords, creates the
`deploy` user and `/srv/newsmedia/{edge,staging,production}`, and creates the `edge` network.

### 2. Edge proxy

```bash
# as deploy, in /srv/newsmedia/edge
cp <repo>/infra/edge/{compose.yml,Caddyfile} .
cp <repo>/infra/edge/edge.env.example .env                  # set domains + ACME email
cp <repo>/infra/edge/staging_users.caddy.example staging_users.caddy   # add a bcrypt hash
docker compose --env-file .env -f compose.yml up -d
```

Point the DNS A records for both domains at the VPS first so Let's Encrypt can issue certificates.

### 3. Environment files

```bash
cp infra/env/app.env.example /srv/newsmedia/production/.env   # edit every value
cp infra/env/app.env.example /srv/newsmedia/staging/.env      # APP_ENV=staging, own secrets
chmod 600 /srv/newsmedia/*/.env
```

### 4. GitHub

* Create two **Environments** (Settings → Environments): `staging` and `production`. Optionally add
  yourself as a required reviewer on `production`.
* In each, add secrets:
  * `VPS_HOST` — server IP or hostname
  * `VPS_USER` — `deploy`
  * `VPS_SSH_KEY` — private key of a key pair created only for deployments
  * `VPS_KNOWN_HOSTS` — output of `ssh-keyscan <host>`
* Put the matching public key in `/home/deploy/.ssh/authorized_keys`.
* GHCR images are private by default: on the VPS run `docker login ghcr.io -u <github-user>` as
  `deploy` with a token that has only `read:packages`, or make both packages public.

### 5. First admin account

```bash
cd /srv/newsmedia/production
docker compose --project-name newsmedia-production --env-file .env -f app.yml \
  run --rm worker node dist/cli.js create-admin --email you@seweb.co --password '<long password>'
docker compose --project-name newsmedia-production --env-file .env -f app.yml \
  run --rm worker node dist/cli.js seed-topics
```

### 6. Optional: Sign in with Google

Create an OAuth client (Web application) in Google Cloud and add one redirect URI per environment:
`http://localhost:3000/api/v1/auth/google/callback`, `https://<staging>/api/v1/auth/google/callback`,
`https://<production>/api/v1/auth/google/callback`. Put `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` in
each environment's `.env`. Without them the Google button is hidden.

### E-mail

Any SMTP provider works (`SMTP_URL=smtps://user:pass@host:465`). Outside production, mail and push go
**only** to addresses in `NOTIFY_ALLOWLIST`; locally everything lands in Mailpit (http://localhost:8025).

### 7. Monitoring, alerts, backups

* **Uptime:** point an external monitor (UptimeRobot, Better Stack, or Uptime Kuma on another
  machine) at `https://<domain>/api/health` and `https://<domain>/api/health/worker`.
* **Alerts:** set `ALERT_WEBHOOK_URL` (Slack/Discord/Mattermost incoming webhook) and/or `ALERT_EMAIL`.
  The worker checks every 10 minutes for failed ingestion, a day without new articles, the LLM budget
  and a stuck AI queue (production schedule).
* **Errors:** optional `SENTRY_DSN` — Sentry's free tier, or self-hosted GlitchTip (same SDK).
* **Backups:** add the `backup.sh` cron line from [RUNBOOK.md](RUNBOOK.md#backups-and-restore).

See [LAUNCH-CHECKLIST.md](LAUNCH-CHECKLIST.md) before the first public release.
