#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "${ROOT_DIR}"

set -a
# shellcheck disable=SC1091
source .env.production
set +a

BACKUP_DIR="${ROOT_DIR}/backups/$(date +%Y%m%d-%H%M%S)"
mkdir -p "${BACKUP_DIR}"

docker compose -f docker-compose.prod.yml --env-file .env.production exec -T mongo \
  mongodump --archive --gzip --db "${DB_NAME:-digital_silat}" > "${BACKUP_DIR}/mongo.archive.gz"

docker compose -f docker-compose.prod.yml --env-file .env.production exec -T backend \
  tar -czf - -C /app/uploads . > "${BACKUP_DIR}/uploads.tar.gz"

echo "Backup dibuat di: ${BACKUP_DIR}"
