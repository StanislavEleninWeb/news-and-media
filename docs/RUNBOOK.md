# Runbook

Everything below runs on the VPS as the `deploy` user. Shorthand used throughout:

```bash
cd /srv/newsmedia/production            # or staging
alias dc='docker compose --project-name newsmedia-production --env-file .env -f app.yml'
alias cli='dc run --rm worker node dist/cli.js'
```

## Where to look first

| Signal | Where |
| --- | --- |
| Is the site up? | `curl -s https://<domain>/api/health` (database + search) |
| Is the worker alive? | `curl -s https://<domain>/api/health/worker` (503 after 5 min without heartbeat) |
| What is the pipeline doing? | Admin → Dashboard / Runs & jobs |
| Logs | `dc logs -f --tail 200 worker` · `dc logs -f --tail 200 web` (JSON lines) |
| Errors | Sentry/GlitchTip project, if `SENTRY_DSN` is set |
| Alerts | `ALERT_WEBHOOK_URL` channel and/or `ALERT_EMAIL` |

Set up an external uptime monitor (UptimeRobot, Better Stack, or Uptime Kuma on another machine) for
both health URLs, every 1–5 minutes.

## Alerts and what to do

| Alert | Meaning | Action |
| --- | --- | --- |
| Ingestion run failed | Every due source errored | Network/DNS on the VPS? `cli ingest` and read the errors; check Admin → Sources |
| No new articles in 24 h | Nothing ingested though sources are active | Worker down (`dc ps`, `dc up -d worker`), schedules off (`SCHEDULER_ENABLED`), or sources broken |
| LLM budget reached | Monthly cap hit; AI processing stopped | Raise `LLM_MONTHLY_BUDGET_USD` in `.env`, `dc up -d worker`; check `cli llm-spend` |
| LLM spend past 80 % | Early warning | Lower `LLM_MAX_ARTICLES_PER_RUN`, pause noisy sources, or raise the budget |
| AI queue falling behind | ≥ 20 articles waiting > 6 h | Provider outage or bad key: see worker logs; switch provider (below) |

Alerts repeat at most every 6 hours per kind.

## Common operations

**Deploy / roll back.** Merge to `develop` (staging) or `main` (production). To roll back, run the
*Deploy* workflow manually with a previous SHA from `deployments.log`, or on the VPS:
`./deploy.sh production <previous-sha>`.

**Run work now.** Admin → Runs & jobs, or `cli ingest`, `cli process`, `cli index-sync`.

**A source keeps failing.** Admin → Sources → the source → *Test fetch* shows the exact error and what
would be picked up. Fix the URL/selector or pause it. Failing sources back off automatically.

**Switch the AI provider** (outage, cost). No code change: in `.env` set e.g.
`LLM_PROVIDER=openai`, `OPENAI_COMPAT_BASE_URL=https://api.deepseek.com`, `OPENAI_COMPAT_API_KEY=…`,
`OPENAI_COMPAT_MODEL=deepseek-chat` and the matching `LLM_*_PRICE_PER_MTOK`, then `dc up -d worker`.
Better: keep `LLM_FALLBACK_PROVIDER` configured permanently so outages switch automatically.

**Re-run the AI on an article.** Admin → article → *Re-run AI rewrite*, or `cli reprocess <id>`.

**Rebuild search.** `cli reindex` (drops and rebuilds the Typesense collection from PostgreSQL).

**New editor or admin.** `cli create-admin --email … --password … --role editor`, or Admin → Users.

**Web push keys.** Generate once per environment with `cli generate-vapid-keys`; changing them
invalidates every existing device subscription.

**Rotate secrets.** Edit `.env`, then `dc up -d web worker`. Rotating `POSTGRES_PASSWORD` also needs
`dc exec postgres psql -U newsmedia -c "alter user newsmedia password '…'"` first.

## Backups and restore

`backup.sh` (uploaded with every deploy) dumps PostgreSQL and archives media into
`$DATA_DIR/backups`, keeps 14 days, and copies off-site when `RCLONE_REMOTE` is set:

```bash
crontab -e
15 3 * * * /srv/newsmedia/production/backup.sh production >> /srv/newsmedia/production/backup.log 2>&1
```

Restore: `./restore.sh production $DATA_DIR/backups/db-<stamp>.dump` (asks for confirmation, stops the
app, restores, migrates, restarts, rebuilds search). Test a restore on staging every quarter.

## Database migrations

Migrations are **forward-only** and applied automatically by every deploy before the new code
starts. Write them **expand → contract** so the previous release keeps working against the new schema
(which is what makes a rollback safe):

1. *Expand*: add nullable columns/tables; deploy code that writes both old and new.
2. Backfill if needed.
3. *Contract*: in a later release, drop what is no longer used.

Never rename or drop a column in the same release that stops using it. If a migration itself went
wrong, restore the last backup (above) — there are no down-migrations.

## Incident checklist

1. Check both health URLs and `dc ps`.
2. Read the last 200 lines of worker and web logs.
3. If a deploy caused it: roll back to the previous SHA.
4. If data is damaged: stop the worker (`dc stop worker`), restore the last good backup.
5. Write down what happened and what to change in this runbook.
