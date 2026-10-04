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
| GET | `/api/health` | – | 200 when database (and search, if configured) are reachable; 503 otherwise |

Conventions:

* `locale` is `bg` (default) or `en`. Article paths are `/<locale>/a/<id>/<slug>`.
* Errors: `{"error": {"code": "...", "message": "..."}}` with 400/401/403/404/429.
* State-changing requests must come from the site itself (Origin/Referer check) — CSRF protection
  for the cookie-based session. Anonymous reactions use a random `nm_aid` cookie.
* Simple per-IP rate limits apply to search, reactions and view beacons.
