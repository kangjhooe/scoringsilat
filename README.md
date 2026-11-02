<p align="center">
  <img src="frontend/public/assets/silat-event-hero.png" alt="Silat Scoring" width="600"/>
</p>

<h1 align="center">Silat Scoring</h1>
<p align="center">
  Aplikasi Penilaian Pencak Silat Digital — Real-time, Multi-peran, Multi-gelanggang
</p>

<p align="center">
  <strong>SMK ISNU</strong>
</p>

---

## Fitur

- **Manajemen Event** — Kelola event, kategori, kelas, kontingen, atlet, dan gelanggang
- **Real-time Scoring** — Juri input skor via WebSocket, langsung tampil di layar
- **Multi-peran** — Admin, operator, juri (3 orang), wasit, ketua juri, timer
- **Live Scoreboard** — Tampilan publik untuk layar besar dengan animasi
- **Timer** — Kontrol ronde (start, pause, reset, next round)
- **Validasi Ketua Juri** — Pengesahan hasil dengan metode dan catatan
- **Cetak PDF** — Laporan hasil pertandingan siap cetak
- **Konfigurasi Aturan** — Poin pukulan/tendangan/jatuhan dan pelanggaran bisa diatur
- **Landing Page Event** — Halaman publik untuk informasi dan pendaftaran peserta

## Tech Stack

| Bagian     | Teknologi                                                                 |
|------------|---------------------------------------------------------------------------|
| Backend    | Python FastAPI, Motor (MongoDB), PyJWT, bcrypt, WebSocket                 |
| Frontend   | React 19, Craco, Tailwind CSS 3, shadcn/ui, Recharts, Framer Motion      |
| Database   | MongoDB 7                                                                 |
| Realtime   | WebSocket (in-memory room manager)                                        |
| Auth       | JWT (access token via localStorage)                                       |
| Deploy     | Docker Compose, Nginx, Cloudflare Tunnel                                  |

## Arsitektur

```
┌──────────────┐      ┌────────────────┐      ┌──────────────┐
│   Frontend   │──────│  Nginx (web)   │──────│   Backend    │
│  React SPA   │      │  :18080/80     │      │ FastAPI:8000 │
└──────────────┘      └────────────────┘      └──────┬───────┘
                                                      │
                                              ┌───────▼───────┐
                                              │    MongoDB    │
                                              │    :27017     │
                                              └───────────────┘
```

- Frontend di-serve Nginx, reverse proxy `/api/` ke backend
- Backend FastAPI + Uvicorn, REST + WebSocket
- MongoDB sebagai database utama
- Semua berjalan dalam Docker Compose

## Struktur Project

```
├── backend/                    # FastAPI server
│   ├── server.py               # App utama (REST + WebSocket)
│   ├── Dockerfile
│   ├── requirements.txt
│   ├── tests/
│   └── uploads/                # Upload foto atlet
├── frontend/                   # React SPA
│   ├── src/
│   │   ├── components/         # UI components + shadcn/ui
│   │   ├── pages/              # Halaman aplikasi
│   │   ├── contexts/           # AuthContext
│   │   ├── hooks/              # Custom hooks
│   │   ├── lib/                # API client, WebSocket, utils
│   │   └── constants/          # Test IDs
│   ├── deploy/
│   │   └── nginx.conf          # Nginx production config
│   ├── Dockerfile
│   └── package.json
├── deploy/                     # Script deployment & maintenance
│   ├── deploy.sh               # Build & deploy dengan Docker
│   ├── bootstrap-server.sh     # Install Docker di server baru
│   ├── backup.sh               # Backup database
│   ├── restore.sh              # Restore database
│   ├── reset-admin-password.sh # Reset password admin
│   ├── check-ports.sh          # Cek port tersedia
│   └── package-release.sh      # Buat arsip rilis
├── docker-compose.prod.yml     # Docker Compose produksi
├── DEPLOYMENT.md               # Panduan deploy lengkap
└── .env.production.example     # Template environment
```

## Cara Deploy (Produksi)

```bash
# Clone repo
git clone https://github.com/syahrullanw/skoring-silat.git /opt/digital-silat-main
cd /opt/digital-silat-main

# Install Docker (Ubuntu/Debian)
sudo bash deploy/bootstrap-server.sh

# Deploy aplikasi
bash deploy/deploy.sh
```

Deploy pertama akan membuat `.env.production`, generate `JWT_SECRET` dan password admin secara otomatis. Simpan password yang ditampilkan.

Lihat [DEPLOYMENT.md](DEPLOYMENT.md) untuk panduan lengkap (domain, Cloudflare Tunnel, backup, dll).

## Development

### Persyaratan
- Python 3.12+
- Node.js 22+
- MongoDB (local atau Docker)
- Yarn

### Backend

```bash
cd backend
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env   # sesuaikan konfigurasi
python server.py
```

Server berjalan di `http://localhost:8000`.

### Frontend

```bash
cd frontend
yarn install
yarn start
```

Aplikasi berjalan di `http://localhost:3002`.

### Seed Users

Saat pertama kali backend jalan tanpa database, user berikut dibuat otomatis:

| Email              | Password     | Role       |
|--------------------|--------------|------------|
| admin@silat.id     | admin123     | Admin      |
| operator@silat.id  | password123  | Operator   |
| juri1@silat.id     | password123  | Juri       |
| juri2@silat.id     | password123  | Juri       |
| juri3@silat.id     | password123  | Juri       |
| wasit@silat.id     | password123  | Wasit      |
| ketuajuri@silat.id | password123  | Ketua Juri |
| timer@silat.id     | password123  | Timer      |

## API Overview

- `GET/POST/PUT/DELETE /api/events` — CRUD event
- `GET/POST/PUT/DELETE /api/categories` — CRUD kategori
- `GET/POST/PUT/DELETE /api/classes` — CRUD kelas
- `GET/POST/PUT/DELETE /api/arenas` — CRUD gelanggang
- `GET/POST/PUT/DELETE /api/contingents` — CRUD kontingen
- `GET/POST/PUT/DELETE /api/athletes` — CRUD atlet
- `GET/POST/PUT/DELETE /api/scoring-rules` — CRUD aturan skor
- `POST /api/auth/login` — Login
- `GET /api/auth/me` — Profil user
- `WS /api/ws/match/{id}` — WebSocket scoring per pertandingan
- `WS /api/ws/arena/{id}` — WebSocket broadcast per gelanggang
- `GET /public/events` — Public event list
- `GET /public/events/{slug}` — Public event detail


