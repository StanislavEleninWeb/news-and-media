#!/usr/bin/env bash
# Deploys one environment on the VPS. Called by GitHub Actions over SSH:
#   ./deploy.sh <staging|production> <image-tag>
# Rollback = run it again with the previous tag (see deployments.log).
set -euo pipefail

ENVIRONMENT="${1:?usage: deploy.sh <staging|production> <image-tag>}"
TAG="${2:?usage: deploy.sh <staging|production> <image-tag>}"
case "$ENVIRONMENT" in staging|production) ;; *) echo "unknown environment: $ENVIRONMENT" >&2; exit 2 ;; esac

APP_DIR="/srv/newsmedia/${ENVIRONMENT}"
cd "$APP_DIR"
export IMAGE_TAG="$TAG"
compose() { docker compose --project-name "newsmedia-${ENVIRONMENT}" --env-file .env -f app.yml "$@"; }

echo "==> pulling images ($TAG)"
compose pull web worker

echo "==> starting data services"
compose up -d postgres typesense

echo "==> applying database migrations"
compose run --rm migrate

echo "==> starting application"
compose up -d --remove-orphans web worker

echo "==> waiting for health check"
for _ in $(seq 1 45); do
  if compose exec -T web wget -qO- http://127.0.0.1:3000/api/health >/dev/null 2>&1; then
    echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) ${TAG}" >> deployments.log
    docker image prune -f >/dev/null
    echo "==> ${ENVIRONMENT} is running ${TAG}"
    exit 0
  fi
  sleep 2
done

echo "!! health check failed — previous tags are listed in ${APP_DIR}/deployments.log" >&2
compose logs --tail 80 web >&2 || true
exit 1
