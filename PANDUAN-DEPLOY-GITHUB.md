# Panduan Deploy Silat Scoring lewat GitHub

Target: satu server VPS (Ubuntu 24 atau Debian 13) yang menarik kode dari GitHub, lalu menjalankan aplikasi dengan Docker.

Dokumen operasional lain: [DEPLOYMENT.md](DEPLOYMENT.md) (Cloudflare Tunnel, backup, restore).

## Apakah sudah siap production?

Siap untuk **satu event di satu server**, asal checklist di bawah dikerjakan sebelum domain dibuka ke peserta.

Belum siap untuk:

- hosting berbagi (cPanel, hosting PHP biasa) — aplikasi ini butuh Python, MongoDB, WebSocket, dan Docker
- beberapa server backend sekaligus — skor live disimpan di memori satu proses
- dibuka publik tanpa mengubah akun bawaan

Yang sudah ada dan bisa dipakai:

- `docker-compose.prod.yml` menjalankan MongoDB, backend FastAPI, dan Nginx
- Nginx melayani React dan meneruskan `/api` plus WebSocket ke backend
- MongoDB tidak dibuka ke internet; datanya tersimpan di volume Docker
- `.env` dan `.env.production` tidak ikut ke Git
- `deploy/deploy.sh` membuat `JWT_SECRET` dan password admin acak pada deploy pertama
- skrip backup, restore, dan reset password admin ada di folder `deploy/`

Yang wajib diselesaikan sebelum event:

| Hal | Kenapa penting |
| --- | --- |
| Repo GitHub dibuat **private** | Kode, struktur API, dan alur login tidak perlu publik |
| `PUBLIC_BACKEND_URL` diisi URL HTTPS yang benar, lalu image di-build ulang | URL backend tertanam saat build frontend |
| Akun demo tidak ikut terpasang | `SEED_DEMO=false`. Akun `operator@silat.id`, `juri1@silat.id`, dan akun sejenis tidak dibuat saat backend start |
| Kata sandi admin yang diganti di aplikasi tetap tersimpan | Restart tidak menimpa hash. `ADMIN_PASSWORD` hanya dipakai bila akun itu belum ada. Lupa kata sandi: `bash deploy/reset-admin-password.sh` |
| HTTPS aktif | Login memakai JWT. Jangan buka aplikasi lewat HTTP di internet |
| Port `27017` tidak di-publish | MongoDB di compose ini belum memakai username/password |
| Satu replika backend | Menambah replika akan memecah skor live antar proses |

Spesifikasi VPS minimum untuk satu gelanggang sampai beberapa gelanggang dalam satu event: 2 vCPU, 4 GB RAM, 40 GB disk, Ubuntu 24.04. Naikkan ke 4 GB–8 GB jika banyak layar skor dan juri tersambung bersamaan.

## Alur singkat

```text
Komputer Anda  --git push-->  GitHub (private)
                                  |
                                  | git clone / git pull
                                  v
                          VPS Ubuntu + Docker
                          mongo + backend + nginx
                                  |
                                  v
                    Domain HTTPS (Cloudflare atau sertifikat)
```

## 1. Siapkan repositori GitHub

Di komputer (folder project `skoring-silat`):

```powershell
cd c:\xampp\htdocs\skoring-silat
git status
```

Pastikan file berikut **tidak** muncul sebagai file yang akan di-commit:

- `.env`
- `backend/.env`
- `frontend/.env`
- `.env.production`

File itu sudah masuk `.gitignore`. Yang boleh ikut ke Git adalah `.env.production.example`.

Buat repositori **private** di GitHub, lalu sambungkan:

```powershell
git remote add origin https://github.com/NAMA-AKUN/skoring-silat.git
git branch -M main
git push -u origin main
```

Jika `origin` sudah ada, cukup:

```powershell
git push -u origin main
```

Jangan mengunggah password, `JWT_SECRET`, atau file backup database.

## 2. Siapkan server

Masuk ke VPS lewat SSH:

```bash
ssh root@IP_SERVER
```

Pasang Docker setelah kode ada di server (langkah 3). User deploy sebaiknya bukan root harian. Contoh:

```bash
adduser deploy
usermod -aG sudo deploy
```

Lalu masuk sebagai user itu: `su - deploy`.

Buka hanya port yang dipakai:

- `22` untuk SSH
- `80` dan `443` jika domain mengarah langsung ke VPS
- jangan buka `27017`, `8000`, atau `18080` ke internet jika domain lewat Cloudflare Tunnel

## 3. Clone dari GitHub

Untuk repo private, di server buat SSH key lalu daftarkan sebagai **Deploy key** (read-only) di GitHub: Settings → Deploy keys.

```bash
ssh-keygen -t ed25519 -C "silat-server" -f ~/.ssh/id_ed25519 -N ""
cat ~/.ssh/id_ed25519.pub
```

Salin isi public key itu ke GitHub, kemudian:

```bash
sudo mkdir -p /opt/digital-silat-main
sudo chown "$USER":"$USER" /opt/digital-silat-main
git clone git@github.com:NAMA-AKUN/skoring-silat.git /opt/digital-silat-main
cd /opt/digital-silat-main
```

## 4. Pasang Docker dan deploy pertama

```bash
cd /opt/digital-silat-main
sudo bash deploy/bootstrap-server.sh
newgrp docker
bash deploy/deploy.sh
```

Deploy pertama membuat `.env.production`, mengisi `JWT_SECRET`, dan menampilkan password admin awal. Simpan password itu di tempat yang aman. Password ini tidak ada di GitHub.

Edit environment sebelum domain dipakai peserta:

```bash
nano .env.production
```

Isi minimal:

```env
PUBLIC_BACKEND_URL=https://silat.smkisnu.sch.id
WEB_BIND=127.0.0.1
WEB_PORT=18080

DB_NAME=digital_silat
JWT_SECRET=sudah-terisi-otomatis-jangan-diganti-sembarangan
ADMIN_EMAIL=admin@silat.id
ADMIN_PASSWORD=password-admin-yang-kuat
SEED_DEMO=false
```

`PUBLIC_BACKEND_URL` harus sama dengan URL yang dibuka pengguna, termasuk `https://`, tanpa garis miring di akhir.

Karena URL itu dipakai saat **build** frontend, setiap perubahan domain wajib diikuti deploy ulang:

```bash
bash deploy/deploy.sh
```

Cek service:

```bash
docker compose -f docker-compose.prod.yml --env-file .env.production ps
curl -fsS http://127.0.0.1:18080/api/
```

Respons health yang benar berbentuk JSON `{"service":"silat-scoring","status":"ok"}`.

## 5. Arahkan domain

Pilih salah satu.

### A. Cloudflare Tunnel

Cocok jika server berada di jaringan sekolah dan tidak punya IP publik.

Di `.env.production`:

```env
PUBLIC_BACKEND_URL=https://silat.smkisnu.sch.id
WEB_BIND=127.0.0.1
WEB_PORT=18080
```

Arahkan hostname:

```text
silat.smkisnu.sch.id -> http://127.0.0.1:18080
```

Jika `cloudflared` berjalan di container lain, bukan di host yang sama, gunakan `WEB_BIND=0.0.0.0` dan arahkan tunnel ke IP lokal server, misalnya `http://192.168.1.10:18080`.

Contoh ingress ada di `deploy/cloudflared-ingress.example.yml`. WebSocket harus tembus; konfigurasi Nginx production sudah meneruskan header `Upgrade`.

### B. Domain langsung ke IP VPS

1. Buat record DNS `A` dari subdomain ke IP publik VPS.
2. Biarkan aplikasi tetap di `127.0.0.1:18080`.
3. Pasang Nginx di host sebagai pintu `80/443`, lalu teruskan ke `http://127.0.0.1:18080`.
4. Pasang sertifikat (misalnya Certbot) untuk subdomain tersebut.

Jangan mengubah aplikasi agar listen `0.0.0.0:80` kalau di server yang sama sudah ada situs lain.

## 6. Sebelum dibuka ke peserta

1. Login sebagai admin dengan email dan password dari `.env.production`.
2. Kata sandi yang diganti lewat menu pengguna tetap dipakai setelah restart. `ADMIN_PASSWORD` tidak menimpa akun yang sudah ada. Bila kata sandi admin lupa, jalankan `bash deploy/reset-admin-password.sh`.
3. Buat akun juri, wasit, ketua juri, timer, dan operator dari menu admin. Kata sandi akun baru minimal 8 karakter.
4. Pastikan `.env.production` berisi `SEED_DEMO=false`. Akun demo tidak dibuat ulang saat restart. Akun demo yang sudah tersimpan dari pemasangan lama tetap bisa login sampai dihapus di menu pengguna.
5. Buat event sungguhan. Event "Kejuaraan Nasional Pencak Silat 2026 (Demo)" boleh dihapus dari panel admin.
6. Uji dari HP dan laptop: login, input skor juri, layar skor, timer, dan cetak PDF.
7. Uji bahwa dua juri di gelanggang yang sama melihat perubahan skor tanpa refresh.

## 7. Update berikutnya lewat GitHub

Di komputer, setelah perubahan selesai:

```powershell
git add .
git commit -m "jelaskan perubahan"
git push origin main
```

Di server:

```bash
cd /opt/digital-silat-main
git pull origin main
bash deploy/deploy.sh
```

`deploy.sh` membangun image lagi dan menyalakan container. Volume `mongo_data` dan `backend_uploads` tidak ikut terhapus, jadi data pertandingan dan foto atlet tetap ada.

Jangan menjalankan `docker compose down -v`. Flag `-v` menghapus database.

## 8. Operasional

Status dan log:

```bash
docker compose -f docker-compose.prod.yml --env-file .env.production ps
docker compose -f docker-compose.prod.yml --env-file .env.production logs -f backend
```

Backup database:

```bash
bash deploy/backup.sh
```

Salin folder backup keluar server secara berkala. Backup yang hanya ada di VPS ikut hilang jika disk server rusak.

Reset password admin ke nilai yang baru di `.env.production`:

```bash
bash deploy/reset-admin-password.sh
```

Cek port lokal yang kosong bila `18080` sudah dipakai aplikasi lain:

```bash
bash deploy/check-ports.sh
```

## 9. Masalah yang sering muncul

| Gejala | Penyebab yang paling sering |
| --- | --- |
| Halaman terbuka, API gagal / skor tidak live | `PUBLIC_BACKEND_URL` salah atau masih `http://localhost:8000`. Ubah `.env.production`, lalu `bash deploy/deploy.sh` |
| Login berhasil di HTTP, lalu gagal setelah pakai domain | Campuran `http` dan `https`, atau URL build lama |
| WebSocket putus | Proxy atau tunnel tidak meneruskan header `Upgrade` |
| Password admin kembali seperti semula | Restart tidak lagi menimpa kata sandi. Kalau reset terasa gagal, jalankan ulang `bash deploy/reset-admin-password.sh` dan pastikan script selesai tanpa error |
| Akun `juri1@silat.id` / `password123` bisa login | Akun itu sudah ada di database, atau `SEED_DEMO=true`. Hapus dari menu pengguna dan biarkan `SEED_DEMO=false` |
| `git pull` ditolak | Repo private belum punya deploy key, atau ada perubahan lokal di server. Jangan mengedit kode di server |
| Container `backend` tidak sehat | Mongo belum siap, atau `JWT_SECRET` / env tidak terbaca. Lihat log backend |

## Checklist go-live

- [ ] Repo GitHub private, tanpa file `.env`
- [ ] Server memakai Docker, aplikasi jalan lewat `docker compose ps`
- [ ] `https://domain-anda/api/` membalas status ok
- [ ] Login admin memakai kata sandi yang tersimpan. Nilai awal ada di `.env.production`, dan penggantian lewat aplikasi tidak kembali saat restart
- [ ] `SEED_DEMO=false`, dan akun demo yang sudah ada dihapus dari menu pengguna
- [ ] Event, gelanggang, dan akun petugas asli sudah dibuat
- [ ] Skor juri tampil di layar tanpa refresh
- [ ] Backup pertama sudah diunduh keluar server
