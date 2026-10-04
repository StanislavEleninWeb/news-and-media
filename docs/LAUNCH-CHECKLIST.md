# Launch checklist (MVP)

## Legal & editorial (discovery doc, section D)
- [ ] Lawyer reviewed the scraping/rewriting approach, attribution and the privacy page (`/bg/privacy`)
- [ ] Final source list entered in Admin → Sources; images allowed **only** where licensed
- [ ] Reliability ratings set for each source
- [ ] At least one editor knows the urgent-approval flow and the correction log
- [ ] Imprint/contact details added (company name, address, editor in charge)

## Infrastructure
- [ ] DNS A records for production and staging point to the VPS
- [ ] `bootstrap.sh` run; edge Caddy running with valid certificates
- [ ] Production and staging `.env` complete (see `infra/env/app.env.example`), `chmod 600`
- [ ] GitHub environments + secrets set; first deploy to staging green, then production
- [ ] `cli seed-topics` and `cli create-admin` run in production
- [ ] VAPID keys generated (per environment); `cli test-push` works on a phone
- [ ] SMTP verified (SPF/DKIM/DMARC for the sending domain); `cli send-digest` received
- [ ] Optional: Google OAuth client with redirect URIs for every environment

## Operations
- [ ] Backup cron installed; one restore tested on staging
- [ ] Uptime monitors on `/api/health` and `/api/health/worker`
- [ ] `ALERT_WEBHOOK_URL` or `ALERT_EMAIL` set and a test alert received
- [ ] `SENTRY_DSN` set (optional but recommended)
- [ ] `LLM_MONTHLY_BUDGET_USD` and `LLM_MAX_ARTICLES_PER_RUN` chosen; spend limit also set in the Anthropic console
- [ ] Optional fallback provider configured (`LLM_FALLBACK_PROVIDER`)

## Product
- [ ] Lighthouse CI green on the release PR
- [ ] Spot-check 20 AI-rewritten articles in both languages for accuracy and tone
- [ ] Install the PWA on Android and iPhone; save an article and open it offline
- [ ] House ads created for every placement (otherwise slots show as empty reserved space)
