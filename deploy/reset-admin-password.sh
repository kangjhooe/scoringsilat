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

echo "Menunggu backend siap..."
ready=0
for _ in $(seq 1 30); do
  if docker compose -f "${COMPOSE_FILE}" --env-file "${ENV_FILE}" exec -T backend \
    curl -fsS "http://localhost:8000/api/" >/dev/null; then
    ready=1
    break
  fi
  sleep 2
done
if [[ "${ready}" -ne 1 ]]; then
  echo "Backend belum siap. Password di .env.production sudah diubah, tetapi database belum diperbarui."
  exit 1
fi

echo "Menulis kata sandi baru ke database..."
docker compose -f "${COMPOSE_FILE}" --env-file "${ENV_FILE}" exec -T backend python - <<'PY'
import asyncio
import os
import bcrypt
from motor.motor_asyncio import AsyncIOMotorClient

async def main():
    email = os.environ.get("ADMIN_EMAIL", "admin@silat.id").strip()
    password = os.environ.get("ADMIN_PASSWORD", "")
    if len(password) < 8:
        raise SystemExit("ADMIN_PASSWORD terlalu pendek")
    client = AsyncIOMotorClient(os.environ["MONGO_URL"])
    try:
        database = client[os.environ["DB_NAME"]]
        hashed = bcrypt.hashpw(password.encode(), bcrypt.gensalt()).decode()
        result = await database.users.update_one({"email": email}, {"$set": {"password_hash": hashed}})
        if result.matched_count == 0 and email.lower() != email:
            result = await database.users.update_one({"email": email.lower()}, {"$set": {"password_hash": hashed}})
        if result.matched_count == 0:
            raise SystemExit(f"Akun admin {email} belum ada di database")
    finally:
        client.close()

asyncio.run(main())
PY

echo
echo "Password admin sudah direset."
echo "Login dengan:"
echo "Email   : ${ADMIN_EMAIL_INPUT}"
echo "Password: password yang baru dimasukkan"
