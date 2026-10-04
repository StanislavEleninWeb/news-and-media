#!/usr/bin/env bash
# Restores a database backup into one environment. Stops web and worker during the restore.
#   ./restore.sh production /srv/newsmedia/production/data/backups/db-20261004-0315.dump
set -euo pipefail

ENVIRONMENT="${1:?usage: restore.sh <staging|production> <dump file>}"
DUMP="${2:?usage: restore.sh <staging|production> <dump file>}"
APP_DIR="/srv/newsmedia/${ENVIRONMENT}"
cd "$APP_DIR"
set -a; . ./.env; set +a
compose() { docker compose --project-name "newsmedia-${ENVIRONMENT}" --env-file .env -f app.yml "$@"; }

read -r -p "Restore ${DUMP} into ${ENVIRONMENT}? This replaces the current database. Type the environment name: " answer
[ "$answer" = "$ENVIRONMENT" ] || { echo "aborted"; exit 1; }

compose stop web worker
compose exec -T postgres pg_restore -U "$POSTGRES_USER" -d "$POSTGRES_DB" --clean --if-exists --no-owner < "$DUMP"
compose run --rm migrate
compose up -d web worker
compose run --rm worker node dist/cli.js reindex
echo "==> restored; search index rebuilt"
