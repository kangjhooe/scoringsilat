#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "${ROOT_DIR}"

mkdir -p releases
OUT="releases/digital-silat-$(date +%Y%m%d-%H%M%S).tar.gz"

tar -czf "${OUT}" \
  --exclude='./frontend/node_modules' \
  --exclude='./frontend/build' \
  --exclude='./backend/.venv' \
  --exclude='./backend/uploads' \
  --exclude='./memory' \
  --exclude='./backups' \
  --exclude='./releases' \
  --exclude='./.env.production' \
  --exclude='./frontend/.env.local' \
  --exclude='./backend/.env' \
  --exclude='./.DS_Store' \
  .

echo "${OUT}"
