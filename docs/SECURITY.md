# Security notes

What protects the platform, and the risks deliberately accepted for the MVP. Re-run a dependency
audit (`pnpm audit`) before every release; Dependabot opens weekly update PRs.

## In place

| Area | Measure |
| --- | --- |
| Outbound fetching (scraper) | SSRF guard: http(s) only; private/internal IP literals refused; hostnames validated **inside the connection's DNS lookup** (no DNS-rebinding window); every redirect hop re-checked; size and time caps; robots.txt honoured |
| Sessions | 256-bit random tokens, only SHA-256 stored, HttpOnly + SameSite=Lax + Secure on HTTPS, 30-day expiry, all sessions revoked on password reset |
| Passwords | scrypt (N=16384, r=8, p=1), constant-time comparison, same timing for unknown accounts |
| CSRF | Origin/Referer check on every state-changing API call; Next.js server-action origin check |
| Brute force | Per-IP and per-account login limits; limits on registration, reset, search, reactions |
| Admin | Role re-checked on every page and server action; `noindex`; staging behind basic auth |
| Uploads | Ad creatives and article images re-encoded by sharp (metadata stripped, pixel limit) |
| Redirects | Post-login and ad-click redirects never take a target from the request |
| HTML output | React escaping; the only raw HTML is JSON-LD (escaped `<`) and search highlights (all escaped except `<mark>`) |
| Headers | CSP (production), HSTS (Caddy), `nosniff`, `X-Frame-Options: DENY`, strict referrer policy |
| Containers | Non-root users; PostgreSQL and Typesense not exposed outside the Docker network |
| Supply chain | Lockfile; GitHub Actions pinned to commit SHAs; 3-day minimum release age (pnpm); install scripts allowed only for esbuild and sharp; Dependabot with a 5-day cooldown; least-privilege workflow permissions |

## Accepted for the MVP (revisit later)

* **CSP allows inline scripts.** Next.js and the pre-paint settings script need them; a nonce-based CSP
  would make every page dynamic and lose the ISR cache. Mitigated by React escaping and the absence of
  third-party scripts.
* **`braces` advisory (dev only).** Pulled in by `@next/eslint-plugin-next` → `fast-glob`; no patched
  version exists yet and it never runs in production.
* **Rate limits are per process.** Fine for one web container; move them to PostgreSQL/Redis before
  running several.
* **Registration reveals whether an e-mail exists** (409 on a taken address) — standard trade-off for a
  clear sign-up message; login and password reset do not reveal it.
* **Docker base images are pinned by tag, not digest.** Dependabot proposes updates; pin digests once
  the images are pulled from a registry you trust.
* **Prompt injection from scraped pages.** Source text could try to steer the AI rewrite. The model only
  returns structured JSON, never acts, the originality guard and editors review output, and every story
  links to its original.
