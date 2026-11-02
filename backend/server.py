from dotenv import load_dotenv
from pathlib import Path

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / ".env")

import os
import re
import uuid
import json
import logging
import asyncio
import bcrypt
import jwt
from datetime import datetime, timezone, timedelta
from typing import List, Optional, Dict, Any, Literal

from fastapi import FastAPI, APIRouter, HTTPException, Depends, Request, WebSocket, WebSocketDisconnect, status, UploadFile, File
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from fastapi.staticfiles import StaticFiles
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
from pymongo import ReturnDocument
from pydantic import BaseModel, Field, EmailStr, ConfigDict

# ============ Config ============
mongo_url = os.environ["MONGO_URL"]
db_name = os.environ["DB_NAME"]
JWT_SECRET = os.environ.get("JWT_SECRET", "dev-secret-change-me")
JWT_ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_HOURS = 24
ADMIN_EMAIL = os.environ.get("ADMIN_EMAIL", "admin@silat.id")
ADMIN_PASSWORD = os.environ.get("ADMIN_PASSWORD", "admin123")

client = AsyncIOMotorClient(mongo_url)
db = client[db_name]

UPLOAD_DIR = ROOT_DIR / "uploads"
UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
ALLOWED_IMAGE_EXT = {".png", ".jpg", ".jpeg", ".webp", ".gif"}
MAX_UPLOAD_BYTES = 5 * 1024 * 1024  # 5MB

app = FastAPI(title="Silat Scoring API")
api = APIRouter(prefix="/api")
security = HTTPBearer(auto_error=False)

logging.basicConfig(level=logging.INFO, format="%(asctime)s - %(name)s - %(levelname)s - %(message)s")
logger = logging.getLogger("silat")

# ============ Utilities ============
def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()

def new_id() -> str:
    return str(uuid.uuid4())

def hash_password(pw: str) -> str:
    return bcrypt.hashpw(pw.encode(), bcrypt.gensalt()).decode()

def verify_password(pw: str, hashed: str) -> bool:
    try:
        return bcrypt.checkpw(pw.encode(), hashed.encode())
    except Exception:
        return False

def create_token(user_id: str, role: str) -> str:
    payload = {
        "sub": user_id,
        "role": role,
        "exp": datetime.now(timezone.utc) + timedelta(hours=ACCESS_TOKEN_EXPIRE_HOURS),
        "iat": datetime.now(timezone.utc),
    }
    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALGORITHM)

def decode_token(token: str) -> Dict[str, Any]:
    return jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGORITHM])

VALID_ROLES = {"admin", "operator", "referee", "jury", "head_jury", "timer", "public"}

# ============ Models ============
class UserPublic(BaseModel):
    id: str
    email: str
    name: str
    role: str
    created_at: str

class RegisterIn(BaseModel):
    email: EmailStr
    password: str
    name: str
    role: str

class UserUpdateIn(BaseModel):
    email: Optional[EmailStr] = None
    password: Optional[str] = None
    name: Optional[str] = None
    role: Optional[str] = None

class LoginIn(BaseModel):
    email: EmailStr
    password: str

class EventIn(BaseModel):
    name: str
    code: str = ""  # e.g. "KEJURNAS" — used for participant_number formatting
    location: str = ""
    start_date: Optional[str] = None
    end_date: Optional[str] = None
    logo_url: str = ""
    status: str = "active"
    slug: str = ""
    landing_enabled: bool = True
    registration_enabled: bool = True
    landing_title: str = ""
    landing_subtitle: str = ""
    landing_description: str = ""
    landing_poster_url: str = ""
    landing_contact: str = ""
    landing_requirements: str = ""
    landing_schedule_note: str = ""

class CategoryIn(BaseModel):
    event_id: str
    name: str  # e.g. "Tanding Dewasa Putra"
    type: Literal["tanding", "tunggal", "ganda", "regu"] = "tanding"
    gender: Literal["putra", "putri", "campuran"] = "putra"
    age_group: str = "Dewasa"
    quota: int = 0  # 0 = unlimited; overflow registrations become reserve candidates

class ClassIn(BaseModel):
    event_id: str
    category_id: str
    name: str
    weight_min: float = 0
    weight_max: float = 0
    quota: int = 0

class ContingentIn(BaseModel):
    event_id: str
    name: str
    region: str = ""

class AthleteIn(BaseModel):
    event_id: str
    contingent_id: str
    class_id: Optional[str] = None
    category_id: Optional[str] = None
    name: str
    gender: Literal["putra", "putri"] = "putra"
    dob: Optional[str] = None
    weight: float = 0
    photo_url: str = ""
    phone: str = ""
    source: Literal["manual", "self_registration"] = "manual"
    registration_id: Optional[str] = None
    participant_number: str = ""
    status: Literal["active", "inactive"] = "active"

class ArenaIn(BaseModel):
    event_id: str
    name: str

class ScoringRuleIn(BaseModel):
    event_id: str
    name: str = "Aturan Standar IPSI"
    category_type: Literal["tanding", "tunggal", "ganda", "regu"] = "tanding"
    round_count: int = 3
    round_duration_sec: int = 120
    rest_duration_sec: int = 60
    points: Dict[str, int] = Field(default_factory=lambda: {"pukulan": 1, "tendangan": 2, "jatuhan": 3})
    penalty_points: Dict[str, int] = Field(default_factory=lambda: {"teguran_1": 1, "teguran_2": 2, "peringatan_1": 5, "peringatan_2": 10, "peringatan_3": 0})
    binaan_limit: int = 2
    is_default: bool = False

class MatchIn(BaseModel):
    event_id: str
    arena_id: str
    class_id: Optional[str] = None
    category_id: Optional[str] = None
    scoring_rule_id: str
    red_athlete_id: str
    blue_athlete_id: str = ""  # may be empty for Seni
    performer_ids: List[str] = Field(default_factory=list)  # for Seni Ganda/Regu (excl. red)
    discipline: Literal["tanding", "tunggal", "ganda", "regu"] = "tanding"
    match_number: int = 1
    scheduled_at: Optional[str] = None
    round_label: str = "Babak Penyisihan"
    bracket_id: Optional[str] = None
    bracket_slot_id: Optional[str] = None  # parent slot to advance winner into

class ScoreActionIn(BaseModel):
    corner: Literal["red", "blue"]
    action_type: Literal["score", "penalty", "fall", "binaan", "absolute_win"]
    code: str  # e.g., 'pukulan','tendangan','jatuhan','teguran_1','peringatan_1','binaan_1'
    points: int = 0
    notes: str = ""

class TimerActionIn(BaseModel):
    action: Literal["start", "pause", "resume", "reset", "next_round", "end_match"]

class ApproveIn(BaseModel):
    winner_corner: Optional[Literal["red", "blue", "draw"]] = None
    decision_method: str = "menang_angka"  # menang_angka | menang_mutlak | menang_teknik | menang_diskualifikasi | seri
    notes: str = ""

# ============ Bracket models ============
class BracketIn(BaseModel):
    event_id: str
    class_id: Optional[str] = None
    category_id: Optional[str] = None
    name: str = "Bracket"
    discipline: Literal["tanding", "tunggal", "ganda", "regu"] = "tanding"
    arena_id: str = ""
    scoring_rule_id: str = ""
    size: int = 8  # 4, 8, 16, 32 (next power of 2)
    auto_fill: bool = True  # auto-fill from active athletes in class

class BracketSlotAssignIn(BaseModel):
    athlete_id: Optional[str] = None  # null to clear

# ============ Seni scoring models ============
class SeniScoreIn(BaseModel):
    jury_position: int = Field(ge=1, le=9)
    teknik: float = Field(ge=50, le=60)
    wirama: float = Field(ge=25, le=30)
    penghayatan: float = Field(ge=15, le=20)

class SeniPenaltyIn(BaseModel):
    code: str  # 'keluar_gelanggang' | 'waktu' | 'kostum' | 'lainnya'
    value: float = Field(ge=0, le=100)
    notes: str = ""

# ============ Registration (Phase 2) models ============
# Status flow:
# draft -> pending_verification -> (need_revision | verification_rejected | verified)
# verified -> selection_process -> (accepted | reserve | rejected)
# accepted -> active_participant
REGISTRATION_STATUSES = {
    "draft",
    "pending_verification",
    "need_revision",
    "verification_rejected",
    "verified",
    "selection_process",
    "accepted",
    "reserve",
    "rejected",
    "active_participant",
}

class RegistrationIn(BaseModel):
    event_id: str
    category_id: Optional[str] = None
    class_id: Optional[str] = None
    contingent_id: Optional[str] = None
    contingent_name: str = ""  # free-form fallback if contingent not yet listed
    name: str
    gender: Literal["putra", "putri"] = "putra"
    dob: Optional[str] = None
    weight: float = 0
    phone: str = ""
    email: str = ""
    address: str = ""
    photo_url: str = ""

class RegistrationUpdateStatusIn(BaseModel):
    status: Literal[
        "pending_verification", "need_revision", "verification_rejected",
        "verified", "selection_process", "accepted", "reserve", "rejected", "active_participant"
    ]
    admin_notes: str = ""

class RegistrationFileIn(BaseModel):
    registration_id: str
    label: str  # "photo", "ktp", "surat_sehat", etc.
    url: str

class WAHAConfigIn(BaseModel):
    base_url: str = ""
    api_key: str = ""
    session: str = "default"
    sender_phone: str = ""
    enabled: bool = False
    templates: Dict[str, str] = Field(default_factory=lambda: {
        "verified": "Halo {name}, registrasi Anda untuk event {event_name} telah TERVERIFIKASI. Nomor registrasi: {registration_number}.",
        "need_revision": "Halo {name}, registrasi Anda untuk event {event_name} perlu direvisi. Catatan admin: {admin_notes}",
        "verification_rejected": "Halo {name}, registrasi Anda untuk event {event_name} DITOLAK. Catatan: {admin_notes}",
        "accepted": "Selamat {name}! Anda DITERIMA sebagai peserta event {event_name}. Nomor peserta: {participant_number}.",
        "reserve": "Halo {name}, status Anda adalah CADANGAN untuk event {event_name}. Mohon menunggu konfirmasi lebih lanjut.",
        "rejected": "Halo {name}, kami informasikan bahwa Anda belum diterima sebagai peserta event {event_name}. Terima kasih atas partisipasi Anda.",
        "active_participant": "Selamat {name}! Anda telah TERDAFTAR sebagai peserta aktif event {event_name} dengan nomor peserta {participant_number}. Selamat bertanding!",
    })

class WAHATestSendIn(BaseModel):
    phone: str
    message: str

# ============ Auth dependency ============
async def get_current_user(creds: Optional[HTTPAuthorizationCredentials] = Depends(security)) -> Dict[str, Any]:
    if not creds or not creds.credentials:
        raise HTTPException(status_code=401, detail="Tidak terautentikasi")
    try:
        payload = decode_token(creds.credentials)
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="Token kedaluwarsa")
    except jwt.InvalidTokenError:
        raise HTTPException(status_code=401, detail="Token tidak valid")
    user = await db.users.find_one({"id": payload["sub"]}, {"_id": 0, "password_hash": 0})
    if not user:
        raise HTTPException(status_code=401, detail="User tidak ditemukan")
    return user

def require_roles(*roles):
    async def dep(user: Dict[str, Any] = Depends(get_current_user)) -> Dict[str, Any]:
        if user["role"] not in roles and user["role"] != "admin":
            raise HTTPException(status_code=403, detail=f"Akses ditolak. Role yang diperlukan: {roles}")
        return user
    return dep

# ============ WebSocket Manager ============
class WSManager:
    def __init__(self):
        self.rooms: Dict[str, List[WebSocket]] = {}
        self.lock = asyncio.Lock()

    async def connect(self, room: str, ws: WebSocket):
        await ws.accept()
        async with self.lock:
            self.rooms.setdefault(room, []).append(ws)

    async def disconnect(self, room: str, ws: WebSocket):
        async with self.lock:
            if room in self.rooms and ws in self.rooms[room]:
                self.rooms[room].remove(ws)

    async def broadcast(self, room: str, message: Dict[str, Any]):
        text = json.dumps(message, default=str)
        async with self.lock:
            conns = list(self.rooms.get(room, []))
        for ws in conns:
            try:
                await ws.send_text(text)
            except Exception:
                pass

manager = WSManager()

# ============ Helpers: Match computation ============
JURY_CONSENSUS_WINDOW_SEC = 2
_consensus_locks: Dict[str, asyncio.Lock] = {}
_expire_task: Optional[asyncio.Task] = None


def _consensus_lock(match_id: str) -> asyncio.Lock:
    lock = _consensus_locks.get(match_id)
    if lock is None:
        lock = asyncio.Lock()
        _consensus_locks[match_id] = lock
    return lock


def _consume_timer(timer: Dict[str, Any], now: datetime) -> Dict[str, Any]:
    timer = dict(timer or {})
    if timer.get("running") and timer.get("started_at"):
        started = datetime.fromisoformat(timer["started_at"])
        if started.tzinfo is None:
            started = started.replace(tzinfo=timezone.utc)
        elapsed = (now - started).total_seconds()
        timer["remaining_sec"] = max(0, float(timer.get("remaining_sec") or 0) - elapsed)
        timer["running"] = False
        timer["started_at"] = None
    return timer


def _ensure_round(per_round: Dict[int, Dict[str, int]], rnd: Any) -> int:
    try:
        rnd = int(rnd or 1)
    except (TypeError, ValueError):
        rnd = 1
    if rnd < 1:
        rnd = 1
    if rnd not in per_round:
        per_round[rnd] = {"red": 0, "blue": 0}
    return rnd


async def compute_match_state(match_id: str) -> Dict[str, Any]:
    match = await db.matches.find_one({"id": match_id}, {"_id": 0})
    if not match:
        return {}
    logs = await db.score_logs.find({"match_id": match_id, "valid": True}, {"_id": 0}).sort("timestamp", 1).to_list(5000)
    rule = await db.scoring_rules.find_one({"id": match.get("scoring_rule_id")}, {"_id": 0}) or {}

    red = {"score": 0, "binaan": 0, "teguran": 0, "peringatan": 0}
    blue = {"score": 0, "binaan": 0, "teguran": 0, "peringatan": 0}
    round_count = max(1, int(rule.get("round_count") or 3))
    per_round = {r: {"red": 0, "blue": 0} for r in range(1, round_count + 1)}
    saved_winner = match.get("winner_corner")
    saved_method = match.get("decision_method")
    locked_result = match.get("status") in ("finished", "approved") and bool(saved_winner)

    for log in logs:
        c = log["corner"]
        target = red if c == "red" else blue
        rnd = _ensure_round(per_round, log.get("round", 1))
        if log["action_type"] in ("score", "fall"):
            pts = int(log.get("points", 0))
            target["score"] += pts
            per_round[rnd][c] += pts
        elif log["action_type"] == "penalty":
            opp = blue if c == "red" else red
            opp_corner = "blue" if c == "red" else "red"
            pts = int(log.get("points", 0))
            opp["score"] += pts
            per_round[rnd][opp_corner] += pts
            code = log.get("code", "")
            if code.startswith("teguran"):
                target["teguran"] += 1
            elif code.startswith("peringatan"):
                target["peringatan"] += 1
        elif log["action_type"] == "binaan":
            target["binaan"] += 1
        elif log["action_type"] == "absolute_win" and not locked_result:
            match["winner_corner"] = c
            match["decision_method"] = "menang_mutlak"

    if locked_result:
        match["winner_corner"] = saved_winner
        match["decision_method"] = saved_method

    window_start = (datetime.now(timezone.utc) - timedelta(seconds=JURY_CONSENSUS_WINDOW_SEC)).isoformat()
    pending_votes = await db.score_votes.find(
        {"match_id": match_id, "log_id": None, "timestamp": {"$gte": window_start}},
        {"_id": 0},
    ).to_list(50)

    out = dict(match)
    out["red"] = red
    out["blue"] = blue
    out["per_round"] = per_round
    out["rule"] = rule
    out["pending_votes"] = pending_votes
    return out


async def settle_expired_timer(match: Dict[str, Any]) -> Dict[str, Any]:
    """Persist a running timer that has reached 0 as paused. Returns the match to use afterwards."""
    if not match or match.get("status") != "in_progress":
        return match
    timer = match.get("timer") or {}
    if not timer.get("running") or not timer.get("started_at"):
        return match
    now = datetime.now(timezone.utc)
    try:
        started = datetime.fromisoformat(timer["started_at"])
        if started.tzinfo is None:
            started = started.replace(tzinfo=timezone.utc)
    except Exception:
        return match
    remaining = float(timer.get("remaining_sec") or 0) - (now - started).total_seconds()
    if remaining > 0:
        return match
    stopped = {"running": False, "remaining_sec": 0, "started_at": None, "round": timer.get("round", match.get("current_round", 1))}
    await db.matches.update_one({"id": match["id"]}, {"$set": {"timer": stopped, "status": "paused"}})
    updated = dict(match)
    updated["timer"] = stopped
    updated["status"] = "paused"
    return updated


async def _expire_running_matches_loop():
    while True:
        try:
            matches = await db.matches.find({"status": "in_progress", "timer.running": True}).to_list(200)
            for match in matches:
                updated = await settle_expired_timer(match)
                if updated.get("status") != match.get("status"):
                    await broadcast_match_update(match["id"], "timer_update")
        except Exception as e:
            logger.warning("timer expire loop: %s", e)
        await asyncio.sleep(1)


async def _load_match_settled(mid: str) -> Optional[Dict[str, Any]]:
    match = await db.matches.find_one({"id": mid})
    if not match:
        return None
    updated = await settle_expired_timer(match)
    if updated.get("status") != match.get("status"):
        await broadcast_match_update(mid, "timer_update")
    return updated


async def _finish_match_decision(match: Dict[str, Any], winner_corner: str, decision_method: str) -> None:
    now = datetime.now(timezone.utc)
    timer = _consume_timer(match.get("timer") or {}, now)
    await db.matches.update_one({"id": match["id"]}, {"$set": {
        "status": "finished",
        "winner_corner": winner_corner,
        "decision_method": decision_method,
        "finished_at": now.isoformat(),
        "timer": timer,
    }})

async def broadcast_match_update(match_id: str, event_type: str = "update"):
    state = await compute_match_state(match_id)
    if not state:
        return
    arena_id = state.get("arena_id")
    payload = {"type": event_type, "match_id": match_id, "state": state}
    if arena_id:
        await manager.broadcast(f"arena:{arena_id}", payload)
    await manager.broadcast(f"match:{match_id}", payload)

# ============ Routes: Auth ============
@api.post("/auth/login")
async def login(data: LoginIn):
    email = data.email.lower()
    user = await db.users.find_one({"email": email})
    if not user or not verify_password(data.password, user["password_hash"]):
        raise HTTPException(status_code=401, detail="Email atau kata sandi salah")
    token = create_token(user["id"], user["role"])
    return {
        "token": token,
        "user": {"id": user["id"], "email": user["email"], "name": user["name"], "role": user["role"], "created_at": user.get("created_at", "")},
    }

@api.post("/auth/register")
async def register(data: RegisterIn, current=Depends(get_current_user)):
    if current["role"] != "admin":
        raise HTTPException(status_code=403, detail="Hanya admin yang dapat membuat akun")
    if data.role not in VALID_ROLES:
        raise HTTPException(status_code=400, detail=f"Role tidak valid. Pilih dari: {VALID_ROLES}")
    email = data.email.lower()
    existing = await db.users.find_one({"email": email})
    if existing:
        raise HTTPException(status_code=400, detail="Email sudah terdaftar")
    user = {
        "id": new_id(),
        "email": email,
        "password_hash": hash_password(data.password),
        "name": data.name,
        "role": data.role,
        "created_at": now_iso(),
    }
    await db.users.insert_one(user)
    return {"id": user["id"], "email": user["email"], "name": user["name"], "role": user["role"], "created_at": user["created_at"]}

@api.get("/auth/me")
async def me(user=Depends(get_current_user)):
    return user

@api.get("/auth/users")
async def list_users(user=Depends(require_roles("admin"))):
    users = await db.users.find({}, {"_id": 0, "password_hash": 0}).sort("created_at", -1).to_list(500)
    return users

@api.delete("/auth/users/{user_id}")
async def delete_user(user_id: str, user=Depends(require_roles("admin"))):
    if user_id == user["id"]:
        raise HTTPException(status_code=400, detail="Tidak dapat menghapus akun sendiri")
    await db.users.delete_one({"id": user_id})
    return {"ok": True}

@api.put("/auth/users/{user_id}")
async def update_user(user_id: str, data: UserUpdateIn, user=Depends(require_roles("admin"))):
    target = await db.users.find_one({"id": user_id})
    if not target:
        raise HTTPException(404, "User tidak ditemukan")
    update: Dict[str, Any] = {}
    if data.name is not None:
        update["name"] = data.name
    if data.email is not None:
        email = data.email.lower()
        if email != target["email"]:
            dup = await db.users.find_one({"email": email})
            if dup:
                raise HTTPException(400, "Email sudah dipakai")
            update["email"] = email
    if data.role is not None:
        if data.role not in VALID_ROLES:
            raise HTTPException(400, f"Role tidak valid. Pilih dari: {VALID_ROLES}")
        update["role"] = data.role
    if data.password:
        update["password_hash"] = hash_password(data.password)
    if update:
        await db.users.update_one({"id": user_id}, {"$set": update})
    out = await db.users.find_one({"id": user_id}, {"_id": 0, "password_hash": 0})
    return out

# ============ Routes: File Uploads (local disk) ============
@api.post("/uploads/photo")
async def upload_photo(file: UploadFile = File(...), user=Depends(get_current_user)):
    if user["role"] not in ("admin", "operator"):
        raise HTTPException(403, "Hanya admin/operator yang dapat unggah foto")
    ext = Path(file.filename or "").suffix.lower()
    if ext not in ALLOWED_IMAGE_EXT:
        raise HTTPException(400, f"Format tidak didukung. Gunakan: {', '.join(sorted(ALLOWED_IMAGE_EXT))}")
    data = await file.read()
    if len(data) > MAX_UPLOAD_BYTES:
        raise HTTPException(400, f"Ukuran file melebihi {MAX_UPLOAD_BYTES // (1024*1024)}MB")
    if len(data) == 0:
        raise HTTPException(400, "File kosong")
    fname = f"{new_id()}{ext}"
    fpath = UPLOAD_DIR / fname
    with open(fpath, "wb") as f:
        f.write(data)
    return {"url": f"/api/uploads/{fname}", "filename": fname, "size": len(data)}

# Public upload — used by self-registration form (no auth). Allows images + PDF.
ALLOWED_DOC_EXT = ALLOWED_IMAGE_EXT | {".pdf"}

@api.post("/public/uploads/document")
async def public_upload_document(file: UploadFile = File(...)):
    ext = Path(file.filename or "").suffix.lower()
    if ext not in ALLOWED_DOC_EXT:
        raise HTTPException(400, f"Format tidak didukung. Gunakan: {', '.join(sorted(ALLOWED_DOC_EXT))}")
    data = await file.read()
    if len(data) > MAX_UPLOAD_BYTES:
        raise HTTPException(400, f"Ukuran file melebihi {MAX_UPLOAD_BYTES // (1024*1024)}MB")
    if len(data) == 0:
        raise HTTPException(400, "File kosong")
    fname = f"{new_id()}{ext}"
    fpath = UPLOAD_DIR / fname
    with open(fpath, "wb") as f:
        f.write(data)
    return {"url": f"/api/uploads/{fname}", "filename": fname, "size": len(data)}

# ============ Atomic counters (for registration_number, participant_number) ============
async def next_seq(key: str) -> int:
    doc = await db.counters.find_one_and_update(
        {"_id": key}, {"$inc": {"seq": 1}}, upsert=True, return_document=ReturnDocument.AFTER
    )
    return int(doc["seq"]) if doc else 1

def fmt_number(prefix: str, event_code: str, seq: int) -> str:
    code = (event_code or "EVENT").upper().replace(" ", "")
    return f"{prefix}-{code}-{seq:03d}"

def slugify(value: str) -> str:
    raw = (value or "").strip().lower()
    raw = re.sub(r"[^a-z0-9]+", "-", raw)
    raw = re.sub(r"-{2,}", "-", raw).strip("-")
    return raw or "event"

async def unique_event_slug(base: str, current_id: Optional[str] = None) -> str:
    stem = slugify(base)
    candidate = stem
    idx = 2
    while True:
        existing = await db.events.find_one({"slug": candidate}, {"id": 1})
        if not existing or existing.get("id") == current_id:
            return candidate
        candidate = f"{stem}-{idx}"
        idx += 1

def normalize_public_event(event: Dict[str, Any]) -> Dict[str, Any]:
    out = dict(event)
    out["slug"] = out.get("slug") or slugify(out.get("code") or out.get("name") or out.get("id") or "event")
    out["landing_enabled"] = out.get("landing_enabled", True)
    out["registration_enabled"] = out.get("registration_enabled", True)
    out["landing_title"] = out.get("landing_title") or out.get("name", "")
    out["landing_subtitle"] = out.get("landing_subtitle") or "Pendaftaran peserta pencak silat"
    out["landing_description"] = out.get("landing_description") or "Ikuti informasi event, kategori pertandingan, dan pendaftaran peserta melalui halaman resmi ini."
    out["landing_poster_url"] = out.get("landing_poster_url") or out.get("logo_url", "")
    out["landing_contact"] = out.get("landing_contact", "")
    out["landing_requirements"] = out.get("landing_requirements", "")
    out["landing_schedule_note"] = out.get("landing_schedule_note", "")
    return out

# ============ Generic CRUD helpers ============
async def list_collection(coll, query: Dict[str, Any] = None):
    q = query or {}
    return await coll.find(q, {"_id": 0}).to_list(2000)

# ============ Routes: Events ============
@api.post("/events")
async def create_event(data: EventIn, user=Depends(require_roles("admin"))):
    doc = data.model_dump()
    doc["slug"] = await unique_event_slug(doc.get("slug") or doc.get("code") or doc.get("name"))
    doc.update({"id": new_id(), "created_at": now_iso()})
    await db.events.insert_one(doc)
    # Auto-create default scoring rule
    rule = ScoringRuleIn(event_id=doc["id"], name="Aturan Standar IPSI", is_default=True).model_dump()
    rule.update({"id": new_id(), "created_at": now_iso()})
    await db.scoring_rules.insert_one(rule)
    doc.pop("_id", None)
    return doc

@api.get("/events")
async def list_events(user=Depends(get_current_user)):
    events = await db.events.find({}, {"_id": 0}).sort("created_at", -1).to_list(2000)
    return [normalize_public_event(e) for e in events]

@api.get("/events/{eid}")
async def get_event(eid: str, user=Depends(get_current_user)):
    e = await db.events.find_one({"id": eid}, {"_id": 0})
    if not e:
        raise HTTPException(404, "Event tidak ditemukan")
    return normalize_public_event(e)

@api.put("/events/{eid}")
async def update_event(eid: str, data: EventIn, user=Depends(require_roles("admin"))):
    existing = await db.events.find_one({"id": eid})
    if not existing:
        raise HTTPException(404, "Event tidak ditemukan")
    doc = data.model_dump()
    doc["slug"] = await unique_event_slug(doc.get("slug") or doc.get("code") or doc.get("name"), current_id=eid)
    await db.events.update_one({"id": eid}, {"$set": doc})
    updated = await db.events.find_one({"id": eid}, {"_id": 0})
    return normalize_public_event(updated)

@api.delete("/events/{eid}")
async def delete_event(eid: str, user=Depends(require_roles("admin"))):
    matches = await db.matches.find({"event_id": eid}, {"id": 1}).to_list(5000)
    match_ids = [m["id"] for m in matches]
    brackets = await db.brackets.find({"event_id": eid}, {"id": 1}).to_list(500)
    bracket_ids = [b["id"] for b in brackets]
    regs = await db.registrations.find({"event_id": eid}, {"id": 1}).to_list(10000)
    reg_ids = [r["id"] for r in regs]
    if match_ids:
        await db.score_logs.delete_many({"match_id": {"$in": match_ids}})
        await db.score_votes.delete_many({"match_id": {"$in": match_ids}})
        await db.seni_scores.delete_many({"match_id": {"$in": match_ids}})
        await db.seni_penalties.delete_many({"match_id": {"$in": match_ids}})
    if bracket_ids:
        await db.bracket_slots.delete_many({"bracket_id": {"$in": bracket_ids}})
    if reg_ids:
        await db.registration_files.delete_many({"registration_id": {"$in": reg_ids}})
    await db.matches.delete_many({"event_id": eid})
    await db.brackets.delete_many({"event_id": eid})
    await db.registrations.delete_many({"event_id": eid})
    await db.categories.delete_many({"event_id": eid})
    await db.classes.delete_many({"event_id": eid})
    await db.arenas.delete_many({"event_id": eid})
    await db.contingents.delete_many({"event_id": eid})
    await db.athletes.delete_many({"event_id": eid})
    await db.scoring_rules.delete_many({"event_id": eid})
    await db.events.delete_one({"id": eid})
    return {"ok": True}

# ============ Routes: Categories ============
@api.post("/categories")
async def create_category(data: CategoryIn, user=Depends(require_roles("admin"))):
    doc = data.model_dump()
    doc.update({"id": new_id(), "created_at": now_iso()})
    await db.categories.insert_one(doc)
    doc.pop("_id", None)
    return doc

@api.get("/categories")
async def list_categories(event_id: Optional[str] = None, user=Depends(get_current_user)):
    q = {"event_id": event_id} if event_id else {}
    return await list_collection(db.categories, q)

@api.delete("/categories/{cid}")
async def delete_category(cid: str, user=Depends(require_roles("admin"))):
    await db.categories.delete_one({"id": cid})
    return {"ok": True}

@api.put("/categories/{cid}")
async def update_category(cid: str, data: CategoryIn, user=Depends(require_roles("admin"))):
    await db.categories.update_one({"id": cid}, {"$set": data.model_dump()})
    return await db.categories.find_one({"id": cid}, {"_id": 0})

# ============ Routes: Classes ============
@api.post("/classes")
async def create_class(data: ClassIn, user=Depends(require_roles("admin"))):
    doc = data.model_dump()
    doc.update({"id": new_id(), "created_at": now_iso()})
    await db.classes.insert_one(doc)
    doc.pop("_id", None)
    return doc

@api.get("/classes")
async def list_classes(event_id: Optional[str] = None, user=Depends(get_current_user)):
    q = {"event_id": event_id} if event_id else {}
    return await list_collection(db.classes, q)

@api.delete("/classes/{cid}")
async def delete_class(cid: str, user=Depends(require_roles("admin"))):
    await db.classes.delete_one({"id": cid})
    return {"ok": True}

@api.put("/classes/{cid}")
async def update_class(cid: str, data: ClassIn, user=Depends(require_roles("admin"))):
    await db.classes.update_one({"id": cid}, {"$set": data.model_dump()})
    return await db.classes.find_one({"id": cid}, {"_id": 0})

# ============ Routes: Contingents ============
@api.post("/contingents")
async def create_contingent(data: ContingentIn, user=Depends(require_roles("admin"))):
    doc = data.model_dump()
    doc.update({"id": new_id(), "created_at": now_iso()})
    await db.contingents.insert_one(doc)
    doc.pop("_id", None)
    return doc

@api.get("/contingents")
async def list_contingents(event_id: Optional[str] = None, user=Depends(get_current_user)):
    q = {"event_id": event_id} if event_id else {}
    return await list_collection(db.contingents, q)

@api.delete("/contingents/{cid}")
async def delete_contingent(cid: str, user=Depends(require_roles("admin"))):
    await db.contingents.delete_one({"id": cid})
    return {"ok": True}

@api.put("/contingents/{cid}")
async def update_contingent(cid: str, data: ContingentIn, user=Depends(require_roles("admin"))):
    await db.contingents.update_one({"id": cid}, {"$set": data.model_dump()})
    return await db.contingents.find_one({"id": cid}, {"_id": 0})

# ============ Routes: Athletes ============
@api.post("/athletes")
async def create_athlete(data: AthleteIn, user=Depends(require_roles("admin"))):
    doc = data.model_dump()
    doc.update({"id": new_id(), "created_at": now_iso()})
    # Auto-assign participant_number for manually created athletes if empty
    if not doc.get("participant_number"):
        ev = await db.events.find_one({"id": doc["event_id"]}, {"code": 1, "name": 1})
        code = (ev or {}).get("code") or (ev or {}).get("name") or "EVENT"
        seq = await next_seq(f"participant:{doc['event_id']}")
        doc["participant_number"] = fmt_number("PST", code, seq)
    await db.athletes.insert_one(doc)
    doc.pop("_id", None)
    return doc

@api.get("/athletes")
async def list_athletes(event_id: Optional[str] = None, user=Depends(get_current_user)):
    q = {"event_id": event_id} if event_id else {}
    return await list_collection(db.athletes, q)

@api.delete("/athletes/{aid}")
async def delete_athlete(aid: str, user=Depends(require_roles("admin"))):
    await db.athletes.delete_one({"id": aid})
    return {"ok": True}

@api.put("/athletes/{aid}")
async def update_athlete(aid: str, data: AthleteIn, user=Depends(require_roles("admin"))):
    existing = await db.athletes.find_one({"id": aid}, {"_id": 1})
    if not existing:
        raise HTTPException(404, "Atlet tidak ditemukan")
    updates = data.model_dump(exclude_unset=True)
    if updates:
        await db.athletes.update_one({"id": aid}, {"$set": updates})
    return await db.athletes.find_one({"id": aid}, {"_id": 0})

# ============ Routes: Registrations (Phase 2) ============
async def _hydrate_registration(reg: Dict[str, Any]) -> Dict[str, Any]:
    files = await db.registration_files.find({"registration_id": reg["id"]}, {"_id": 0}).to_list(50)
    reg["files"] = files
    return reg

@api.post("/public/registrations")
async def public_create_registration(data: RegistrationIn):
    # Validate event exists and is active for registration
    ev = await db.events.find_one({"id": data.event_id}, {"_id": 0})
    if not ev:
        raise HTTPException(404, "Event tidak ditemukan")
    if ev.get("status") not in ("active", "registration_open"):
        # Allow by default; admin closes by setting status to "closed"
        if ev.get("status") == "closed":
            raise HTTPException(400, "Pendaftaran event ini sudah ditutup")
    if ev.get("registration_enabled") is False:
        raise HTTPException(400, "Pendaftaran event ini belum dibuka")
    seq = await next_seq(f"registration:{data.event_id}")
    reg_number = fmt_number("REG", ev.get("code") or ev.get("name") or "EVENT", seq)
    doc = data.model_dump()
    doc.update({
        "id": new_id(),
        "registration_number": reg_number,
        "status": "pending_verification",
        "admin_notes": "",
        "history": [{"status": "pending_verification", "at": now_iso(), "by": "public"}],
        "created_at": now_iso(),
        "updated_at": now_iso(),
    })
    await db.registrations.insert_one(doc)
    doc.pop("_id", None)
    return doc

@api.post("/public/registrations/{rid}/files")
async def public_attach_file(rid: str, data: RegistrationFileIn):
    reg = await db.registrations.find_one({"id": rid})
    if not reg:
        raise HTTPException(404, "Registrasi tidak ditemukan")
    rec = {"id": new_id(), "registration_id": rid, "label": data.label, "url": data.url, "uploaded_at": now_iso()}
    await db.registration_files.insert_one(rec)
    rec.pop("_id", None)
    return rec

@api.get("/public/registrations/{rid}")
async def public_get_registration(rid: str):
    """Public status check by registration ID."""
    reg = await db.registrations.find_one({"id": rid}, {"_id": 0, "admin_notes": 0})
    if not reg:
        raise HTTPException(404, "Registrasi tidak ditemukan")
    return await _hydrate_registration(reg)

@api.get("/public/registrations/by-number/{number}")
async def public_get_registration_by_number(number: str):
    reg = await db.registrations.find_one({"registration_number": number}, {"_id": 0, "admin_notes": 0})
    if not reg:
        raise HTTPException(404, "Registrasi tidak ditemukan")
    return await _hydrate_registration(reg)

@api.get("/registrations")
async def list_registrations(
    event_id: Optional[str] = None,
    status_filter: Optional[str] = None,
    user=Depends(require_roles("admin", "operator")),
):
    q: Dict[str, Any] = {}
    if event_id: q["event_id"] = event_id
    if status_filter:
        statuses = [s.strip() for s in status_filter.split(",") if s.strip()]
        if statuses:
            q["status"] = {"$in": statuses}
    regs = await db.registrations.find(q, {"_id": 0}).sort("created_at", -1).to_list(5000)
    for r in regs:
        await _hydrate_registration(r)
    return regs

@api.get("/registrations/{rid}")
async def get_registration(rid: str, user=Depends(require_roles("admin", "operator"))):
    reg = await db.registrations.find_one({"id": rid}, {"_id": 0})
    if not reg:
        raise HTTPException(404, "Registrasi tidak ditemukan")
    return await _hydrate_registration(reg)

@api.put("/registrations/{rid}")
async def update_registration(rid: str, data: RegistrationIn, user=Depends(require_roles("admin", "operator"))):
    await db.registrations.update_one({"id": rid}, {"$set": {**data.model_dump(), "updated_at": now_iso()}})
    reg = await db.registrations.find_one({"id": rid}, {"_id": 0})
    return await _hydrate_registration(reg)

@api.delete("/registrations/{rid}")
async def delete_registration(rid: str, user=Depends(require_roles("admin"))):
    await db.registrations.delete_one({"id": rid})
    await db.registration_files.delete_many({"registration_id": rid})
    return {"ok": True}

@api.delete("/registrations/{rid}/files/{fid}")
async def delete_registration_file(rid: str, fid: str, user=Depends(require_roles("admin", "operator"))):
    await db.registration_files.delete_one({"id": fid, "registration_id": rid})
    return {"ok": True}

async def _assert_acceptance_quota(reg: Dict[str, Any], rid: str) -> None:
    """Reject when the class or category quota for accepted participants is already full."""
    occupied = {"event_id": reg["event_id"], "status": {"$in": ["accepted", "active_participant"]}, "id": {"$ne": rid}}
    if reg.get("class_id"):
        cls = await db.classes.find_one({"id": reg["class_id"]}, {"quota": 1})
        quota = int((cls or {}).get("quota") or 0)
        if quota > 0:
            count = await db.registrations.count_documents({**occupied, "class_id": reg["class_id"]})
            if count >= quota:
                raise HTTPException(400, f"Kuota kelas penuh ({count}/{quota}). Jadikan cadangan atau tolak.")
    if reg.get("category_id"):
        cat = await db.categories.find_one({"id": reg["category_id"]}, {"quota": 1})
        quota = int((cat or {}).get("quota") or 0)
        if quota > 0:
            count = await db.registrations.count_documents({**occupied, "category_id": reg["category_id"]})
            if count >= quota:
                raise HTTPException(400, f"Kuota kategori penuh ({count}/{quota}). Jadikan cadangan atau tolak.")

@api.post("/registrations/{rid}/status")
async def update_registration_status(rid: str, data: RegistrationUpdateStatusIn, user=Depends(require_roles("admin", "operator"))):
    reg = await db.registrations.find_one({"id": rid})
    if not reg:
        raise HTTPException(404, "Registrasi tidak ditemukan")
    if data.status == "accepted":
        await _assert_acceptance_quota(reg, rid)
    history_entry = {"status": data.status, "at": now_iso(), "by": user["id"], "notes": data.admin_notes}
    update = {
        "$set": {"status": data.status, "admin_notes": data.admin_notes, "updated_at": now_iso()},
        "$push": {"history": history_entry},
    }
    await db.registrations.update_one({"id": rid}, update)
    fresh = await db.registrations.find_one({"id": rid}, {"_id": 0})
    # Best-effort WhatsApp notification (skipped if WAHA disabled or no template)
    try:
        await _dispatch_registration_notification(fresh, data.status)
    except Exception as e:
        print(f"[waha] notification dispatch failed for reg {rid}: {e}")
    return await _hydrate_registration(fresh)

@api.post("/registrations/{rid}/convert-to-athlete")
async def convert_to_athlete(rid: str, user=Depends(require_roles("admin", "operator"))):
    """Convert an accepted/reserve registration into an active participant in `athletes` collection.
    The registration must already be in 'accepted' status (or admin override).
    """
    reg = await db.registrations.find_one({"id": rid})
    if not reg:
        raise HTTPException(404, "Registrasi tidak ditemukan")
    if reg.get("status") not in ("accepted", "reserve"):
        raise HTTPException(400, "Hanya registrasi dengan status diterima yang dapat dijadikan peserta aktif")
    if reg.get("status") == "reserve":
        await _assert_acceptance_quota(reg, rid)
    # Resolve or create contingent if only name given
    contingent_id = reg.get("contingent_id")
    if not contingent_id and reg.get("contingent_name"):
        existing = await db.contingents.find_one({"event_id": reg["event_id"], "name": reg["contingent_name"]})
        if existing:
            contingent_id = existing["id"]
        else:
            new_cont = {
                "id": new_id(),
                "event_id": reg["event_id"],
                "name": reg["contingent_name"],
                "region": "",
                "created_at": now_iso(),
            }
            await db.contingents.insert_one(new_cont)
            contingent_id = new_cont["id"]
    if not contingent_id:
        raise HTTPException(400, "Kontingen registrasi tidak valid")
    ev = await db.events.find_one({"id": reg["event_id"]}, {"code": 1, "name": 1})
    code = (ev or {}).get("code") or (ev or {}).get("name") or "EVENT"
    seq = await next_seq(f"participant:{reg['event_id']}")
    pnum = fmt_number("PST", code, seq)
    athlete = {
        "id": new_id(),
        "event_id": reg["event_id"],
        "contingent_id": contingent_id,
        "class_id": reg.get("class_id"),
        "category_id": reg.get("category_id"),
        "name": reg["name"],
        "gender": reg.get("gender", "putra"),
        "dob": reg.get("dob"),
        "weight": float(reg.get("weight") or 0),
        "photo_url": reg.get("photo_url", ""),
        "phone": reg.get("phone", ""),
        "source": "self_registration",
        "registration_id": rid,
        "participant_number": pnum,
        "status": "active",
        "created_at": now_iso(),
    }
    await db.athletes.insert_one(athlete)
    # Mark registration as active_participant + record participant_number link
    history_entry = {"status": "active_participant", "at": now_iso(), "by": user["id"], "notes": f"Dikonversi ke peserta aktif {pnum}"}
    await db.registrations.update_one({"id": rid}, {
        "$set": {"status": "active_participant", "athlete_id": athlete["id"], "participant_number": pnum, "updated_at": now_iso()},
        "$push": {"history": history_entry},
    })
    athlete.pop("_id", None)
    # Best-effort WhatsApp notification when becoming active participant
    try:
        fresh_reg = await db.registrations.find_one({"id": rid}, {"_id": 0})
        await _dispatch_registration_notification(fresh_reg, "active_participant")
    except Exception as e:
        print(f"[waha] notification dispatch failed on convert {rid}: {e}")
    return {"athlete": athlete, "registration_number": reg.get("registration_number"), "participant_number": pnum}

# ============ Routes: WAHA WhatsApp Config (Phase 2 — structure only) ============
async def _get_waha_config() -> Dict[str, Any]:
    cfg = await db.waha_config.find_one({"_id": "config"}, {"_id": 0})
    if not cfg:
        cfg = WAHAConfigIn().model_dump()
    return cfg


def _normalize_phone_to_chatid(phone: str) -> str:
    digits = "".join(ch for ch in (phone or "") if ch.isdigit())
    if not digits:
        return ""
    if digits.startswith("0"):
        digits = "62" + digits[1:]
    elif digits.startswith("8"):
        digits = "62" + digits
    return f"{digits}@c.us"


async def _waha_send_raw(phone: str, message: str, cfg: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    """Low-level WAHA sender. Returns {ok, ...}. Never raises."""
    import httpx
    try:
        if cfg is None:
            cfg = await _get_waha_config()
        if not cfg.get("enabled"):
            return {"ok": False, "skipped": True, "reason": "waha_disabled"}
        if not cfg.get("base_url"):
            return {"ok": False, "skipped": True, "reason": "waha_no_base_url"}
        chat_id = _normalize_phone_to_chatid(phone)
        if not chat_id:
            return {"ok": False, "skipped": True, "reason": "invalid_phone"}
        url = f"{cfg['base_url'].rstrip('/')}/api/sendText"
        headers = {"Content-Type": "application/json"}
        if cfg.get("api_key"):
            headers["X-Api-Key"] = cfg["api_key"]
        payload = {"session": cfg.get("session") or "default", "chatId": chat_id, "text": message}
        async with httpx.AsyncClient(timeout=15.0) as client:
            r = await client.post(url, json=payload, headers=headers)
        return {"ok": r.status_code < 400, "status_code": r.status_code, "chat_id": chat_id}
    except Exception as e:
        return {"ok": False, "error": str(e)}


def _render_template(tpl: str, ctx: Dict[str, Any]) -> str:
    out = tpl or ""
    for k, v in (ctx or {}).items():
        out = out.replace("{" + k + "}", str(v if v is not None else ""))
    return out


async def _dispatch_registration_notification(reg: Dict[str, Any], reg_status: str, extra_ctx: Optional[Dict[str, Any]] = None) -> None:
    """Best-effort WhatsApp notification on registration status change. Logs to db.waha_logs."""
    cfg = await _get_waha_config()
    log_entry = {
        "id": new_id(),
        "registration_id": reg.get("id"),
        "phone": reg.get("phone", ""),
        "status": reg_status,
        "at": now_iso(),
    }
    if not cfg.get("enabled"):
        log_entry.update({"ok": False, "skipped": True, "reason": "waha_disabled"})
        await db.waha_logs.insert_one(log_entry)
        return
    tpl = (cfg.get("templates") or {}).get(reg_status)
    if not tpl:
        log_entry.update({"ok": False, "skipped": True, "reason": "no_template"})
        await db.waha_logs.insert_one(log_entry)
        return
    # Build context
    ev = await db.events.find_one({"id": reg.get("event_id")}, {"name": 1}) or {}
    ctx = {
        "name": reg.get("name", ""),
        "event_name": ev.get("name", ""),
        "registration_number": reg.get("registration_number", ""),
        "participant_number": reg.get("participant_number", ""),
        "admin_notes": reg.get("admin_notes", ""),
    }
    if extra_ctx:
        ctx.update(extra_ctx)
    message = _render_template(tpl, ctx)
    log_entry["message"] = message
    result = await _waha_send_raw(reg.get("phone", ""), message, cfg=cfg)
    log_entry.update(result)
    await db.waha_logs.insert_one(log_entry)


@api.get("/waha/config")
async def get_waha_config(user=Depends(require_roles("admin"))):
    return await _get_waha_config()

@api.put("/waha/config")
async def set_waha_config(data: WAHAConfigIn, user=Depends(require_roles("admin"))):
    payload = data.model_dump()
    await db.waha_config.update_one({"_id": "config"}, {"$set": payload}, upsert=True)
    return payload

@api.post("/waha/test-connection")
async def waha_test_connection(user=Depends(require_roles("admin"))):
    """Calls GET {base_url}/api/sessions/{session} to verify WAHA reachability."""
    import httpx
    cfg = await _get_waha_config()
    if not cfg.get("base_url"):
        raise HTTPException(400, "Base URL WAHA belum diisi")
    url = f"{cfg['base_url'].rstrip('/')}/api/sessions/{cfg.get('session') or 'default'}"
    headers = {}
    if cfg.get("api_key"):
        headers["X-Api-Key"] = cfg["api_key"]
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            r = await client.get(url, headers=headers)
        return {"ok": r.status_code < 400, "status_code": r.status_code, "body": (r.json() if r.headers.get("content-type", "").startswith("application/json") else r.text[:500])}
    except Exception as e:
        return {"ok": False, "error": str(e)}

@api.post("/waha/test-send")
async def waha_test_send(data: WAHATestSendIn, user=Depends(require_roles("admin"))):
    """Manually send a WhatsApp message via WAHA sendText endpoint."""
    cfg = await _get_waha_config()
    if not cfg.get("base_url"):
        raise HTTPException(400, "Base URL WAHA belum diisi")
    if not cfg.get("enabled"):
        raise HTTPException(400, "WAHA belum diaktifkan. Set enabled=true di config.")
    result = await _waha_send_raw(data.phone, data.message, cfg=cfg)
    return result


@api.get("/waha/logs")
async def waha_logs(limit: int = 50, user=Depends(require_roles("admin"))):
    """Recent WAHA notification dispatch history (latest first)."""
    limit = max(1, min(int(limit or 50), 200))
    cur = db.waha_logs.find({}, {"_id": 0}).sort("at", -1).limit(limit)
    return [doc async for doc in cur]

# ============ Routes: Arenas ============
@api.post("/arenas")
async def create_arena(data: ArenaIn, user=Depends(require_roles("admin"))):
    doc = data.model_dump()
    doc.update({"id": new_id(), "created_at": now_iso()})
    await db.arenas.insert_one(doc)
    doc.pop("_id", None)
    return doc

@api.get("/arenas")
async def list_arenas(event_id: Optional[str] = None, user=Depends(get_current_user)):
    q = {"event_id": event_id} if event_id else {}
    return await list_collection(db.arenas, q)

@api.delete("/arenas/{aid}")
async def delete_arena(aid: str, user=Depends(require_roles("admin"))):
    await db.arenas.delete_one({"id": aid})
    return {"ok": True}

@api.put("/arenas/{aid}")
async def update_arena(aid: str, data: ArenaIn, user=Depends(require_roles("admin"))):
    await db.arenas.update_one({"id": aid}, {"$set": data.model_dump()})
    return await db.arenas.find_one({"id": aid}, {"_id": 0})

# Public endpoint for arena listing (used by public display)
@api.get("/public/arenas")
async def public_list_arenas(event_id: Optional[str] = None):
    q = {"event_id": event_id} if event_id else {}
    return await list_collection(db.arenas, q)

@api.get("/public/athletes")
async def public_list_athletes(event_id: Optional[str] = None):
    q = {"event_id": event_id} if event_id else {}
    return await list_collection(db.athletes, q)

@api.get("/public/events")
async def public_list_events():
    events = await db.events.find(
        {"status": {"$ne": "closed"}, "landing_enabled": {"$ne": False}},
        {"_id": 0},
    ).sort("start_date", 1).to_list(500)
    return [normalize_public_event(e) for e in events]

@api.get("/public/events/current")
async def public_current_event():
    events = await db.events.find(
        {"status": {"$ne": "closed"}, "landing_enabled": {"$ne": False}},
        {"_id": 0},
    ).sort("start_date", 1).to_list(500)
    if not events:
        raise HTTPException(404, "Belum ada event yang dipublikasikan")
    active = next((e for e in events if e.get("status") in ("active", "registration_open")), events[0])
    return normalize_public_event(active)

@api.get("/public/events/{slug}")
async def public_get_event(slug: str):
    event = await db.events.find_one(
        {
            "$or": [{"slug": slug}, {"id": slug}],
            "status": {"$ne": "closed"},
            "landing_enabled": {"$ne": False},
        },
        {"_id": 0},
    )
    if not event:
        raise HTTPException(404, "Event tidak ditemukan")
    return normalize_public_event(event)

@api.get("/public/categories")
async def public_list_categories(event_id: Optional[str] = None):
    q = {"event_id": event_id} if event_id else {}
    return await list_collection(db.categories, q)

@api.get("/public/classes")
async def public_list_classes(event_id: Optional[str] = None):
    q = {"event_id": event_id} if event_id else {}
    return await list_collection(db.classes, q)

@api.get("/public/contingents")
async def public_list_contingents(event_id: Optional[str] = None):
    q = {"event_id": event_id} if event_id else {}
    return await list_collection(db.contingents, q)

# ============ Routes: Scoring Rules ============
@api.post("/scoring-rules")
async def create_rule(data: ScoringRuleIn, user=Depends(require_roles("admin"))):
    doc = data.model_dump()
    doc.update({"id": new_id(), "created_at": now_iso()})
    await db.scoring_rules.insert_one(doc)
    doc.pop("_id", None)
    return doc

@api.get("/scoring-rules")
async def list_rules(event_id: Optional[str] = None, user=Depends(get_current_user)):
    q = {"event_id": event_id} if event_id else {}
    return await list_collection(db.scoring_rules, q)

@api.put("/scoring-rules/{rid}")
async def update_rule(rid: str, data: ScoringRuleIn, user=Depends(require_roles("admin"))):
    await db.scoring_rules.update_one({"id": rid}, {"$set": data.model_dump()})
    return await db.scoring_rules.find_one({"id": rid}, {"_id": 0})

@api.delete("/scoring-rules/{rid}")
async def delete_rule(rid: str, user=Depends(require_roles("admin"))):
    await db.scoring_rules.delete_one({"id": rid})
    return {"ok": True}

# ============ Routes: Matches ============
@api.post("/matches")
async def create_match(data: MatchIn, user=Depends(require_roles("admin", "operator"))):
    doc = data.model_dump()
    doc.update({
        "id": new_id(),
        "created_at": now_iso(),
        "status": "scheduled",
        "current_round": 1,
        "timer": {"running": False, "remaining_sec": 0, "started_at": None, "round": 1},
        "winner_corner": None,
        "decision_method": None,
        "approved_by": None,
        "approved_at": None,
        "started_at": None,
        "finished_at": None,
    })
    # initial remaining sec from rule
    rule = await db.scoring_rules.find_one({"id": data.scoring_rule_id})
    if rule:
        doc["timer"]["remaining_sec"] = rule.get("round_duration_sec", 120)
    await db.matches.insert_one(doc)
    doc.pop("_id", None)
    await broadcast_match_update(doc["id"], "created")
    return doc

@api.get("/matches")
async def list_matches(event_id: Optional[str] = None, arena_id: Optional[str] = None, status_filter: Optional[str] = None, user=Depends(get_current_user)):
    q = {}
    if event_id: q["event_id"] = event_id
    if arena_id: q["arena_id"] = arena_id
    if status_filter: q["status"] = status_filter
    matches = await db.matches.find(q, {"_id": 0}).sort("match_number", 1).to_list(2000)
    return matches

@api.get("/matches/{mid}")
async def get_match(mid: str, user=Depends(get_current_user)):
    await _load_match_settled(mid)
    state = await compute_match_state(mid)
    if not state:
        raise HTTPException(404, "Match tidak ditemukan")
    return state

@api.get("/public/matches/{mid}")
async def public_get_match(mid: str):
    await _load_match_settled(mid)
    state = await compute_match_state(mid)
    if not state:
        raise HTTPException(404, "Match tidak ditemukan")
    return state

@api.get("/public/arenas/{arena_id}/current")
async def public_arena_current(arena_id: str):
    # Find currently active match for arena
    m = await db.matches.find_one({"arena_id": arena_id, "status": {"$in": ["in_progress", "paused"]}}, {"_id": 0})
    if not m:
        # fallback to most recent scheduled
        m = await db.matches.find_one({"arena_id": arena_id, "status": "scheduled"}, {"_id": 0}, sort=[("match_number", 1)])
    if not m:
        return {"match": None}
    await _load_match_settled(m["id"])
    state = await compute_match_state(m["id"])
    return {"match": state}

@api.delete("/matches/{mid}")
async def delete_match(mid: str, user=Depends(require_roles("admin", "operator"))):
    await db.matches.delete_one({"id": mid})
    await db.score_logs.delete_many({"match_id": mid})
    await db.score_votes.delete_many({"match_id": mid})
    return {"ok": True}

def _action_points(data: ScoreActionIn, rule: Dict[str, Any]) -> int:
    points = data.points
    if points == 0 and rule:
        if data.action_type in ("score", "fall"):
            points = int(rule.get("points", {}).get(data.code, 0))
        elif data.action_type == "penalty":
            points = int(rule.get("penalty_points", {}).get(data.code, 0))
    return points

async def _apply_jury_consensus(mid: str, match: Dict[str, Any], data: ScoreActionIn, user: Dict[str, Any], role: str, points: int) -> Dict[str, Any]:
    """A score counts once when two different juries press the same action within the window."""
    lock = _consensus_lock(mid)
    async with lock:
        now = datetime.now(timezone.utc)
        window_start = (now - timedelta(seconds=JURY_CONSENSUS_WINDOW_SEC)).isoformat()
        key = {
            "match_id": mid,
            "round": match.get("current_round", 1),
            "corner": data.corner,
            "code": data.code,
        }
        recent = await db.score_votes.find({**key, "timestamp": {"$gte": window_start}}, {"_id": 0}).to_list(20)
        mine = next((v for v in recent if v.get("judge_id") == user["id"]), None)
        if mine:
            if mine.get("log_id"):
                log = await db.score_logs.find_one({"id": mine["log_id"]}, {"_id": 0}) or {}
                log["confirmed"] = True
                log["pending"] = False
                log["judges"] = len({v["judge_id"] for v in recent if v.get("log_id") == mine["log_id"]})
                return log
            return {
                "pending": True, "confirmed": False,
                "judges": len({v["judge_id"] for v in recent}),
                "corner": data.corner, "code": data.code, "round": key["round"], "points": 0,
            }

        vote = {
            "id": new_id(),
            **key,
            "judge_id": user["id"],
            "judge_name": user.get("name", ""),
            "timestamp": now.isoformat(),
            "log_id": None,
        }
        await db.score_votes.insert_one(vote)
        recent.append({k: v for k, v in vote.items() if k != "_id"})
        unlinked = [v for v in recent if not v.get("log_id")]
        linked_ids = [v["log_id"] for v in recent if v.get("log_id")]

        async def attach(log_id: str) -> Dict[str, Any]:
            ids = [v["id"] for v in unlinked]
            if ids:
                await db.score_votes.update_many({"id": {"$in": ids}}, {"$set": {"log_id": log_id}})
            log = await db.score_logs.find_one({"id": log_id}, {"_id": 0}) or {}
            log["confirmed"] = True
            log["pending"] = False
            log["judges"] = len({v["judge_id"] for v in recent})
            await broadcast_match_update(mid, "score_update")
            return log

        if linked_ids and len({v["judge_id"] for v in unlinked}) < 2:
            return await attach(linked_ids[-1])

        if len({v["judge_id"] for v in unlinked}) < 2:
            await broadcast_match_update(mid, "score_pending")
            return {
                "pending": True, "confirmed": False,
                "judges": len({v["judge_id"] for v in unlinked}),
                "corner": data.corner, "code": data.code, "round": key["round"], "points": 0,
            }

        if linked_ids:
            return await attach(linked_ids[-1])

        names = []
        seen = set()
        for v in unlinked:
            if v["judge_id"] in seen:
                continue
            seen.add(v["judge_id"])
            if v.get("judge_name"):
                names.append(v["judge_name"])
        log = {
            "id": new_id(),
            "match_id": mid,
            "round": key["round"],
            "corner": data.corner,
            "action_type": "score",
            "code": data.code,
            "points": points,
            "notes": data.notes,
            "judge_id": user["id"],
            "judge_name": ", ".join(names) or user.get("name", ""),
            "judge_role": role,
            "timestamp": now.isoformat(),
            "valid": True,
            "consensus": True,
        }
        await db.score_logs.insert_one(log)
        await db.score_votes.update_many({"id": {"$in": [v["id"] for v in unlinked]}}, {"$set": {"log_id": log["id"]}})
        await broadcast_match_update(mid, "score_update")
        log.pop("_id", None)
        log["confirmed"] = True
        log["pending"] = False
        log["judges"] = len(seen)
        return log

# ===== Score Actions =====
@api.post("/matches/{mid}/actions")
async def add_action(mid: str, data: ScoreActionIn, user=Depends(require_roles("jury", "referee", "head_jury", "operator"))):
    match = await db.matches.find_one({"id": mid})
    if not match:
        raise HTTPException(404, "Match tidak ditemukan")
    match = await settle_expired_timer(match)
    if match["status"] not in ("in_progress", "paused"):
        raise HTTPException(400, "Match tidak sedang berjalan")

    role = user["role"]
    if data.action_type == "score" and role not in ("jury", "admin"):
        raise HTTPException(403, "Hanya juri yang dapat memberi skor")
    if data.action_type in ("penalty", "fall", "binaan", "absolute_win") and role not in ("referee", "head_jury", "admin"):
        raise HTTPException(403, "Hanya wasit/ketua juri yang dapat memberi tindakan ini")

    timer = match.get("timer") or {}
    clock_done = not timer.get("running") and float(timer.get("remaining_sec") or 0) <= 0
    if data.action_type == "score" and clock_done:
        raise HTTPException(400, "Waktu ronde habis. Mulai ronde lagi atau akhiri partai sebelum menambah skor.")

    rule = await db.scoring_rules.find_one({"id": match["scoring_rule_id"]}) or {}
    points = _action_points(data, rule)

    if data.action_type == "binaan":
        limit = int(rule.get("binaan_limit") or 0)
        if limit > 0:
            count = await db.score_logs.count_documents({
                "match_id": mid, "corner": data.corner, "action_type": "binaan", "valid": True,
            })
            if count >= limit:
                raise HTTPException(400, f"Batas binaan sudut ini sudah tercapai ({limit}). Gunakan teguran.")

    if data.action_type == "score":
        return await _apply_jury_consensus(mid, match, data, user, role, points)

    log = {
        "id": new_id(),
        "match_id": mid,
        "round": match.get("current_round", 1),
        "corner": data.corner,
        "action_type": data.action_type,
        "code": data.code,
        "points": points,
        "notes": data.notes,
        "judge_id": user["id"],
        "judge_name": user.get("name", ""),
        "judge_role": role,
        "timestamp": now_iso(),
        "valid": True,
    }
    await db.score_logs.insert_one(log)
    if data.action_type == "absolute_win":
        await _finish_match_decision(match, data.corner, "menang_mutlak")
    elif data.action_type == "penalty" and data.code == "peringatan_3":
        opponent = "blue" if data.corner == "red" else "red"
        await _finish_match_decision(match, opponent, "menang_diskualifikasi")
    await broadcast_match_update(mid, "score_update")
    log.pop("_id", None)
    return log

@api.get("/matches/{mid}/logs")
async def list_logs(mid: str, user=Depends(get_current_user)):
    logs = await db.score_logs.find({"match_id": mid}, {"_id": 0}).sort("timestamp", 1).to_list(5000)
    return logs

@api.post("/matches/{mid}/logs/{log_id}/invalidate")
async def invalidate_log(mid: str, log_id: str, user=Depends(require_roles("head_jury", "admin"))):
    await db.score_logs.update_one({"id": log_id, "match_id": mid}, {"$set": {"valid": False, "corrected_by": user["id"], "corrected_at": now_iso()}})
    await broadcast_match_update(mid, "correction")
    return {"ok": True}

# ===== Timer Actions =====
@api.post("/matches/{mid}/timer")
async def timer_action(mid: str, data: TimerActionIn, user=Depends(require_roles("timer", "operator", "admin"))):
    match = await db.matches.find_one({"id": mid})
    if not match:
        raise HTTPException(404, "Match tidak ditemukan")
    if data.action in ("start", "resume") and match.get("status") in ("approved", "finished"):
        raise HTTPException(400, "Partai yang sudah selesai atau disahkan tidak dapat dimulai lagi")
    match = await settle_expired_timer(match)
    rule = await db.scoring_rules.find_one({"id": match["scoring_rule_id"]}) or {}
    round_duration = rule.get("round_duration_sec", 120)
    total_rounds = rule.get("round_count", 3)

    timer = match.get("timer", {"running": False, "remaining_sec": round_duration, "round": 1, "started_at": None})
    now = datetime.now(timezone.utc)

    def consume_running():
        nonlocal timer
        timer = _consume_timer(timer, now)

    update = {}
    if data.action == "start":
        if not timer.get("running"):
            if timer.get("remaining_sec", 0) <= 0:
                timer["remaining_sec"] = round_duration
            timer["running"] = True
            timer["started_at"] = now.isoformat()
        update["status"] = "in_progress"
        if not match.get("started_at"):
            update["started_at"] = now.isoformat()
    elif data.action == "pause":
        consume_running()
        update["status"] = "paused"
    elif data.action == "resume":
        if not timer.get("running"):
            timer["running"] = True
            timer["started_at"] = now.isoformat()
        update["status"] = "in_progress"
    elif data.action == "reset":
        timer = {"running": False, "remaining_sec": round_duration, "round": match.get("current_round", 1), "started_at": None}
    elif data.action == "next_round":
        consume_running()
        cur = match.get("current_round", 1)
        if cur < total_rounds:
            cur += 1
            timer = {"running": False, "remaining_sec": round_duration, "round": cur, "started_at": None}
            update["current_round"] = cur
            update["status"] = "paused"
        else:
            update["status"] = "finished"
            update["finished_at"] = now.isoformat()
    elif data.action == "end_match":
        consume_running()
        update["status"] = "finished"
        update["finished_at"] = now.isoformat()

    update["timer"] = timer
    await db.matches.update_one({"id": mid}, {"$set": update})
    await broadcast_match_update(mid, "timer_update")
    return await compute_match_state(mid)

# ===== Approval =====
@api.post("/matches/{mid}/approve")
async def approve_match(mid: str, data: ApproveIn, user=Depends(require_roles("head_jury", "admin"))):
    match = await db.matches.find_one({"id": mid})
    if not match:
        raise HTTPException(404, "Match tidak ditemukan")
    match = await settle_expired_timer(match)
    if match.get("status") not in ("paused", "finished"):
        raise HTTPException(400, "Partai hanya dapat disahkan saat dijeda atau selesai")
    state = await compute_match_state(mid)
    winner = data.winner_corner
    if not winner:
        if state["red"]["score"] > state["blue"]["score"]:
            winner = "red"
        elif state["blue"]["score"] > state["red"]["score"]:
            winner = "blue"
        else:
            winner = "draw"
    update = {
        "status": "approved",
        "winner_corner": winner,
        "decision_method": data.decision_method or ("seri" if winner == "draw" else "menang_angka"),
        "approved_by": user["id"],
        "approved_by_name": user.get("name", ""),
        "approved_at": now_iso(),
        "approval_notes": data.notes,
    }
    if not match.get("finished_at"):
        update["finished_at"] = now_iso()
    await db.matches.update_one({"id": mid}, {"$set": update})
    await broadcast_match_update(mid, "approved")
    # Bracket advancement: if this match is part of a bracket, push winner up
    if match.get("bracket_id") and match.get("bracket_slot_id") and winner in ("red", "blue"):
        try:
            winner_athlete_id = match["red_athlete_id"] if winner == "red" else match["blue_athlete_id"]
            await _bracket_advance_winner(match["bracket_id"], match["bracket_slot_id"], winner_athlete_id)
        except Exception as e:
            print(f"[bracket] advance error: {e}")
    return await compute_match_state(mid)

# ============ Routes: Brackets ============
import math
import random as _rnd

def _next_pow2(n: int) -> int:
    if n <= 1: return 2
    return 1 << (n - 1).bit_length()

async def _build_bracket_slots(bracket_id: str, size: int) -> List[Dict[str, Any]]:
    """Create all slots for a single elimination bracket. Returns list of inserted slot docs.
    Round 1 has `size` slots. Round 2 has size/2, ..., final round has 1 slot.
    Each non-R1 slot has source_a/source_b (the two child slots that feed it).
    """
    rounds = int(math.log2(size))
    slots: List[Dict[str, Any]] = []
    # Build bottom-up so we can compute source ids
    # We'll build top-down (R1, R2, ...) and link sources in second pass after we have IDs
    # First pass: create all slot docs
    by_round: Dict[int, List[Dict[str, Any]]] = {}
    for r in range(1, rounds + 2):  # rounds+1 rounds total (final is round = rounds+1 only if we want extra), actually log2(size)+1 rounds means size=8→4 rounds (R1=8 slots, R2=4, R3=2, R4=1)
        count = size >> (r - 1) if r <= rounds + 1 else 0
        if count < 1: break
        by_round[r] = []
        for pos in range(count):
            doc = {
                "id": new_id(),
                "bracket_id": bracket_id,
                "round": r,
                "position": pos,
                "athlete_id": None,
                "is_bye": False,
                "match_id": None,
                "source_a": None,
                "source_b": None,
                "created_at": now_iso(),
            }
            by_round[r].append(doc)
            slots.append(doc)
    # Second pass: link sources (round r+1 position p ← round r position 2p,2p+1)
    for r, arr in by_round.items():
        if r == 1: continue
        prev = by_round.get(r - 1, [])
        for p, slot in enumerate(arr):
            if 2 * p < len(prev): slot["source_a"] = prev[2 * p]["id"]
            if 2 * p + 1 < len(prev): slot["source_b"] = prev[2 * p + 1]["id"]
    if slots:
        await db.bracket_slots.insert_many(slots)
    return slots

async def _auto_fill_round1(bracket: Dict[str, Any]) -> None:
    """Fetch active athletes for bracket's class/category, shuffle, place into round-1 slots. Mark byes if odd."""
    q: Dict[str, Any] = {"event_id": bracket["event_id"], "status": {"$ne": "inactive"}}
    if bracket.get("class_id"): q["class_id"] = bracket["class_id"]
    elif bracket.get("category_id"): q["category_id"] = bracket["category_id"]
    athletes = await db.athletes.find(q, {"_id": 0}).to_list(2000)
    _rnd.shuffle(athletes)
    r1_slots = await db.bracket_slots.find({"bracket_id": bracket["id"], "round": 1}).sort("position", 1).to_list(1024)
    # Fill: first len(athletes) slots get an athlete, rest are byes
    for i, slot in enumerate(r1_slots):
        if i < len(athletes):
            await db.bracket_slots.update_one({"id": slot["id"]}, {"$set": {"athlete_id": athletes[i]["id"], "is_bye": False}})
        else:
            await db.bracket_slots.update_one({"id": slot["id"]}, {"$set": {"athlete_id": None, "is_bye": True}})

async def _hydrate_bracket(bracket: Dict[str, Any]) -> Dict[str, Any]:
    slots = await db.bracket_slots.find({"bracket_id": bracket["id"]}, {"_id": 0}).sort([("round", 1), ("position", 1)]).to_list(2048)
    # Hydrate athletes and matches
    aids = list({s["athlete_id"] for s in slots if s.get("athlete_id")})
    mids = list({s["match_id"] for s in slots if s.get("match_id")})
    athletes_by_id: Dict[str, Any] = {}
    if aids:
        athletes_by_id = {a["id"]: a async for a in db.athletes.find({"id": {"$in": aids}}, {"_id": 0})}
    matches_by_id: Dict[str, Any] = {}
    if mids:
        matches_by_id = {m["id"]: m async for m in db.matches.find({"id": {"$in": mids}}, {"_id": 0})}
    for s in slots:
        s["athlete"] = athletes_by_id.get(s.get("athlete_id"))
        s["match"] = matches_by_id.get(s.get("match_id"))
    bracket["slots"] = slots
    # rounds count
    bracket["rounds"] = int(math.log2(bracket["size"])) if bracket.get("size") else 0
    return bracket

async def _create_match_for_slot(bracket: Dict[str, Any], slot: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    """Given a parent slot (round >= 2) whose source_a and source_b both have athletes, create a match.
    Or for round-1 slots, we don't call this — round-1 matches are created when bracket starts.
    """
    return None  # not used; round-1 has its own loop, and advancement creates the next match inline

async def _bracket_advance_winner(bracket_id: str, parent_slot_id: str, winner_athlete_id: str) -> None:
    """Place the winner into the slot this match feeds. Create the next match only when both sources are ready, and point that match at the slot which receives ITS winner."""
    parent = await db.bracket_slots.find_one({"id": parent_slot_id, "bracket_id": bracket_id})
    if not parent:
        return
    await db.bracket_slots.update_one({"id": parent_slot_id}, {"$set": {"athlete_id": winner_athlete_id, "is_bye": False}})
    parent["athlete_id"] = winner_athlete_id
    next_slot = await db.bracket_slots.find_one({"bracket_id": bracket_id, "$or": [{"source_a": parent_slot_id}, {"source_b": parent_slot_id}]})
    if not next_slot:
        await db.brackets.update_one({"id": bracket_id}, {"$set": {"status": "completed", "winner_athlete_id": winner_athlete_id, "finished_at": now_iso()}})
        return
    sibling_id = next_slot["source_b"] if next_slot.get("source_a") == parent_slot_id else next_slot.get("source_a")
    sibling = await db.bracket_slots.find_one({"id": sibling_id}) if sibling_id else None
    if sibling and sibling.get("is_bye") and not sibling.get("athlete_id"):
        await _bracket_advance_winner(bracket_id, next_slot["id"], winner_athlete_id)
        return
    if not (sibling and sibling.get("athlete_id")):
        return
    existing = await db.matches.find_one({"bracket_id": bracket_id, "bracket_slot_id": next_slot["id"]})
    if existing:
        return
    bracket = await db.brackets.find_one({"id": bracket_id})
    if not bracket:
        return
    source_a = await db.bracket_slots.find_one({"id": next_slot["source_a"]})
    source_b = await db.bracket_slots.find_one({"id": next_slot["source_b"]})
    if not source_a or not source_b:
        return
    red_aid = source_a.get("athlete_id")
    blue_aid = source_b.get("athlete_id")
    if source_a.get("is_bye") and not red_aid and blue_aid:
        await _bracket_advance_winner(bracket_id, next_slot["id"], blue_aid)
        return
    if source_b.get("is_bye") and not blue_aid and red_aid:
        await _bracket_advance_winner(bracket_id, next_slot["id"], red_aid)
        return
    if not (red_aid and blue_aid):
        return
    await _create_bracket_match(bracket, next_slot, source_a, source_b, red_aid, blue_aid)

async def _create_bracket_match(bracket: Dict[str, Any], destination: Dict[str, Any], source_a: Dict[str, Any], source_b: Dict[str, Any], red_aid: str, blue_aid: str) -> Optional[Dict[str, Any]]:
    """Create a match between two source slots. The winner is written into destination."""
    if not (bracket.get("arena_id") and bracket.get("scoring_rule_id")):
        return None
    seq = await next_seq(f"bracket_match:{bracket['id']}")
    match = {
        "id": new_id(),
        "event_id": bracket["event_id"],
        "arena_id": bracket["arena_id"],
        "class_id": bracket.get("class_id"),
        "category_id": bracket.get("category_id"),
        "scoring_rule_id": bracket["scoring_rule_id"],
        "red_athlete_id": red_aid,
        "blue_athlete_id": blue_aid,
        "discipline": bracket.get("discipline", "tanding"),
        "performer_ids": [],
        "match_number": seq,
        "round_label": f"{bracket['name']} · R{source_a.get('round', 1)}",
        "bracket_id": bracket["id"],
        "bracket_slot_id": destination["id"],
        "status": "scheduled",
        "current_round": 1,
        "timer": {"running": False, "remaining_sec": 0, "started_at": None, "round": 1},
        "winner_corner": None,
        "decision_method": None,
        "approved_by": None, "approved_at": None,
        "started_at": None, "finished_at": None,
        "created_at": now_iso(),
    }
    rule = await db.scoring_rules.find_one({"id": bracket["scoring_rule_id"]})
    if rule:
        match["timer"]["remaining_sec"] = rule.get("round_duration_sec", 120)
    await db.matches.insert_one(match)
    await db.bracket_slots.update_one({"id": source_a["id"]}, {"$set": {"match_id": match["id"]}})
    await db.bracket_slots.update_one({"id": source_b["id"]}, {"$set": {"match_id": match["id"]}})
    match.pop("_id", None)
    return match

@api.post("/brackets")
async def create_bracket(data: BracketIn, user=Depends(require_roles("admin", "operator"))):
    size = _next_pow2(max(2, int(data.size)))
    doc = data.model_dump()
    doc.update({
        "id": new_id(), "size": size, "status": "draft",
        "created_at": now_iso(), "winner_athlete_id": None, "finished_at": None,
    })
    await db.brackets.insert_one(doc)
    await _build_bracket_slots(doc["id"], size)
    if data.auto_fill:
        await _auto_fill_round1(doc)
    doc.pop("_id", None)
    return await _hydrate_bracket(doc)

@api.get("/brackets")
async def list_brackets(event_id: Optional[str] = None, user=Depends(get_current_user)):
    q = {"event_id": event_id} if event_id else {}
    brackets = await db.brackets.find(q, {"_id": 0}).sort("created_at", -1).to_list(500)
    for b in brackets:
        # lightweight — just counts
        b["slots_count"] = await db.bracket_slots.count_documents({"bracket_id": b["id"]})
    return brackets

@api.get("/brackets/{bid}")
async def get_bracket(bid: str, user=Depends(get_current_user)):
    b = await db.brackets.find_one({"id": bid}, {"_id": 0})
    if not b: raise HTTPException(404, "Bracket tidak ditemukan")
    return await _hydrate_bracket(b)

@api.get("/public/brackets/{bid}")
async def public_get_bracket(bid: str):
    b = await db.brackets.find_one({"id": bid}, {"_id": 0})
    if not b: raise HTTPException(404, "Bracket tidak ditemukan")
    return await _hydrate_bracket(b)

@api.get("/public/brackets")
async def public_list_brackets(event_id: Optional[str] = None):
    q = {"event_id": event_id} if event_id else {}
    return await db.brackets.find(q, {"_id": 0}).sort("created_at", -1).to_list(500)

@api.put("/brackets/{bid}/slots/{sid}")
async def assign_slot(bid: str, sid: str, data: BracketSlotAssignIn, user=Depends(require_roles("admin", "operator"))):
    b = await db.brackets.find_one({"id": bid})
    if not b: raise HTTPException(404, "Bracket tidak ditemukan")
    if b.get("status") != "draft":
        raise HTTPException(400, "Hanya bracket berstatus draft yang dapat diedit")
    slot = await db.bracket_slots.find_one({"id": sid, "bracket_id": bid})
    if not slot or slot.get("round") != 1:
        raise HTTPException(400, "Slot tidak valid (hanya slot ronde 1 yang dapat di-assign)")
    upd: Dict[str, Any] = {"athlete_id": data.athlete_id, "is_bye": False if data.athlete_id else True}
    await db.bracket_slots.update_one({"id": sid}, {"$set": upd})
    return await _hydrate_bracket(await db.brackets.find_one({"id": bid}, {"_id": 0}))

@api.post("/brackets/{bid}/start")
async def start_bracket(bid: str, user=Depends(require_roles("admin", "operator"))):
    b = await db.brackets.find_one({"id": bid})
    if not b: raise HTTPException(404, "Bracket tidak ditemukan")
    if b.get("status") not in ("draft",):
        raise HTTPException(400, "Bracket sudah dimulai atau selesai")
    if not (b.get("arena_id") and b.get("scoring_rule_id")):
        raise HTTPException(400, "Set arena dan aturan skoring bracket terlebih dahulu")
    # Create round-1 matches; resolve byes immediately
    r1 = await db.bracket_slots.find({"bracket_id": bid, "round": 1}).sort("position", 1).to_list(1024)
    # Iterate pairs (0,1), (2,3), ...
    for i in range(0, len(r1), 2):
        a, c = r1[i], r1[i + 1] if i + 1 < len(r1) else None
        if not c: break
        # Find parent slot (round 2)
        parent = await db.bracket_slots.find_one({"bracket_id": bid, "round": 2, "$or": [{"source_a": a["id"]}, {"source_b": a["id"]}]})
        if a.get("is_bye") and c.get("is_bye"):
            if parent:
                await db.bracket_slots.update_one({"id": parent["id"]}, {"$set": {"is_bye": True, "athlete_id": None}})
            continue
        # If one side is bye → auto-advance the other to parent
        if a.get("is_bye") and c.get("athlete_id"):
            if parent: await _bracket_advance_winner(bid, parent["id"], c["athlete_id"])
            continue
        if c.get("is_bye") and a.get("athlete_id"):
            if parent: await _bracket_advance_winner(bid, parent["id"], a["athlete_id"])
            continue
        if a.get("athlete_id") and c.get("athlete_id"):
            # Create match for this pair
            seq = await next_seq(f"bracket_match:{bid}")
            match = {
                "id": new_id(), "event_id": b["event_id"], "arena_id": b["arena_id"],
                "class_id": b.get("class_id"), "category_id": b.get("category_id"),
                "scoring_rule_id": b["scoring_rule_id"], "red_athlete_id": a["athlete_id"],
                "blue_athlete_id": c["athlete_id"], "discipline": b.get("discipline", "tanding"),
                "performer_ids": [], "match_number": seq,
                "round_label": f"{b['name']} · R1",
                "bracket_id": bid, "bracket_slot_id": parent["id"] if parent else None,
                "status": "scheduled", "current_round": 1,
                "timer": {"running": False, "remaining_sec": 0, "started_at": None, "round": 1},
                "winner_corner": None, "decision_method": None,
                "approved_by": None, "approved_at": None, "started_at": None, "finished_at": None,
                "created_at": now_iso(),
            }
            rule = await db.scoring_rules.find_one({"id": b["scoring_rule_id"]})
            if rule: match["timer"]["remaining_sec"] = rule.get("round_duration_sec", 120)
            await db.matches.insert_one(match)
            # Mark match_id on the LOWER slot (a) so we can find it (we use a's id as marker for the pair's match)
            await db.bracket_slots.update_one({"id": a["id"]}, {"$set": {"match_id": match["id"]}})
            await db.bracket_slots.update_one({"id": c["id"]}, {"$set": {"match_id": match["id"]}})
    await db.brackets.update_one({"id": bid}, {"$set": {"status": "running", "started_at": now_iso()}})
    return await _hydrate_bracket(await db.brackets.find_one({"id": bid}, {"_id": 0}))

@api.delete("/brackets/{bid}")
async def delete_bracket(bid: str, user=Depends(require_roles("admin"))):
    b = await db.brackets.find_one({"id": bid})
    if not b: raise HTTPException(404, "Bracket tidak ditemukan")
    if b.get("status") not in ("draft",):
        raise HTTPException(400, "Hanya bracket draft yang dapat dihapus")
    await db.brackets.delete_one({"id": bid})
    await db.bracket_slots.delete_many({"bracket_id": bid})
    return {"ok": True}

# ============ Routes: Seni Scoring (Tunggal/Ganda/Regu) ============
async def _seni_summary(mid: str) -> Dict[str, Any]:
    scores = await db.seni_scores.find({"match_id": mid}, {"_id": 0}).sort("jury_position", 1).to_list(20)
    penalties = await db.seni_penalties.find({"match_id": mid}, {"_id": 0}).sort("added_at", 1).to_list(50)
    totals = [float(s.get("total") or 0) for s in scores]
    dropped_high_low = len(totals) >= 5
    used = sorted(totals)[1:-1] if dropped_high_low else totals
    avg = sum(used) / len(used) if used else 0.0
    total_penalty = sum(float(p.get("value") or 0) for p in penalties)
    final = max(0.0, round(avg - total_penalty, 2))
    return {
        "scores": scores,
        "penalties": penalties,
        "jury_count": len(scores),
        "average": round(avg, 2),
        "total_penalty": round(total_penalty, 2),
        "final_score": final,
        "dropped_high_low": dropped_high_low,
    }

async def _attach_match_athletes(summary: Dict[str, Any], match: Dict[str, Any]) -> Dict[str, Any]:
    ids: List[str] = []
    if match.get("red_athlete_id"):
        ids.append(match["red_athlete_id"])
    for pid in match.get("performer_ids") or []:
        if pid and pid not in ids:
            ids.append(pid)
    if match.get("blue_athlete_id") and match["blue_athlete_id"] not in ids:
        ids.append(match["blue_athlete_id"])
    athletes = []
    if ids:
        found = await db.athletes.find({"id": {"$in": ids}}, {"_id": 0}).to_list(20)
        by_id = {a["id"]: a for a in found}
        athletes = [by_id[i] for i in ids if i in by_id]
    summary["athletes"] = athletes
    summary["match"] = match
    return summary

@api.get("/matches/{mid}/seni")
async def get_seni(mid: str, user=Depends(get_current_user)):
    match = await db.matches.find_one({"id": mid}, {"_id": 0})
    if not match: raise HTTPException(404, "Match tidak ditemukan")
    summary = await _seni_summary(mid)
    return await _attach_match_athletes(summary, match)

@api.get("/public/matches/{mid}/seni")
async def public_get_seni(mid: str):
    match = await db.matches.find_one({"id": mid}, {"_id": 0})
    if not match: raise HTTPException(404, "Match tidak ditemukan")
    summary = await _seni_summary(mid)
    return await _attach_match_athletes(summary, match)

@api.post("/matches/{mid}/seni/score")
async def post_seni_score(mid: str, data: SeniScoreIn, user=Depends(require_roles("jury", "head_jury", "admin"))):
    match = await db.matches.find_one({"id": mid})
    if not match: raise HTTPException(404, "Match tidak ditemukan")
    total = round(float(data.teknik) + float(data.wirama) + float(data.penghayatan), 2)
    doc = {
        "match_id": mid,
        "jury_id": user["id"],
        "jury_name": user.get("name", ""),
        "jury_position": int(data.jury_position),
        "teknik": float(data.teknik),
        "wirama": float(data.wirama),
        "penghayatan": float(data.penghayatan),
        "total": total,
        "submitted_at": now_iso(),
    }
    existing = await db.seni_scores.find_one({"match_id": mid, "jury_id": user["id"]})
    if existing:
        await db.seni_scores.update_one({"_id": existing["_id"]}, {"$set": doc})
    else:
        doc["id"] = new_id()
        await db.seni_scores.insert_one(doc)
    if match.get("status") == "scheduled":
        await db.matches.update_one({"id": mid}, {"$set": {"status": "in_progress", "started_at": now_iso()}})
    await broadcast_match_update(mid, "seni_score")
    return await _seni_summary(mid)

@api.delete("/matches/{mid}/seni/score")
async def delete_my_seni_score(mid: str, user=Depends(require_roles("jury", "head_jury", "admin"))):
    await db.seni_scores.delete_one({"match_id": mid, "jury_id": user["id"]})
    await broadcast_match_update(mid, "seni_score_deleted")
    return await _seni_summary(mid)

@api.post("/matches/{mid}/seni/penalty")
async def post_seni_penalty(mid: str, data: SeniPenaltyIn, user=Depends(require_roles("head_jury", "admin"))):
    match = await db.matches.find_one({"id": mid})
    if not match: raise HTTPException(404, "Match tidak ditemukan")
    doc = {
        "id": new_id(), "match_id": mid,
        "code": data.code, "value": float(data.value),
        "notes": data.notes,
        "added_by": user["id"], "added_by_name": user.get("name", ""),
        "added_at": now_iso(),
    }
    await db.seni_penalties.insert_one(doc)
    await broadcast_match_update(mid, "seni_penalty")
    return await _seni_summary(mid)

@api.delete("/matches/{mid}/seni/penalty/{pid}")
async def delete_seni_penalty(mid: str, pid: str, user=Depends(require_roles("head_jury", "admin"))):
    await db.seni_penalties.delete_one({"id": pid, "match_id": mid})
    await broadcast_match_update(mid, "seni_penalty_deleted")
    return await _seni_summary(mid)

@api.post("/matches/{mid}/seni/finalize")
async def finalize_seni(mid: str, user=Depends(require_roles("head_jury", "admin"))):
    match = await db.matches.find_one({"id": mid})
    if not match: raise HTTPException(404, "Match tidak ditemukan")
    summary = await _seni_summary(mid)
    if summary["jury_count"] == 0:
        raise HTTPException(400, "Belum ada nilai juri")
    update = {
        "status": "approved",
        "winner_corner": "red",
        "decision_method": "seni",
        "approved_by": user["id"],
        "approved_by_name": user.get("name", ""),
        "approved_at": now_iso(),
        "finished_at": now_iso(),
        "seni_final_score": summary["final_score"],
        "seni_average": summary["average"],
        "seni_total_penalty": summary["total_penalty"],
    }
    await db.matches.update_one({"id": mid}, {"$set": update})
    await broadcast_match_update(mid, "seni_finalized")
    # Bracket advance if linked
    if match.get("bracket_id") and match.get("bracket_slot_id"):
        try:
            await _bracket_advance_winner(match["bracket_id"], match["bracket_slot_id"], match["red_athlete_id"])
        except Exception as e:
            print(f"[bracket] advance error: {e}")
    return await _seni_summary(mid)

# ============ WebSocket endpoints ============
@app.websocket("/api/ws/arena/{arena_id}")
async def ws_arena(websocket: WebSocket, arena_id: str):
    room = f"arena:{arena_id}"
    await manager.connect(room, websocket)
    try:
        # send initial state
        m = await db.matches.find_one({"arena_id": arena_id, "status": {"$in": ["in_progress", "paused"]}})
        if m:
            await settle_expired_timer(m)
            state = await compute_match_state(m["id"])
            await websocket.send_text(json.dumps({"type": "initial", "match_id": m["id"], "state": state}, default=str))
        while True:
            await websocket.receive_text()  # keepalive
    except WebSocketDisconnect:
        await manager.disconnect(room, websocket)
    except Exception:
        await manager.disconnect(room, websocket)

@app.websocket("/api/ws/match/{match_id}")
async def ws_match(websocket: WebSocket, match_id: str):
    room = f"match:{match_id}"
    await manager.connect(room, websocket)
    try:
        await _load_match_settled(match_id)
        state = await compute_match_state(match_id)
        await websocket.send_text(json.dumps({"type": "initial", "match_id": match_id, "state": state}, default=str))
        while True:
            await websocket.receive_text()
    except WebSocketDisconnect:
        await manager.disconnect(room, websocket)
    except Exception:
        await manager.disconnect(room, websocket)

# ============ Health ============
@api.get("/")
async def root():
    return {"service": "silat-scoring", "status": "ok"}

# Register router
app.include_router(api)

# Serve uploaded files
app.mount("/api/uploads", StaticFiles(directory=str(UPLOAD_DIR)), name="uploads")

# CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ============ Startup: Indexes + Seed ============
@app.on_event("startup")
async def startup():
    await db.users.create_index("email", unique=True)
    await db.users.create_index("id", unique=True)
    await db.events.create_index("id", unique=True)
    await db.events.create_index("slug", unique=True, sparse=True)
    await db.matches.create_index("id", unique=True)
    await db.matches.create_index("arena_id")
    await db.score_logs.create_index([("match_id", 1), ("timestamp", 1)])
    await db.registrations.create_index("id", unique=True)
    await db.registrations.create_index([("event_id", 1), ("status", 1)])
    await db.registrations.create_index("registration_number", unique=True)
    await db.registration_files.create_index("registration_id")
    await db.athletes.create_index([("event_id", 1), ("participant_number", 1)])
    await db.brackets.create_index([("event_id", 1)])
    await db.bracket_slots.create_index([("bracket_id", 1), ("round", 1), ("position", 1)])
    await db.seni_scores.create_index([("match_id", 1), ("jury_id", 1)], unique=True)
    await db.seni_penalties.create_index([("match_id", 1)])
    await db.score_votes.create_index([("match_id", 1), ("timestamp", 1)])
    await ensure_event_public_defaults()
    await seed_admin()
    await seed_demo_users()
    await seed_demo_event()
    await seed_example_events()
    global _expire_task
    if _expire_task is None or _expire_task.done():
        _expire_task = asyncio.create_task(_expire_running_matches_loop())
    logger.info("Startup complete: admin + demo seed done")

async def ensure_event_public_defaults():
    events = await db.events.find({}, {"_id": 0}).to_list(5000)
    for event in events:
        updates: Dict[str, Any] = {}
        if not event.get("slug"):
            updates["slug"] = await unique_event_slug(event.get("code") or event.get("name") or event.get("id"), current_id=event.get("id"))
        if "landing_enabled" not in event:
            updates["landing_enabled"] = True
        if "registration_enabled" not in event:
            updates["registration_enabled"] = True
        if not event.get("landing_title"):
            updates["landing_title"] = event.get("name", "")
        if not event.get("landing_subtitle"):
            updates["landing_subtitle"] = "Pendaftaran peserta pencak silat"
        if not event.get("landing_description"):
            updates["landing_description"] = "Ikuti informasi event, kategori pertandingan, dan pendaftaran peserta melalui halaman resmi ini."
        if "landing_poster_url" not in event:
            updates["landing_poster_url"] = event.get("logo_url", "")
        if "landing_contact" not in event:
            updates["landing_contact"] = ""
        if "landing_requirements" not in event:
            updates["landing_requirements"] = ""
        if "landing_schedule_note" not in event:
            updates["landing_schedule_note"] = ""
        if updates:
            await db.events.update_one({"id": event["id"]}, {"$set": updates})

async def seed_admin():
    existing = await db.users.find_one({"email": ADMIN_EMAIL})
    if not existing:
        await db.users.insert_one({
            "id": new_id(),
            "email": ADMIN_EMAIL,
            "password_hash": hash_password(ADMIN_PASSWORD),
            "name": "Administrator",
            "role": "admin",
            "created_at": now_iso(),
        })
    elif not verify_password(ADMIN_PASSWORD, existing["password_hash"]):
        await db.users.update_one({"email": ADMIN_EMAIL}, {"$set": {"password_hash": hash_password(ADMIN_PASSWORD)}})

async def seed_demo_users():
    demos = [
        ("operator@silat.id", "Operator", "operator"),
        ("juri1@silat.id", "Juri 1", "jury"),
        ("juri2@silat.id", "Juri 2", "jury"),
        ("juri3@silat.id", "Juri 3", "jury"),
        ("wasit@silat.id", "Wasit", "referee"),
        ("ketuajuri@silat.id", "Ketua Juri", "head_jury"),
        ("timer@silat.id", "Timer", "timer"),
    ]
    for email, name, role in demos:
        if not await db.users.find_one({"email": email}):
            await db.users.insert_one({
                "id": new_id(),
                "email": email,
                "password_hash": hash_password("password123"),
                "name": name,
                "role": role,
                "created_at": now_iso(),
            })

EXAMPLE_EVENTS_PATH = ROOT_DIR / "seed" / "example_events.json"
EXAMPLE_EVENT_COLLECTIONS = (
    "categories",
    "classes",
    "contingents",
    "arenas",
    "athletes",
    "scoring_rules",
    "matches",
    "brackets",
)

async def seed_example_events():
    """Masukkan contoh event (beserta logo/poster) hanya jika belum ada."""
    if not EXAMPLE_EVENTS_PATH.exists():
        return
    try:
        data = json.loads(EXAMPLE_EVENTS_PATH.read_text(encoding="utf-8"))
    except Exception:
        logger.exception("Gagal membaca seed contoh event")
        return
    for event in data.get("events") or []:
        event_id = event.get("id")
        if not event_id:
            continue
        exists = await db.events.find_one({
            "$or": [
                {"id": event_id},
                {"code": event.get("code")},
                {"slug": event.get("slug")},
            ]
        })
        if exists:
            continue
        await db.events.insert_one(dict(event))
        for col in EXAMPLE_EVENT_COLLECTIONS:
            for doc in data.get(col) or []:
                if doc.get("event_id") != event_id or not doc.get("id"):
                    continue
                if not await db[col].find_one({"id": doc["id"]}):
                    await db[col].insert_one(dict(doc))

async def seed_demo_event():
    # Only seed once
    if await db.events.find_one({"name": "Kejuaraan Nasional Pencak Silat 2026 (Demo)"}):
        return
    event_id = new_id()
    await db.events.insert_one({
        "id": event_id,
        "name": "Kejuaraan Nasional Pencak Silat 2026 (Demo)",
        "code": "KEJURNAS2026",
        "slug": "kejurnas-pencak-silat-2026",
        "location": "Jakarta",
        "start_date": "2026-03-01",
        "end_date": "2026-03-07",
        "logo_url": "",
        "status": "active",
        "landing_enabled": True,
        "registration_enabled": True,
        "landing_title": "Kejuaraan Nasional Pencak Silat 2026",
        "landing_subtitle": "Pendaftaran peserta resmi untuk kategori tanding dan seni",
        "landing_description": "Daftarkan atlet, pantau status verifikasi, dan ikuti informasi event dari satu halaman publik yang dapat dibagikan ke peserta.",
        "landing_poster_url": "",
        "landing_contact": "Panitia: 0812-0000-2026",
        "landing_requirements": "Pas foto, kartu identitas, dan surat keterangan sehat wajib diunggah saat pendaftaran.",
        "landing_schedule_note": "Pendaftaran dibuka hingga kuota tiap kelas terpenuhi. Verifikasi dilakukan oleh admin event.",
        "created_at": now_iso(),
    })
    # Default scoring rule
    rule_id = new_id()
    await db.scoring_rules.insert_one({
        "id": rule_id,
        "event_id": event_id,
        "name": "Aturan Standar IPSI",
        "category_type": "tanding",
        "round_count": 3,
        "round_duration_sec": 120,
        "rest_duration_sec": 60,
        "points": {"pukulan": 1, "tendangan": 2, "jatuhan": 3},
        "penalty_points": {"teguran_1": 1, "teguran_2": 2, "peringatan_1": 5, "peringatan_2": 10, "peringatan_3": 0},
        "binaan_limit": 2,
        "is_default": True,
        "created_at": now_iso(),
    })
    # Categories
    cat_id = new_id()
    await db.categories.insert_one({"id": cat_id, "event_id": event_id, "name": "Tanding Dewasa Putra", "type": "tanding", "gender": "putra", "age_group": "Dewasa", "created_at": now_iso()})
    cls_id = new_id()
    await db.classes.insert_one({"id": cls_id, "event_id": event_id, "category_id": cat_id, "name": "Kelas A (45-50 kg)", "weight_min": 45, "weight_max": 50, "created_at": now_iso()})
    arena_id_1 = new_id()
    arena_id_2 = new_id()
    await db.arenas.insert_many([
        {"id": arena_id_1, "event_id": event_id, "name": "Gelanggang 1", "created_at": now_iso()},
        {"id": arena_id_2, "event_id": event_id, "name": "Gelanggang 2", "created_at": now_iso()},
    ])
    c1 = new_id()
    c2 = new_id()
    await db.contingents.insert_many([
        {"id": c1, "event_id": event_id, "name": "DKI Jakarta", "region": "Jakarta", "created_at": now_iso()},
        {"id": c2, "event_id": event_id, "name": "Jawa Barat", "region": "Bandung", "created_at": now_iso()},
    ])
    a1 = new_id()
    a2 = new_id()
    await db.athletes.insert_many([
        {"id": a1, "event_id": event_id, "contingent_id": c1, "class_id": cls_id, "name": "Budi Santoso", "gender": "putra", "weight": 48, "photo_url": "", "dob": "2000-01-01", "created_at": now_iso()},
        {"id": a2, "event_id": event_id, "contingent_id": c2, "class_id": cls_id, "name": "Ahmad Fauzi", "gender": "putra", "weight": 49, "photo_url": "", "dob": "2000-05-12", "created_at": now_iso()},
    ])
    # Match
    await db.matches.insert_one({
        "id": new_id(),
        "event_id": event_id,
        "arena_id": arena_id_1,
        "class_id": cls_id,
        "category_id": cat_id,
        "scoring_rule_id": rule_id,
        "red_athlete_id": a1,
        "blue_athlete_id": a2,
        "match_number": 1,
        "scheduled_at": "2026-03-01T09:00:00",
        "round_label": "Babak Penyisihan",
        "status": "scheduled",
        "current_round": 1,
        "timer": {"running": False, "remaining_sec": 120, "round": 1, "started_at": None},
        "winner_corner": None,
        "decision_method": None,
        "approved_by": None,
        "approved_at": None,
        "started_at": None,
        "finished_at": None,
        "created_at": now_iso(),
    })

@app.on_event("shutdown")
async def shutdown():
    client.close()
