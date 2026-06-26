# PRD — Silat Scoring (Aplikasi Penilaian Pencak Silat)

## Original Problem Statement
Build a web-based real-time digital scoring application for pencak silat competition. Multi-role: admin, operator, referee, jury, head jury, timer, public display. Core modules: event/participant/match management, real-time scoring panel, referee decision panel, timer control, head jury validation, public scoreboard, match result approval, printable report. Use WebSocket for real-time, log all score inputs, allow score correction only by authorized users, scoring rules configurable from master data, support multiple arenas. UI in Bahasa Indonesia.

## User Choices
- Auth: JWT-based (email + password)
- Scoring: default IPSI, editable via master data
- Categories: Tanding + Seni (Tunggal, Ganda, Regu)
- Public display: Full visual (logo, animations, live stats)
- Print: Browser print + PDF (window.print pattern)

## Personas
- Admin: Setup event, master data, users
- Operator: Create/schedule matches
- Juri (3 orang): Input skor pukulan/tendangan/jatuhan
- Wasit: Pelanggaran, jatuhan, menang mutlak
- Ketua Juri: Validasi & pengesahan hasil
- Timer: Kontrol ronde
- Public: Tampilan layar besar

## Architecture
- Backend: FastAPI + Motor (MongoDB) + JWT (PyJWT + bcrypt). Single `server.py`.
- Realtime: WebSocket rooms `/api/ws/match/{id}` & `/api/ws/arena/{id}` with in-memory manager.
- Frontend: React (CRA + craco) + Tailwind + shadcn/ui + lucide + sonner. AuthContext stores JWT in localStorage as `silat_token`. WebSocket auto-reconnect helper.
- Design: Bebas Neue display font, Inter body, JetBrains Mono for digits. Dark theme. Red #ff3b30 / Blue #007aff / Accent #ffcc00.

## What's Been Implemented (2026-06-08)
- [x] JWT auth + 8 seeded users (1 admin, 1 operator, 3 jury, 1 referee, 1 head_jury, 1 timer)
- [x] Master Data CRUD: events (with `code` for numbering), categories (with `quota`), classes (with `quota`), contingents, athletes, arenas, scoring rules, users
- [x] Configurable scoring rules (points map + penalty_points map, editable from UI)
- [x] Match creation by admin/operator with athlete/arena/rule selection
- [x] Real-time scoring panel (jury): big tap buttons per corner
- [x] Referee panel: jatuhan, binaan, teguran/peringatan, menang mutlak
- [x] Timer panel: start, pause, reset, next round, end match
- [x] Head jury approval panel with method selection & notes
- [x] Score correction (invalidate log) by head jury
- [x] Live action log table with auto-refresh
- [x] Public display: arena selector + full broadcast scoreboard (logo, animated timer, per-round breakdown, winner reveal)
- [x] Printable match result report (browser print/PDF) — with event logo + athlete photos
- [x] WebSocket broadcast on every match update
- [x] Multi-arena concurrent (matches scoped by arena_id)
- [x] Bahasa Indonesia UI throughout
- [x] Local file upload for athlete photos & event logos (POST /api/uploads/photo)

## Phase 2 — Self-Registration & Selection (2026-06-08)
- [x] **Public registration page** `/register` (no auth) — choose event/kategori/kelas/kontingen, fill identity, upload 3 required docs (foto, KTP, surat sehat)
- [x] **Registration number** auto-generated `REG-{EVENT_CODE}-{NNN}` (atomic counter per event)
- [x] **Public status check** by registration number (with history timeline)
- [x] **Admin verification dashboard** `/admin/registrations` — Verifikasi & Seleksi tabs with count badges
- [x] **Status flow**: pending_verification → need_revision / verification_rejected / verified → selection_process → accepted / reserve / rejected → active_participant
- [x] **Quota enforcement** on `accepted` status (per class) — overflow forced to reserve/rejected
- [x] **Convert to active athlete**: copies registration into `athletes` collection with `source='self_registration'`, `registration_id`, `participant_number=PST-{CODE}-{NNN}`. Auto-creates contingent if not yet listed.
- [x] **Manual athletes still work** with `source='manual'`. Both sources usable for matches.
- [x] **WAHA WhatsApp config page** `/admin/whatsapp` — base_url, api_key, session, sender, templates, test-connection, manual send. Auto-send NOT wired (future).
- [x] **Public upload endpoint** for registration docs (image+PDF, 5MB max, no auth)
- [x] Documents stored in `registration_files` collection, linked to registration

## Phase 3 — Brackets & Seni Scoring UI (2026-06-08)
- [x] **Tournament Brackets UI** `/brackets` (admin/operator) — list brackets per event, create dialog (name, class, arena, scoring rule, size 2/4/8/16/32, auto-fill from active athletes)
- [x] **BracketView** `/brackets/:bid` — single-elimination tree visualization, slot assignment for draft brackets, Mulai Bracket starts round-1 matches, Cetak/PDF print, public-mode link
- [x] **Public Bracket** `/bracket/:bid/public` (no auth) — read-only tournament tree
- [x] **AppShell navigation** — new "Bracket" link visible to admin/operator
- [x] **Seni Scoring panel** `/seni/:mid` — Jury input (posisi, teknik 0–60, wirama 0–30, penghayatan 0–20) with sliders+number, real-time WS refresh, JuryScoreList for read-only roles, ScoreSummary, head-jury penalty panel (keluar gelanggang, waktu, kostum, tertahan, jatuh, lainnya), Finalisasi & Setujui flow, FinalizedBanner with print link
- [x] **MatchControl redirect** — matches with `discipline ∈ {tunggal, ganda, regu}` auto-route to /seni/:mid instead of the Tanding tabs
- [x] **Brackets advancement** (backend) — winner of a bracket match auto-populates the next slot; final winner sets `bracket.status=completed`

## Tested
- Iteration 4 — manual screenshot validation: admin /brackets page renders with event-select + empty-state; juri1 /seni/{mid} shows juri panel with sliders & submits (101.00 total); ketuajuri /seni/{mid} shows penalty panel + Finalisasi & Setujui button + jury score table.
- Iteration 2/3 carried over: backend 44/44 pass.

## Phase 4 — WAHA WhatsApp Auto-Send Hook (2026-06-08)
- [x] Refactored WAHA send into reusable `_waha_send_raw(phone, message)` + `_dispatch_registration_notification(reg, status)` helpers
- [x] Hooked auto-dispatch into `/api/registrations/{rid}/status` (verified, accepted, reserve, rejected, etc.)
- [x] Hooked auto-dispatch into `/api/registrations/{rid}/convert-to-athlete` (renders `{participant_number}` template)
- [x] Added new template key `active_participant` with default Indonesian message
- [x] Best-effort dispatch — never blocks the status change if WAHA is down
- [x] All dispatches logged to `db.waha_logs` (timestamp, phone, status, message, ok/error/skipped+reason)
- [x] New endpoint `GET /api/waha/logs?limit=N` (admin only)
- [x] Frontend WAHASettings page: Riwayat Pengiriman table (30 latest) with OK/GAGAL/SKIP badges + "Muat ulang" button
- [x] Phone normalization: `08xx → 62xx@c.us` for WAHA chatId format
- [x] Tested via curl: pending→verified→accepted→active_participant all logged correctly; failures recorded as ok=false; screenshot of new UI table confirmed

## Backlog (P1)
- Per-round duration override per match
- Per-judge agreement window (2 of 3 jury within X seconds → 1 valid point)
- Server-side PDF generation for archival
- Persistent volume / object storage for uploads
- Race-condition hardening: atomic quota check via unique compound index
- Statistik per atlet/kontingen, export Excel
- Bracket: drag-to-reorder slots, manual override of pairings, double-elimination option

## Backlog (P2)
- Bilingual toggle (ID/EN)
- Audio cues on round start/end
- Statistics dashboard per athlete/contingent
- Bracket auto-generation
- Export Excel of all results
- DialogDescription / aria-describedby polish
- Contingent dedupe via casefold

## Next tasks
- (Optional) Add automated pytest coverage for Bracket advancement + Seni finalize + WAHA hook flows
- (Optional) Drag-to-reorder slots in BracketView
- AdminDashboard tab stability re-verification (sempat di-skip oleh user)
- "Pembagian Medali" view — auto-aggregate juara 1/2/3 per kelas from completed brackets
