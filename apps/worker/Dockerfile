# syntax=docker/dockerfile:1.7
# Background worker: ingestion, AI rewrite/translate, search sync, notifications.
# The same image runs database migrations (`node dist/migrate.js`) and the operator CLI.

FROM node:22-alpine AS base
RUN npm install -g pnpm@10.34.6
WORKDIR /repo

FROM base AS deps
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json .npmrc ./
# Every workspace manifest is needed for pnpm's frozen-lockfile check, even with --filter.
COPY apps/web/package.json apps/web/
COPY apps/worker/package.json apps/worker/
COPY apps/mobile/package.json apps/mobile/
COPY packages/ packages/
RUN --mount=type=cache,id=pnpm,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile --filter "@nm/worker..."

FROM deps AS build
COPY . .
RUN pnpm --filter @nm/worker build

FROM node:22-alpine AS runtime
ARG GIT_SHA=dev
ENV NODE_ENV=production GIT_SHA=${GIT_SHA} MIGRATIONS_DIR=/app/migrations
WORKDIR /app
RUN echo '{"type":"module","private":true}' > package.json \
    && npm install --omit=dev --no-audit --no-fund sharp@0.35.5 \
    && npm cache clean --force
COPY --from=build --chown=node:node /repo/apps/worker/dist ./dist
COPY --from=build --chown=node:node /repo/packages/db/migrations ./migrations
USER node
CMD ["node", "dist/index.js"]
