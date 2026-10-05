# Public API — `/api/v1`

JSON over HTTPS, used by the web app and (later) the mobile app. Response shapes are defined as zod
schemas in `packages/services/src/content/contracts.ts`; route tests validate every response against
them. The API never calls an AI model at request time — it only reads PostgreSQL and Typesense.

| Method | Path | Auth | Description |
| --- | --- | --- | --- |
| GET | `/api/v1/feed?locale=bg&topic=&source=&page=&perPage=` | optional | Feed: approved urgent stories first, then newest; personalised when signed in |
| GET | `/api/v1/articles/:id?locale=` | – | Full article: body, TL;DR, source + credibility, AI disclosure, corrections, alternates, related |
| GET | `/api/v1/search?q=&locale=&topic=&page=` | – | Search (Typesense, PostgreSQL fallback in dev) with highlights and topic facets |
| GET | `/api/v1/topics?locale=` | – | Active topics with localized names |
| GET | `/api/v1/trending?locale=&limit=` | – | Most-read stories of the last 48 h (time-decayed) |
| GET | `/api/v1/articles/:id/reaction` | optional | Reaction counts and the viewer's own reaction |
| PUT | `/api/v1/articles/:id/reaction` `{"reaction":"like"}` | anonymous ok | One reaction per reader (`like`, `insightful`, `surprising`, `sad`, `angry`) |
| DELETE | `/api/v1/articles/:id/reaction` | anonymous ok | Remove own reaction |
| POST | `/api/v1/articles/:id/view` | – | View beacon (counted once per IP and article per 10 min) |
| GET | `/api/v1/me/saved?locale=` | session | Reading list |
| PUT / DELETE | `/api/v1/me/saved/:id` | session | Add / remove from reading list |
| GET | `/api/v1/ads?placement=&locale=` | – | One creative for an ad placement, or `null` |
| POST | `/api/v1/auth/register` `{email, password, name?, locale?}` | – | Create account and sign in (password ≥ 10 chars) |
| POST | `/api/v1/auth/login` `{email, password}` | – | Sign in (rate-limited per IP and per account) |
| POST | `/api/v1/auth/logout` | session | Sign out |
| POST | `/api/v1/auth/password-reset` `{email}` | – | E-mails a one-hour reset link; always 202 |
| POST | `/api/v1/auth/password-reset/confirm` `{token, password}` | – | Set a new password; signs out all sessions |
| GET | `/api/v1/auth/google?next=/bg` | – | Sign in with Google (code + PKCE); 404 unless configured |
| GET | `/api/v1/me` | session | Current reader and followed topics/sources |
| PUT | `/api/v1/me/preferences` `{topics?: slug[], sourceIds?: uuid[]}` | session | Replace followed topics/sources |
| GET | `/api/v1/sources` | – | Outlets readers can follow |
| GET | `/api/v1/me/notifications` | session | `{emailDigest, pushDigest, pushUrgent}` |
| PUT | `/api/v1/me/notifications` | session | Change notification settings |
| GET | `/api/v1/push/vapid-public-key` | – | Public VAPID key (or `null` when push is not configured) |
| POST | `/api/v1/push/subscriptions` | session | Register this device's push subscription (https endpoints only) |
| DELETE | `/api/v1/push/subscriptions` `{endpoint}` | session | Remove this device |
| POST | `/api/v1/auth/token` `{email, password}` | – | Mobile sign-in: `{token, expiresAt, user}` (no cookie). Use `Authorization: Bearer <token>` |
| POST | `/api/v1/push/devices` `{token, platform}` | session | Register the app's Expo push token (`ios`/`android`) |
| DELETE | `/api/v1/push/devices` `{token}` | session | Remove it (sign-out, push off) |
| POST | `/api/v1/ads/:id/impression` | consent | Impression beacon (counted only with `nm_consent=all`) |
| GET | `/api/v1/ads/:id/click` | – | Redirect to the ad's stored URL; counts the click only with consent |
| GET | `/api/health` | – | 200 when database (and search, if configured) are reachable; 503 otherwise |

Conventions:

* `locale` is `bg` (default) or `en`. Article paths are `/<locale>/a/<id>/<slug>`.
* Errors: `{"error": {"code": "...", "message": "..."}}` with 400/401/403/404/429.
* Sessions: random 256-bit token in an `HttpOnly; SameSite=Lax` cookie (`Secure` on HTTPS), only its
  SHA-256 stored server-side, 30-day lifetime. Passwords are hashed with scrypt.
* Personalisation: a signed-in reader's feed lifts stories from followed topics and sources by 12 hours
  of recency (`personalized: true`); urgent stories always stay on top.
* State-changing requests must come from the site itself (Origin/Referer check) — CSRF protection
  for the cookie-based session. Anonymous reactions use a random `nm_aid` cookie.
* Simple per-IP rate limits apply to search, reactions and view beacons.

### Authentication for native clients

Every endpoint marked *session* also accepts `Authorization: Bearer <token>` from
`/api/v1/auth/token`; when the header is present, cookies are ignored. `POST /api/v1/auth/logout`
with the bearer header ends that session. Anonymous native clients may send a stable UUID in
`X-NM-Anon-Id` for reactions.
