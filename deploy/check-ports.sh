#!/usr/bin/env bash
set -euo pipefail

START="${1:-18080}"
END="${2:-18120}"

echo "Cek port TCP listen dari ${START} sampai ${END}"
echo

for port in $(seq "${START}" "${END}"); do
  if command -v ss >/dev/null 2>&1; then
    if ss -ltn | awk '{print $4}' | grep -qE "[:.]${port}$"; then
      printf "%s busy\n" "${port}"
      continue
    fi
  elif command -v lsof >/dev/null 2>&1; then
    if lsof -nP -iTCP:"${port}" -sTCP:LISTEN >/dev/null 2>&1; then
      printf "%s busy\n" "${port}"
      continue
    fi
  else
    echo "Tidak menemukan ss atau lsof untuk cek port."
    exit 1
  fi

  printf "%s free  <-- rekomendasi\n" "${port}"
  exit 0
done

echo "Tidak ada port kosong di range ${START}-${END}."
exit 1
