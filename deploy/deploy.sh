#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "${ROOT_DIR}"

if ! command -v docker >/dev/null 2>&1; then
  echo "Docker belum terpasang. Jalankan: sudo bash deploy/bootstrap-server.sh"
  exit 1
fi

if ! docker compose version >/dev/null 2>&1; then
  echo "Docker Compose plugin belum tersedia. Jalankan: sudo bash deploy/bootstrap-server.sh"
  exit 1
fi

if ! docker info >/dev/null 2>&1; then
  echo "User ini belum punya akses ke Docker."
  echo "Jalankan: newgrp docker"
  echo "Atau logout/login SSH, lalu ulangi: bash deploy/deploy.sh"
  exit 1
fi

if [[ ! -f .env.production ]]; then
  cp .env.production.example .env.production
  SECRET="$(openssl rand -hex 32 2>/dev/null || date +%s | sha256sum | awk '{print $1}')"
  ADMIN_PASS="$(openssl rand -base64 18 2>/dev/null | tr -d '=+/' | cut -c1-18 || date +%s | sha256sum | cut -c1-18)"
  WEB_PORT_VALUE="$(
    for port in $(seq 18080 18120); do
      if command -v ss >/dev/null 2>&1; then
        ss -ltn | awk '{print $4}' | grep -qE "[:.]${port}$" && continue
      elif command -v lsof >/dev/null 2>&1; then
        lsof -nP -iTCP:"${port}" -sTCP:LISTEN >/dev/null 2>&1 && continue
      fi
      echo "${port}"
      break
    done
  )"
  WEB_PORT_VALUE="${WEB_PORT_VALUE:-18080}"
  sed -i "s|JWT_SECRET=.*|JWT_SECRET=${SECRET}|" .env.production
  sed -i "s|ADMIN_PASSWORD=.*|ADMIN_PASSWORD=${ADMIN_PASS}|" .env.production
  sed -i "s|WEB_PORT=.*|WEB_PORT=${WEB_PORT_VALUE}|" .env.production
  echo "File .env.production dibuat."
  echo "Password admin awal: ${ADMIN_PASS}"
  echo "Port lokal Silat: ${WEB_PORT_VALUE}"
  echo "Simpan password ini, lalu edit .env.production bila perlu sebelum deploy ulang."
fi

set -a
# shellcheck disable=SC1091
source .env.production
set +a

docker compose -f docker-compose.prod.yml --env-file .env.production build
docker compose -f docker-compose.prod.yml --env-file .env.production up -d

echo
echo "Deploy selesai."
echo "Service lokal untuk Cloudflare Tunnel: http://${WEB_BIND:-127.0.0.1}:${WEB_PORT:-18080}"
echo "Domain publik yang dikonfigurasi frontend: ${PUBLIC_BACKEND_URL}"
echo
docker compose -f docker-compose.prod.yml --env-file .env.production ps
