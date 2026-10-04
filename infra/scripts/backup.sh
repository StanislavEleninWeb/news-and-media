#!/usr/bin/env bash
# Nightly backup of one environment (database + media). Install on the VPS as the deploy user:
#   crontab -e
#   15 3 * * * /srv/newsmedia/production/backup.sh production >> /srv/newsmedia/production/backup.log 2>&1
# Optional off-site copy: set RCLONE_REMOTE (e.g. "b2:newsmedia-backups") and install rclone.
# The search index is not backed up — rebuild it with `cli reindex`.
set -euo pipefail

ENVIRONMENT="${1:?usage: backup.sh <staging|production>}"
APP_DIR="/srv/newsmedia/${ENVIRONMENT}"
KEEP_DAYS="${KEEP_DAYS:-14}"
cd "$APP_DIR"
set -a; . ./.env; set +a
BACKUP_DIR="${DATA_DIR}/backups"
STAMP="$(date -u +%Y%m%d-%H%M)"
mkdir -p "$BACKUP_DIR"

compose() { docker compose --project-name "newsmedia-${ENVIRONMENT}" --env-file .env -f app.yml "$@"; }

echo "==> database"
compose exec -T postgres pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" --format=custom --no-owner \
  > "${BACKUP_DIR}/db-${STAMP}.dump"

echo "==> media"
tar -C "${DATA_DIR}" -czf "${BACKUP_DIR}/media-${STAMP}.tar.gz" media

echo "==> retention (${KEEP_DAYS} days)"
find "$BACKUP_DIR" -type f \( -name 'db-*.dump' -o -name 'media-*.tar.gz' \) -mtime "+${KEEP_DAYS}" -delete

if [ -n "${RCLONE_REMOTE:-}" ]; then
  echo "==> off-site copy to ${RCLONE_REMOTE}"
  rclone copy "$BACKUP_DIR" "${RCLONE_REMOTE}/${ENVIRONMENT}" --include "*-${STAMP}*"
fi
echo "==> done: ${BACKUP_DIR}/db-${STAMP}.dump"
