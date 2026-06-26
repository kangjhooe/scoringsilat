#!/usr/bin/env bash
set -euo pipefail

if [[ $# -ne 1 ]]; then
  echo "Usage: bash deploy/restore.sh backups/YYYYMMDD-HHMMSS"
  exit 1
fi

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "${ROOT_DIR}"

set -a
# shellcheck disable=SC1091
source .env.production
set +a

BACKUP_DIR="$1"
if [[ ! -f "${BACKUP_DIR}/mongo.archive.gz" ]]; then
  echo "File backup Mongo tidak ditemukan: ${BACKUP_DIR}/mongo.archive.gz"
  exit 1
fi

docker compose -f docker-compose.prod.yml --env-file .env.production exec -T mongo \
  mongorestore --archive --gzip --drop < "${BACKUP_DIR}/mongo.archive.gz"

if [[ -f "${BACKUP_DIR}/uploads.tar.gz" ]]; then
  docker compose -f docker-compose.prod.yml --env-file .env.production exec -T backend \
    sh -c "rm -rf /app/uploads/* && tar -xzf - -C /app/uploads" < "${BACKUP_DIR}/uploads.tar.gz"
fi

echo "Restore selesai."
