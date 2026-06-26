#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "${ROOT_DIR}"

ENV_FILE=".env.production"
COMPOSE_FILE="docker-compose.prod.yml"

if [[ ! -f "${ENV_FILE}" ]]; then
  echo "File ${ENV_FILE} belum ada."
  echo "Jalankan deploy pertama dulu: bash deploy/deploy.sh"
  exit 1
fi

if ! command -v docker >/dev/null 2>&1 || ! docker compose version >/dev/null 2>&1; then
  echo "Docker/Docker Compose belum tersedia."
  echo "Jalankan: sudo bash deploy/bootstrap-server.sh"
  exit 1
fi

if ! docker info >/dev/null 2>&1; then
  echo "User ini belum punya akses ke Docker."
  echo "Jalankan: newgrp docker"
  echo "Atau logout/login SSH, lalu ulangi script ini."
  exit 1
fi

read -r -p "Email admin [admin@silat.id]: " ADMIN_EMAIL_INPUT
ADMIN_EMAIL_INPUT="${ADMIN_EMAIL_INPUT:-admin@silat.id}"

if [[ ! "${ADMIN_EMAIL_INPUT}" =~ ^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$ ]]; then
  echo "Format email admin tidak valid."
  exit 1
fi

read -r -s -p "Password admin baru: " ADMIN_PASSWORD_INPUT
echo
read -r -s -p "Ulangi password admin baru: " ADMIN_PASSWORD_CONFIRM
echo

if [[ ! "${ADMIN_PASSWORD_INPUT}" =~ ^[A-Za-z0-9._@%-]{8,64}$ ]]; then
  echo "Password harus 8-64 karakter dan hanya boleh memakai huruf, angka, titik, underscore, @, %, atau minus."
  exit 1
fi

if [[ "${ADMIN_PASSWORD_INPUT}" != "${ADMIN_PASSWORD_CONFIRM}" ]]; then
  echo "Password tidak sama."
  exit 1
fi

update_env() {
  local key="$1"
  local value="$2"
  local tmp_file
  tmp_file="$(mktemp)"

  awk -v key="${key}" -v value="${value}" '
    BEGIN { found = 0 }
    $0 ~ "^" key "=" {
      print key "=" value
      found = 1
      next
    }
    { print }
    END {
      if (!found) {
        print key "=" value
      }
    }
  ' "${ENV_FILE}" > "${tmp_file}"

  mv "${tmp_file}" "${ENV_FILE}"
}

update_env "ADMIN_EMAIL" "${ADMIN_EMAIL_INPUT}"
update_env "ADMIN_PASSWORD" "${ADMIN_PASSWORD_INPUT}"

docker compose -f "${COMPOSE_FILE}" --env-file "${ENV_FILE}" up -d --force-recreate backend

echo
echo "Password admin sudah direset."
echo "Login dengan:"
echo "Email   : ${ADMIN_EMAIL_INPUT}"
echo "Password: password yang baru dimasukkan"
