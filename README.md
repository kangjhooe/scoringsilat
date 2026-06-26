# Silat Scoring — Aplikasi Penilaian Pencak Silat Digital

Aplikasi web real-time untuk penilaian pertandingan pencak silat berbasis web. Mendukung multiple arena, multi-peran (admin, operator, juri, wasit, ketua juri, timer), dan live scoreboard untuk layar publik.

## Stack

- **Backend:** Python FastAPI + Motor (MongoDB) + JWT + WebSocket
- **Frontend:** React (CRA + Craco) + Tailwind CSS + shadcn/ui
- **Database:** MongoDB 7
- **Deploy:** Docker Compose + Nginx + Cloudflare Tunnel

## Struktur Project

```
├── backend/            # FastAPI server (server.py)
│   ├── Dockerfile
│   ├── requirements.txt
│   ├── tests/
│   └── uploads/        # Upload foto atlet (user-generated)
├── frontend/           # React SPA
│   ├── Dockerfile
│   ├── src/
│   ├── deploy/         # Nginx config
│   └── public/
├── deploy/             # Script deployment & maintenance
│   ├── deploy.sh
│   ├── bootstrap-server.sh
│   ├── backup.sh / restore.sh
│   └── package-release.sh
├── docker-compose.prod.yml
└── .env.production.example
```

## Cara Deploy (Server Baru)

```bash
# 1. Clone repo
git clone <repo-url> /opt/digital-silat-main

# 2. Install Docker (jika belum)
cd /opt/digital-silat-main
sudo bash deploy/bootstrap-server.sh

# 3. Deploy aplikasi
bash deploy/deploy.sh
```

Lihat [DEPLOYMENT.md](DEPLOYMENT.md) untuk panduan lengkap.

## Development

```bash
# Backend
cd backend
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
python server.py

# Frontend
cd frontend
yarn install
yarn start
```

## Lisensi

Hak cipta milik SMK ISNU.
