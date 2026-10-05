# Mobile app (Expo / React Native)

iOS and Android app for the platform. It talks to the public `/api/v1` with the shared contracts in
`packages/contracts`. Architecture notes: [docs/ARCHITECTURE.md](../../docs/ARCHITECTURE.md#mobile-app-appsmobile).

## Variants

| `APP_VARIANT` | EAS profile | API | Bundle id | Distribution |
| --- | --- | --- | --- | --- |
| development | `development` (simulator) / `development-device` | staging | `co.seweb.news.dev` | dev client |
| staging | `staging` | staging | `co.seweb.news.staging` | internal (ad hoc / APK) |
| production | `production` | production | `co.seweb.news` | App Store / Play Store |

Change the domains in `eas.json` and the bundle id prefix in `app.config.ts` before the first build.

## One-time setup (needs your accounts — cannot be automated)

1. **Expo account** — `npx eas-cli login`, then in this folder `npx eas-cli init` and copy the project
   id into the EAS environment variable `EAS_PROJECT_ID` (or into `extra.eas.projectId`).
2. **Staging gate** — set the same random value as `STAGING_APP_KEY` in the VPS edge `.env` and as EAS
   environment variable `EXPO_PUBLIC_STAGING_KEY` (environments: development, preview). Restart Caddy.
3. **iOS push (APNs)** — Apple Developer account. `npx eas-cli credentials -p ios` → create/upload
   an APNs key (.p8). EAS stores it; the server never sees it.
4. **Android push (FCM)** — create a Firebase project, add Android apps for the three package names,
   download `google-services.json` and upload it as EAS *file* environment variable
   `GOOGLE_SERVICES_JSON`. Upload an FCM V1 service-account key with
   `npx eas-cli credentials -p android` → *Google Service Account* → *FCM V1*.
5. **Optional** — enable *Enhanced push security* in the Expo dashboard and set the access token as
   `EXPO_ACCESS_TOKEN` in the VPS `app.env` (staging and production).
6. **CI** — add a GitHub secret `EXPO_TOKEN` (Expo → Access tokens). Without it `mobile.yml` skips.

## Run it

```bash
pnpm install                                       # from the repo root
cd apps/mobile
npx eas-cli build --profile development --platform ios      # simulator build, once
npx eas-cli build --profile development --platform android  # emulator/device APK, once
pnpm start                                         # Metro; open the dev build on the simulator
```

Point a dev build at your laptop instead of staging with
`EXPO_PUBLIC_API_URL=http://<LAN-IP>:3000 pnpm start`.

Checks: `pnpm --filter @nm/mobile typecheck`, `pnpm --filter @nm/mobile test`.

## Acceptance test: urgent approval → native push

Simulators cannot receive remote push; use a physical phone with a `development-device` or
`staging` build.

1. Make sure the test account's e-mail is in `NOTIFY_ALLOWLIST` on staging.
2. In the app: Account → sign in → allow notifications (toggle shows on).
3. On the VPS: `docker compose ... exec worker node cli.js test-push --email <you>` — the phone shows
   "Test".
4. In `/admin`, approve any published story as urgent → within seconds the phone shows
   "Breaking: …"; tapping it opens the story in the app.

## Release

`eas build --profile production` runs automatically on `main` (or via *Run workflow*). Submission
stays manual after you check the build: `npx eas-cli submit --profile production --platform ios|android`.
