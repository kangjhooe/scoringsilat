# Deploy Silat Scoring ke Ubuntu 24 Server + Cloudflare Tunnel

Target domain: `silat.smkisnu.sch.id`

Stack production:
- `web`: Nginx, serve React build dan reverse proxy `/api` ke backend.
- `backend`: FastAPI/Uvicorn.
- `mongo`: MongoDB dengan volume persistent.
- Port lokal default untuk Cloudflare Tunnel: `127.0.0.1:18080`.
- Port `18080` sengaja dipakai agar tidak bentrok dengan app lain yang umum memakai `8080`, `3000`, atau `8000`.

## 1. Upload project ke server

Contoh dari komputer lokal:

```bash
rsync -av --delete \
  --exclude frontend/node_modules \
  --exclude frontend/build \
  --exclude backend/.venv \
  --exclude .env.production \
  /path/to/digital-silat-main/ user@SERVER_IP:/opt/digital-silat-main/
```

Atau clone/pull dari Git bila project sudah ada di repository.

Alternatif membuat arsip upload bersih:

```bash
bash deploy/package-release.sh
scp releases/digital-silat-YYYYMMDD-HHMMSS.tar.gz user@SERVER_IP:/opt/
ssh user@SERVER_IP
sudo mkdir -p /opt/digital-silat-main
sudo tar -xzf /opt/digital-silat-YYYYMMDD-HHMMSS.tar.gz -C /opt/digital-silat-main
sudo chown -R "$USER":"$USER" /opt/digital-silat-main
```

## 2. Install Docker di Ubuntu 24 Server

Di server:

```bash
cd /opt/digital-silat-main
sudo bash deploy/bootstrap-server.sh
```

CasaOS biasanya sudah membawa Docker. Script ini tetap aman: kalau Docker dan Docker Compose plugin sudah ada, dia hanya memastikan service Docker aktif. Script juga tetap mendukung Debian, tetapi untuk server sekarang gunakan perintah Ubuntu di atas.

Setelah bootstrap, bila user baru dimasukkan ke group Docker, logout/login SSH atau jalankan:

```bash
newgrp docker
```

## 3. Deploy aplikasi

```bash
cd /opt/digital-silat-main
bash deploy/deploy.sh
```

Saat pertama jalan, script membuat `.env.production`, membuat `JWT_SECRET`, dan membuat password admin awal random. Simpan password yang ditampilkan.

Edit `.env.production` bila perlu:

```env
PUBLIC_BACKEND_URL=https://silat.smkisnu.sch.id
WEB_BIND=127.0.0.1
WEB_PORT=18080
DB_NAME=digital_silat
ADMIN_EMAIL=admin@silat.id
ADMIN_PASSWORD=password-kuat
SEED_DEMO=false
```

`SEED_DEMO=false` membuat akun demo tidak ikut terpasang. Akun `operator@silat.id`, `juri1@silat.id`, dan akun sejenis dengan kata sandi `password123` hanya dibuat bila `SEED_DEMO=true`.

Kata sandi admin yang diganti lewat aplikasi tidak kembali saat backend di-restart. `ADMIN_PASSWORD` dipakai hanya saat akun admin belum ada. Untuk mengganti kata sandi admin yang sudah tersimpan, jalankan `bash deploy/reset-admin-password.sh`.

Lalu deploy ulang:

```bash
bash deploy/deploy.sh
```

## 4. Cloudflare Tunnel

Arahkan tunnel/public hostname:

```text
silat.smkisnu.sch.id -> http://127.0.0.1:18080
```

Gunakan `127.0.0.1:18080` kalau `cloudflared` berjalan langsung di host Ubuntu. Kalau `cloudflared` berjalan sebagai container/CasaOS app terpisah, ubah `.env.production` menjadi:

```env
WEB_BIND=0.0.0.0
WEB_PORT=18080
```

Lalu arahkan tunnel ke IP lokal server, misalnya:

```text
silat.smkisnu.sch.id -> http://192.168.1.10:18080
```

### Satu server dengan billing dan nugas

Setiap app harus punya port lokal berbeda. Contoh:

```text
billing.example.sch.id -> http://127.0.0.1:18081
nugas.example.sch.id   -> http://127.0.0.1:18082
silat.smkisnu.sch.id   -> http://127.0.0.1:18080
```

Untuk Silat, cukup pastikan `.env.production`:

```env
PUBLIC_BACKEND_URL=https://silat.smkisnu.sch.id
WEB_BIND=127.0.0.1
WEB_PORT=18080
```

Kalau `18080` sudah dipakai, cek port kosong:

```bash
bash deploy/check-ports.sh
```

Lalu ganti, misalnya:

```env
WEB_PORT=18083
```

dan sesuaikan Cloudflare Tunnel:

```text
silat.smkisnu.sch.id -> http://127.0.0.1:18083
```

Jika menggunakan config file `cloudflared`, contoh:

```yaml
tunnel: YOUR_TUNNEL_ID_OR_NAME
credentials-file: /root/.cloudflared/YOUR_TUNNEL_ID.json

ingress:
  - hostname: silat.smkisnu.sch.id
    service: http://127.0.0.1:18080
  - service: http_status:404
```

File contoh tersedia di `deploy/cloudflared-ingress.example.yml`.

Pastikan WebSocket aktif di Cloudflare. Nginx production sudah mem-proxy `Upgrade` header untuk live scoring.

## 5. Operasional

Lihat status:

```bash
docker compose -f docker-compose.prod.yml --env-file .env.production ps
```

Lihat log:

```bash
docker compose -f docker-compose.prod.yml --env-file .env.production logs -f
```

Restart:

```bash
docker compose -f docker-compose.prod.yml --env-file .env.production restart
```

Reset password admin. Script ini menulis kata sandi baru ke database. Restart saja tidak mengembalikan kata sandi yang sudah diganti di aplikasi:

```bash
bash deploy/reset-admin-password.sh
```

Update setelah upload kode baru:

```bash
bash deploy/deploy.sh
```

Backup:

```bash
bash deploy/backup.sh
```

Restore:

```bash
bash deploy/restore.sh backups/YYYYMMDD-HHMMSS
```
