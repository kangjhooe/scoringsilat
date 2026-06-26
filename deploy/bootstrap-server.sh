#!/usr/bin/env bash
set -euo pipefail

if [[ "${EUID}" -ne 0 ]]; then
  echo "Jalankan sebagai root: sudo bash deploy/bootstrap-server.sh"
  exit 1
fi

if [[ ! -f /etc/os-release ]]; then
  echo "Tidak bisa membaca /etc/os-release. Script ini mendukung Ubuntu dan Debian."
  exit 1
fi

# shellcheck disable=SC1091
. /etc/os-release

case "${ID:-}" in
  ubuntu)
    DOCKER_OS="ubuntu"
    DOCKER_CODENAME="${UBUNTU_CODENAME:-${VERSION_CODENAME:-}}"
    ;;
  debian)
    DOCKER_OS="debian"
    DOCKER_CODENAME="${VERSION_CODENAME:-}"
    ;;
  *)
    if [[ " ${ID_LIKE:-} " == *" ubuntu "* ]]; then
      DOCKER_OS="ubuntu"
      DOCKER_CODENAME="${UBUNTU_CODENAME:-${VERSION_CODENAME:-}}"
    elif [[ " ${ID_LIKE:-} " == *" debian "* ]]; then
      DOCKER_OS="debian"
      DOCKER_CODENAME="${VERSION_CODENAME:-}"
    else
      echo "OS tidak didukung otomatis: ${PRETTY_NAME:-unknown}."
      echo "Gunakan Ubuntu 24 Server atau Debian 13, atau install Docker manual."
      exit 1
    fi
    ;;
esac

if [[ -z "${DOCKER_CODENAME}" ]]; then
  echo "Tidak bisa menentukan codename OS untuk repo Docker."
  exit 1
fi

apt-get update
apt-get install -y ca-certificates curl gnupg git openssl

if ! command -v docker >/dev/null 2>&1 || ! docker compose version >/dev/null 2>&1; then
  install -m 0755 -d /etc/apt/keyrings
  curl -fsSL "https://download.docker.com/linux/${DOCKER_OS}/gpg" | gpg --dearmor --yes -o /etc/apt/keyrings/docker.gpg
  chmod a+r /etc/apt/keyrings/docker.gpg

  echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/${DOCKER_OS} ${DOCKER_CODENAME} stable" > /etc/apt/sources.list.d/docker.list

  apt-get update
  apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
fi

systemctl enable --now docker

if [[ -n "${SUDO_USER:-}" && "${SUDO_USER}" != "root" ]]; then
  usermod -aG docker "${SUDO_USER}"
fi

echo "Docker siap:"
docker --version
docker compose version

if [[ -n "${SUDO_USER:-}" && "${SUDO_USER}" != "root" ]]; then
  echo
  echo "User ${SUDO_USER} sudah ditambahkan ke group docker."
  echo "Logout/login SSH atau jalankan: newgrp docker"
fi
