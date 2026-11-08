from dotenv import load_dotenv
from pathlib import Path

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / ".env")

import os
import io
import re
import uuid
import json
import hmac
import secrets
import logging
import asyncio
import ipaddress
import threading
import time
import bcrypt
import jwt
from collections import deque
from datetime import datetime, timezone, timedelta
from typing import List, Optional, Dict, Any, Literal

from fastapi import FastAPI, APIRouter, HTTPException, Depends, Request, WebSocket, WebSocketDisconnect, status, UploadFile, File, Form
from fastapi.responses import FileResponse, Response
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
from pymongo import ReturnDocument
from pymongo.errors import DuplicateKeyError
from pydantic import BaseModel, Field, EmailStr, ConfigDict, field_validator

# ============ Config ============
mongo_url = os.environ["MONGO_URL"]
db_name = os.environ["DB_NAME"]
JWT_SECRET = os.environ.get("JWT_SECRET", "dev-secret-change-me")
JWT_ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_HOURS = 24
ADMIN_EMAIL = os.environ.get("ADMIN_EMAIL", "admin@silat.id")
ADMIN_PASSWORD = os.environ.get("ADMIN_PASSWORD", "admin123")
MIN_PASSWORD_LENGTH = 8

client = AsyncIOMotorClient(mongo_url)
db = client[db_name]

UPLOAD_DIR = ROOT_DIR / "uploads"
UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
# KTP dan surat sehat. Folder ini tidak dilayani lewat /api/uploads.
PRIVATE_UPLOAD_DIR = UPLOAD_DIR / "private"
PRIVATE_UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
PRIVATE_DOC_LABELS = frozenset({"ktp", "surat_sehat"})
ALLOWED_IMAGE_EXT = {".png", ".jpg", ".jpeg", ".webp", ".gif"}
ALLOWED_DOC_EXT = ALLOWED_IMAGE_EXT | {".pdf"}
MAX_UPLOAD_BYTES = 5 * 1024 * 1024  # 5MB
MAX_REGISTRATION_FILES = 10
# In-process caps. A registration desk can still submit many forms; a script cannot flood the disk or guess codes.
PUBLIC_UPLOAD_LIMIT = 100
PUBLIC_UPLOAD_WINDOW_SEC = 600
PUBLIC_LOOKUP_LIMIT = 40
PUBLIC_LOOKUP_WINDOW_SEC = 600
LOGIN_LIMIT = 10
LOGIN_WINDOW_SEC = 300
PUBLIC_REGISTRATION_LIMIT = 10
PUBLIC_REGISTRATION_WINDOW_SEC = 600
_UPLOAD_READ_CHUNK = 64 * 1024
# Docker's default bridge address pool. nginx on that network is the only peer allowed to set X-Real-IP.
_DOCKER_PEER_NETS = (ipaddress.ip_network("172.16.0.0/12"),)
_UPLOAD_URL_RE = re.compile(r"^/api/uploads/([A-Za-z0-9][A-Za-z0-9._-]{0,180})$")
_PRIVATE_URL_RE = re.compile(r"^/api/private-uploads/([A-Za-z0-9][A-Za-z0-9._-]{0,180})$")
_PUBLIC_MATCH_HIDDEN = ("pending_votes", "approval_notes")

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

def _match_round_duration(match: Optional[Dict[str, Any]], rule: Optional[Dict[str, Any]]) -> int:
    """Partai may override the rule. An empty value keeps the rule duration."""
    raw = (match or {}).get("round_duration_sec")
    if raw not in (None, ""):
        try:
            value = int(raw)
        except (TypeError, ValueError):
            value = 0
        if value > 0:
            return value
    try:
        fallback = int((rule or {}).get("round_duration_sec") or 120)
    except (TypeError, ValueError):
        return 120
    return fallback if fallback > 0 else 120

def hash_password(pw: str) -> str:
    return bcrypt.hashpw(pw.encode(), bcrypt.gensalt()).decode()

def verify_password(pw: str, hashed: str) -> bool:
    try:
        return bcrypt.checkpw(pw.encode(), hashed.encode())
    except Exception:
        return False

def env_flag(name: str) -> bool:
    return os.environ.get(name, "").strip().lower() in {"1", "true", "yes", "on"}

def _check_new_password(value: str) -> str:
    if len(value or "") < MIN_PASSWORD_LENGTH:
        raise ValueError(f"Kata sandi minimal {MIN_PASSWORD_LENGTH} karakter")
    return value

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

    @field_validator("password")
    @classmethod
    def _password_len(cls, value: str) -> str:
        return _check_new_password(value)

class UserUpdateIn(BaseModel):
    email: Optional[EmailStr] = None
    password: Optional[str] = None
    name: Optional[str] = None
    role: Optional[str] = None

    @field_validator("password")
    @classmethod
    def _password_len(cls, value: Optional[str]) -> Optional[str]:
        if value is None or value == "":
            return value
        return _check_new_password(value)

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
    institution_name: str = ""
    institution_logo_url: str = ""
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
    jury_consensus_window_sec: int = Field(default=2, ge=1, le=10)
    technical_win_margin: int = Field(default=0, ge=0)
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
    round_duration_sec: Optional[int] = None

    @field_validator("round_duration_sec")
    @classmethod
    def _round_duration_positive(cls, value: Optional[int]) -> Optional[int]:
        if value is None:
            return None
        if value < 1:
            raise ValueError("Durasi ronde minimal 1 detik")
        return value

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

class BracketSlotSwapIn(BaseModel):
    slot_a: str
    slot_b: str

class BracketGenerateIn(BaseModel):
    event_id: str
    arena_id: str
    scoring_rule_id: str

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

REGISTRATION_NAME_MAX = 120
REGISTRATION_PHONE_MAX = 32
REGISTRATION_EMAIL_MAX = 254
REGISTRATION_ADDRESS_MAX = 500
OCCUPIED_REGISTRATION_STATUSES = ("accepted", "active_participant")
# Verified registrants belong on the athlete list. Later selection keeps that row;
# rejection and a return to revision remove it when the person is not already in a match.
ATHLETE_SYNC_STATUSES = (
    "verified",
    "selection_process",
    "accepted",
    "reserve",
    "active_participant",
)


def _bounded_text(value: Optional[str], limit: int, label: str) -> str:
    text = "" if value is None else str(value)
    if len(text) > limit:
        raise ValueError(f"{label} maksimal {limit} karakter")
    return text


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

    @field_validator("name")
    @classmethod
    def _limit_name(cls, value: str) -> str:
        return _bounded_text(value, REGISTRATION_NAME_MAX, "Nama")

    @field_validator("phone")
    @classmethod
    def _limit_phone(cls, value: str) -> str:
        return _bounded_text(value, REGISTRATION_PHONE_MAX, "Telepon")

    @field_validator("email")
    @classmethod
    def _limit_email(cls, value: str) -> str:
        return _bounded_text(value, REGISTRATION_EMAIL_MAX, "Email")

    @field_validator("address")
    @classmethod
    def _limit_address(cls, value: str) -> str:
        return _bounded_text(value, REGISTRATION_ADDRESS_MAX, "Alamat")

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
    access_code: str = ""

class RegistrationLookupIn(BaseModel):
    registration_number: str = ""
    access_code: str = ""

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


def _consensus_window_sec(rule: Optional[Dict[str, Any]]) -> int:
    raw = (rule or {}).get("jury_consensus_window_sec", JURY_CONSENSUS_WINDOW_SEC)
    try:
        window = int(raw)
    except (TypeError, ValueError):
        window = JURY_CONSENSUS_WINDOW_SEC
    return min(10, max(1, window))
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


def _safe_int(value: Any, default: int) -> int:
    try:
        number = int(value)
    except (TypeError, ValueError):
        return default
    return number


def _round_count(rule: Optional[Dict[str, Any]]) -> int:
    count = _safe_int((rule or {}).get("round_count"), 3)
    return count if count > 0 else 3


def _rest_seconds(rule: Optional[Dict[str, Any]]) -> int:
    rest = _safe_int((rule or {}).get("rest_duration_sec"), 0)
    return rest if rest > 0 else 0


def _clock_moved(before: Dict[str, Any], after: Dict[str, Any]) -> bool:
    if after is before:
        return False
    if before.get("status") != after.get("status"):
        return True
    if before.get("current_round") != after.get("current_round"):
        return True
    return (before.get("timer") or {}) != (after.get("timer") or {})


def _parked_round_timer(round_no: int, round_duration: int) -> Dict[str, Any]:
    return {
        "running": False,
        "remaining_sec": round_duration,
        "started_at": None,
        "round": round_no,
        "phase": "round",
    }


def _running_rest_timer(round_no: int, rest: int, now: datetime) -> Dict[str, Any]:
    return {
        "running": True,
        "remaining_sec": rest,
        "started_at": now.isoformat(),
        "round": round_no,
        "phase": "rest",
    }


async def _save_clock(match: Dict[str, Any], timer: Dict[str, Any], extra: Dict[str, Any]) -> Dict[str, Any]:
    """Save only if the round we observed is still current, so two expirations cannot skip a round."""
    observed = match.get("timer") or {}
    query: Dict[str, Any] = {
        "id": match["id"],
        "status": match.get("status"),
        "current_round": match.get("current_round"),
        "timer.phase": observed.get("phase") or "round",
    }
    result = await db.matches.update_one(query, {"$set": {"timer": timer, **extra}})
    if result.matched_count == 0:
        fresh = await db.matches.find_one({"id": match["id"]})
        return fresh or match
    updated = dict(match)
    updated["timer"] = timer
    updated.update(extra)
    return updated


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

    window_start = (datetime.now(timezone.utc) - timedelta(seconds=_consensus_window_sec(rule))).isoformat()
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
    """When a round clock hits zero, start the rest countdown. When rest hits zero, arm the next round at its full duration and wait for Mulai. The last round just pauses."""
    if not match or match.get("status") not in ("in_progress", "paused"):
        return match
    timer = dict(match.get("timer") or {})
    phase = timer.get("phase") or "round"
    now = datetime.now(timezone.utc)
    remaining = float(timer.get("remaining_sec") or 0)
    started_at = timer.get("started_at")
    running = bool(timer.get("running") and started_at)
    if running:
        try:
            started = datetime.fromisoformat(started_at)
            if started.tzinfo is None:
                started = started.replace(tzinfo=timezone.utc)
        except Exception:
            return match
        remaining = remaining - (now - started).total_seconds()
        if remaining > 0:
            return match
    elif phase == "rest" or remaining > 0 or match.get("status") != "paused" or not match.get("started_at"):
        return match

    rule = await db.scoring_rules.find_one({"id": match.get("scoring_rule_id")}) or {}
    round_duration = _match_round_duration(match, rule)
    round_no = _safe_int(timer.get("round") or match.get("current_round"), 1)
    cur = _safe_int(match.get("current_round"), round_no or 1)

    if phase == "rest":
        return await _save_clock(match, _parked_round_timer(round_no, round_duration), {"status": "paused"})

    total = _round_count(rule)
    if cur < total:
        nxt = cur + 1
        rest = _rest_seconds(rule)
        if rest > 0:
            return await _save_clock(
                match,
                _running_rest_timer(nxt, rest, now),
                {"current_round": nxt, "status": "in_progress"},
            )
        return await _save_clock(
            match,
            _parked_round_timer(nxt, round_duration),
            {"current_round": nxt, "status": "paused"},
        )

    if match.get("status") == "paused" and not running:
        return match
    stopped = {
        "running": False,
        "remaining_sec": 0,
        "started_at": None,
        "round": cur,
        "phase": "round",
    }
    return await _save_clock(match, stopped, {"status": "paused"})


async def _expire_running_matches_loop():
    while True:
        try:
            matches = await db.matches.find({"status": "in_progress", "timer.running": True}).to_list(200)
            for match in matches:
                updated = await settle_expired_timer(match)
                if _clock_moved(match, updated):
                    await broadcast_match_update(match["id"], "timer_update")
        except Exception as e:
            logger.warning("timer expire loop: %s", e)
        await asyncio.sleep(1)


async def _load_match_settled(mid: str) -> Optional[Dict[str, Any]]:
    match = await db.matches.find_one({"id": mid})
    if not match:
        return None
    updated = await settle_expired_timer(match)
    if _clock_moved(match, updated):
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
    match["status"] = "finished"
    match["winner_corner"] = winner_corner
    match["decision_method"] = decision_method
    match["timer"] = timer


async def _maybe_technical_win(match: Dict[str, Any], rule: Dict[str, Any], log_id: str) -> bool:
    """Finish the match when the score gap reaches a configured margin above 0."""
    if (match.get("discipline") or "tanding") != "tanding":
        return False
    if match.get("status") in ("finished", "approved"):
        return False
    try:
        margin = int(rule.get("technical_win_margin") or 0)
    except (TypeError, ValueError):
        margin = 0
    if margin <= 0:
        return False
    state = await compute_match_state(match["id"])
    red_score = int((state.get("red") or {}).get("score") or 0)
    blue_score = int((state.get("blue") or {}).get("score") or 0)
    if abs(red_score - blue_score) < margin or red_score == blue_score:
        return False
    winner = "red" if red_score > blue_score else "blue"
    await db.score_logs.update_one({"id": log_id}, {"$set": {"technical_win": True}})
    await _finish_match_decision(match, winner, "menang_teknik")
    return True

def redact_public_match(state: Optional[Dict[str, Any]]) -> Dict[str, Any]:
    """Drop jury-only fields before a payload leaves the public API or public sockets."""
    if not state:
        return {}
    out = dict(state)
    for key in _PUBLIC_MATCH_HIDDEN:
        out.pop(key, None)
    return out

async def broadcast_match_update(match_id: str, event_type: str = "update"):
    state = await compute_match_state(match_id)
    if not state:
        return
    full = {"type": event_type, "match_id": match_id, "state": state}
    public = {"type": event_type, "match_id": match_id, "state": redact_public_match(state)}
    arena_id = state.get("arena_id")
    if arena_id:
        await manager.broadcast(f"arena:{arena_id}", public)
    await manager.broadcast(f"public:{match_id}", public)
    await manager.broadcast(f"match:{match_id}", full)

# ============ Routes: Auth ============
@api.post("/auth/login")
async def login(data: LoginIn, request: Request):
    enforce_rate_limit(request, "login", LOGIN_LIMIT, LOGIN_WINDOW_SEC)
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

# ============ Upload bytes, client IP, and in-process rate limits ============
def _coerce_ip(value: str):
    raw = (value or "").strip()
    if raw.startswith("[") and raw.endswith("]"):
        raw = raw[1:-1]
    raw = raw.split("%", 1)[0].strip()
    if not raw:
        return None
    try:
        ip = ipaddress.ip_address(raw)
    except ValueError:
        return None
    if isinstance(ip, ipaddress.IPv6Address) and ip.ipv4_mapped is not None:
        return ip.ipv4_mapped
    return ip

def _is_docker_peer(host: str) -> bool:
    ip = _coerce_ip(host)
    if not isinstance(ip, ipaddress.IPv4Address):
        return False
    return any(ip in net for net in _DOCKER_PEER_NETS)

def client_ip(request: Request) -> str:
    """Real client address. Trust X-Real-IP only when the TCP peer is on the Docker network.

    Uvicorn must not rewrite that peer from X-Forwarded-For. Nginx overwrites
    X-Real-IP with the visitor address (CF-Connecting-IP behind Cloudflare).
    """
    peer = request.client.host if request.client and request.client.host else ""
    if _is_docker_peer(peer):
        forwarded = _coerce_ip(request.headers.get("x-real-ip") or "")
        if forwarded is not None:
            return str(forwarded)
    return peer or "unknown"

_rate_lock = threading.Lock()
_rate_hits: Dict[str, deque] = {}

def enforce_rate_limit(request: Request, bucket: str, limit: int, window_sec: float) -> None:
    ip = client_ip(request)
    key = f"{bucket}:{ip}"
    now = time.monotonic()
    cutoff = now - window_sec
    with _rate_lock:
        hits = _rate_hits.get(key)
        if hits is None:
            hits = deque()
            _rate_hits[key] = hits
        while hits and hits[0] <= cutoff:
            hits.popleft()
        if len(hits) >= limit:
            raise HTTPException(429, "Terlalu banyak permintaan. Coba lagi beberapa saat lagi.")
        hits.append(now)
        if len(_rate_hits) > 4000:
            stale = [k for k, dq in _rate_hits.items() if not dq or dq[-1] <= cutoff]
            for k in stale:
                _rate_hits.pop(k, None)

def _sniff_upload_ext(data: bytes) -> Optional[str]:
    """Canonical extension from file contents. Filename is not trusted."""
    if data.startswith(b"\xff\xd8\xff"):
        return ".jpg"
    if data.startswith(b"\x89PNG\r\n\x1a\n"):
        return ".png"
    if data.startswith(b"GIF87a") or data.startswith(b"GIF89a"):
        return ".gif"
    if len(data) >= 12 and data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        return ".webp"
    if data.startswith(b"%PDF-"):
        return ".pdf"
    return None

async def _read_upload_bounded(file: UploadFile) -> bytes:
    """Read until EOF or one byte past the cap, then stop. The rest is not kept."""
    buf = bytearray()
    try:
        while True:
            chunk = await file.read(_UPLOAD_READ_CHUNK)
            if not chunk:
                break
            if len(buf) + len(chunk) > MAX_UPLOAD_BYTES:
                raise HTTPException(400, f"Ukuran file melebihi {MAX_UPLOAD_BYTES // (1024*1024)}MB")
            buf.extend(chunk)
    finally:
        try:
            await file.close()
        except Exception:
            pass
    if not buf:
        raise HTTPException(400, "File kosong")
    return bytes(buf)

async def _save_checked_upload(file: UploadFile, allowed_ext: set, *, private: bool = False) -> Dict[str, Any]:
    data = await _read_upload_bounded(file)
    ext = _sniff_upload_ext(data)
    if ext not in allowed_ext:
        raise HTTPException(400, f"Format tidak didukung. Gunakan: {', '.join(sorted(allowed_ext))}")
    fname = f"{new_id()}{ext}"
    folder = PRIVATE_UPLOAD_DIR if private else UPLOAD_DIR
    folder.mkdir(parents=True, exist_ok=True)
    fpath = folder / fname
    with open(fpath, "wb") as f:
        f.write(data)
    prefix = "/api/private-uploads" if private else "/api/uploads"
    return {"url": f"{prefix}/{fname}", "filename": fname, "size": len(data)}

def _upload_path_in(root: Path, pattern: re.Pattern, url: str) -> Path:
    match = pattern.fullmatch((url or "").strip())
    if not match:
        raise HTTPException(400, "URL berkas tidak valid")
    base = root.resolve()
    path = (base / match.group(1)).resolve()
    if path.parent != base or not path.is_file():
        raise HTTPException(400, "Berkas tidak ditemukan")
    return path

def _local_upload_path(url: str) -> Path:
    return _upload_path_in(UPLOAD_DIR, _UPLOAD_URL_RE, url)

def _private_upload_path(url: str) -> Path:
    return _upload_path_in(PRIVATE_UPLOAD_DIR, _PRIVATE_URL_RE, url)

def _is_private_doc(label: str) -> bool:
    return (label or "").strip().lower() in PRIVATE_DOC_LABELS

# ============ Routes: File Uploads (local disk) ============
@api.post("/uploads/photo")
async def upload_photo(file: UploadFile = File(...), user=Depends(get_current_user)):
    if user["role"] not in ("admin", "operator"):
        raise HTTPException(403, "Hanya admin/operator yang dapat unggah foto")
    return await _save_checked_upload(file, ALLOWED_IMAGE_EXT)

@api.post("/public/uploads/document")
async def public_upload_document(request: Request, file: UploadFile = File(...), label: str = Form("")):
    enforce_rate_limit(request, "public_upload", PUBLIC_UPLOAD_LIMIT, PUBLIC_UPLOAD_WINDOW_SEC)
    return await _save_checked_upload(file, ALLOWED_DOC_EXT, private=_is_private_doc(label))

@api.get("/uploads/{filename}")
async def serve_public_upload(filename: str):
    """Foto atlet dan logo event. Berkas di uploads/private tidak bisa diambil dari sini."""
    try:
        path = _local_upload_path(f"/api/uploads/{filename}")
    except HTTPException:
        raise HTTPException(404, "Berkas tidak ditemukan")
    return FileResponse(path)

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
    out["institution_name"] = out.get("institution_name") or ""
    out["institution_logo_url"] = out.get("institution_logo_url") or ""
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
    class_rows = await db.classes.find({"event_id": eid}, {"id": 1}).to_list(5000)
    category_rows = await db.categories.find({"event_id": eid}, {"id": 1}).to_list(5000)
    quota_ids = [f"class:{row['id']}" for row in class_rows] + [f"category:{row['id']}" for row in category_rows]
    if quota_ids:
        await db.acceptance_quotas.delete_many({"_id": {"$in": quota_ids}})
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

def _used_by_message(label: str, used: List[str]) -> str:
    if len(used) == 1:
        joined = used[0]
    elif len(used) == 2:
        joined = f"{used[0]} dan {used[1]}"
    else:
        joined = ", ".join(used[:-1]) + f", dan {used[-1]}"
    return f"{label} masih dipakai oleh {joined}"

async def _reject_if_referenced(label: str, checks: List[tuple]) -> None:
    used: List[str] = []
    for reason, collection, query in checks:
        if reason in used:
            continue
        if await collection.find_one(query, {"_id": 1}):
            used.append(reason)
    if used:
        raise HTTPException(409, _used_by_message(label, used))

_REG_STATUS_LABEL = {
    "draft": "Draf",
    "pending_verification": "Menunggu verifikasi",
    "need_revision": "Perlu revisi",
    "verification_rejected": "Verifikasi ditolak",
    "verified": "Terverifikasi",
    "selection_process": "Seleksi",
    "accepted": "Diterima",
    "reserve": "Cadangan",
    "rejected": "Ditolak",
    "active_participant": "Peserta aktif",
}
_MATCH_STATUS_LABEL = {
    "scheduled": "Terjadwal",
    "in_progress": "Berlangsung",
    "paused": "Dijeda",
    "finished": "Selesai",
    "approved": "Disahkan",
}

def _mapped_label(mapping: Dict[str, str], value: Any) -> str:
    if value in (None, ""):
        return ""
    return mapping.get(str(value), str(value))

def _fill_sheet(ws, headers: List[str], rows: List[List[Any]]) -> None:
    from openpyxl.styles import Font
    bold = Font(bold=True)
    ws.append(headers)
    for cell in ws[1]:
        cell.font = bold
    for row in rows:
        ws.append(["" if value is None else value for value in row])
    if headers:
        ws.freeze_panes = "A2"
        last_col = ws.cell(1, len(headers)).column_letter
        ws.auto_filter.ref = f"A1:{last_col}{ws.max_row or 1}"

async def _corner_scores(match_ids: List[str]) -> Dict[str, Dict[str, int]]:
    scores: Dict[str, Dict[str, int]] = {}
    if not match_ids:
        return scores
    cursor = db.score_logs.find(
        {"match_id": {"$in": match_ids}, "valid": {"$ne": False}},
        {"_id": 0, "match_id": 1, "corner": 1, "action_type": 1, "points": 1},
    )
    async for log in cursor:
        bucket = scores.setdefault(log.get("match_id"), {"red": 0, "blue": 0})
        kind = log.get("action_type")
        corner = log.get("corner")
        try:
            pts = int(log.get("points") or 0)
        except (TypeError, ValueError):
            pts = 0
        if kind in ("score", "fall") and corner in ("red", "blue"):
            bucket[corner] += pts
        elif kind == "penalty" and corner in ("red", "blue"):
            bucket["blue" if corner == "red" else "red"] += pts
    return scores

def _winner_label(match: Dict[str, Any], names: Dict[str, str]) -> str:
    corner = match.get("winner_corner")
    if corner == "draw":
        return "Seri"
    if corner == "red":
        return names.get(match.get("red_athlete_id") or "", "Merah")
    if corner == "blue":
        return names.get(match.get("blue_athlete_id") or "", "Biru")
    return ""

def _seni_names(match: Dict[str, Any], names: Dict[str, str]) -> str:
    if (match.get("discipline") or "tanding") == "tanding":
        return ""
    ids: List[str] = []
    if match.get("red_athlete_id"):
        ids.append(match["red_athlete_id"])
    for pid in match.get("performer_ids") or []:
        if pid and pid not in ids:
            ids.append(pid)
    if match.get("blue_athlete_id") and match["blue_athlete_id"] not in ids:
        ids.append(match["blue_athlete_id"])
    return ", ".join(names.get(pid) or pid for pid in ids)

@api.get("/events/{eid}/export.xlsx")
async def export_event_xlsx(eid: str, user=Depends(require_roles("admin", "operator"))):
    event = await db.events.find_one({"id": eid}, {"_id": 0, "name": 1, "code": 1, "slug": 1})
    if not event:
        raise HTTPException(404, "Event tidak ditemukan")
    try:
        from openpyxl import Workbook
    except ImportError:
        raise HTTPException(500, "Paket openpyxl belum terpasang")

    regs = await db.registrations.find(
        {"event_id": eid},
        {"_id": 0, "access_code": 0, "history": 0},
    ).sort("created_at", 1).to_list(10000)
    await _hydrate_registrations(regs)
    athletes = await db.athletes.find({"event_id": eid}, {"_id": 0}).sort("name", 1).to_list(10000)
    matches = await db.matches.find({"event_id": eid}, {"_id": 0}).sort("match_number", 1).to_list(5000)
    arenas = await _lookup_names(db.arenas, {m.get("arena_id") for m in matches})
    classes = await _lookup_names(db.classes, {a.get("class_id") for a in athletes} | {m.get("class_id") for m in matches} | {r.get("class_id") for r in regs})
    categories = await _lookup_names(db.categories, {a.get("category_id") for a in athletes} | {m.get("category_id") for m in matches} | {r.get("category_id") for r in regs})
    contingents = await _lookup_names(db.contingents, {a.get("contingent_id") for a in athletes})
    rules = {
        rule["id"]: rule
        for rule in await db.scoring_rules.find({"event_id": eid}, {"_id": 0, "id": 1, "round_duration_sec": 1}).to_list(200)
    }
    names = {a["id"]: a.get("name") or "" for a in athletes if a.get("id")}
    scores = await _corner_scores([m["id"] for m in matches if m.get("id")])

    reg_rows = [[
        r.get("registration_number") or "",
        r.get("name") or "",
        r.get("gender") or "",
        r.get("dob") or "",
        r.get("weight") if r.get("weight") is not None else "",
        r.get("phone") or "",
        r.get("email") or "",
        r.get("address") or "",
        r.get("contingent_name") or "",
        r.get("category_name") or categories.get(r.get("category_id") or "", ""),
        r.get("class_name") or classes.get(r.get("class_id") or "", ""),
        _mapped_label(_REG_STATUS_LABEL, r.get("status")),
        r.get("participant_number") or "",
        r.get("created_at") or "",
    ] for r in regs]
    athlete_rows = [[
        a.get("participant_number") or "",
        a.get("name") or "",
        a.get("gender") or "",
        a.get("dob") or "",
        a.get("weight") if a.get("weight") is not None else "",
        a.get("phone") or "",
        contingents.get(a.get("contingent_id") or "", ""),
        categories.get(a.get("category_id") or "", ""),
        classes.get(a.get("class_id") or "", ""),
        a.get("status") or "",
        a.get("source") or "",
    ] for a in athletes]
    match_rows = []
    for match in matches:
        corner = scores.get(match.get("id"), {"red": 0, "blue": 0})
        seni_score = match.get("seni_final_score")
        match_rows.append([
            match.get("match_number") if match.get("match_number") is not None else "",
            match.get("discipline") or "tanding",
            arenas.get(match.get("arena_id") or "", ""),
            categories.get(match.get("category_id") or "", ""),
            classes.get(match.get("class_id") or "", ""),
            match.get("round_label") or "",
            names.get(match.get("red_athlete_id") or "", ""),
            names.get(match.get("blue_athlete_id") or "", ""),
            _seni_names(match, names),
            _mapped_label(_MATCH_STATUS_LABEL, match.get("status")),
            _winner_label(match, names),
            match.get("decision_method") or "",
            corner["red"],
            corner["blue"],
            "" if seni_score is None else seni_score,
            _match_round_duration(match, rules.get(match.get("scoring_rule_id"))),
        ])

    wb = Workbook()
    reg_sheet = wb.active
    reg_sheet.title = "Registrasi"
    _fill_sheet(reg_sheet, [
        "Nomor Registrasi", "Nama", "Gender", "Tanggal Lahir", "Berat", "Telepon", "Email", "Alamat",
        "Kontingen", "Kategori", "Kelas", "Status", "Nomor Peserta", "Dibuat",
    ], reg_rows)
    athlete_sheet = wb.create_sheet("Atlet")
    _fill_sheet(athlete_sheet, [
        "Nomor Peserta", "Nama", "Gender", "Tanggal Lahir", "Berat", "Telepon",
        "Kontingen", "Kategori", "Kelas", "Status", "Sumber",
    ], athlete_rows)
    result_sheet = wb.create_sheet("Hasil Partai")
    _fill_sheet(result_sheet, [
        "Nomor Partai", "Disiplin", "Gelanggang", "Kategori", "Kelas", "Babak",
        "Sudut Merah", "Sudut Biru", "Pesilat Seni", "Status", "Pemenang", "Metode",
        "Skor Merah", "Skor Biru", "Nilai Seni", "Durasi Ronde (detik)",
    ], match_rows)

    buf = io.BytesIO()
    wb.save(buf)
    safe = re.sub(r"[^A-Za-z0-9._-]+", "-", str(event.get("code") or event.get("slug") or "event")).strip("-") or "event"
    filename = f"{safe}-export.xlsx"
    return Response(
        content=buf.getvalue(),
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )

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
    await _reject_if_referenced("Kategori", [
        ("partai", db.matches, {"category_id": cid}),
        ("registrasi", db.registrations, {"category_id": cid}),
        ("atlet", db.athletes, {"category_id": cid}),
    ])
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
    await _reject_if_referenced("Kelas", [
        ("partai", db.matches, {"class_id": cid}),
        ("registrasi", db.registrations, {"class_id": cid}),
        ("atlet", db.athletes, {"class_id": cid}),
    ])
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
    await _reject_if_referenced("Kontingen", [
        ("registrasi", db.registrations, {"contingent_id": cid}),
        ("atlet", db.athletes, {"contingent_id": cid}),
    ])
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
    await _backfill_athletes_from_registrations(event_id)
    q = {"event_id": event_id} if event_id else {}
    return await list_collection(db.athletes, q)

@api.delete("/athletes/{aid}")
async def delete_athlete(aid: str, user=Depends(require_roles("admin"))):
    await _reject_if_referenced("Atlet", [
        ("partai", db.matches, {"$or": [
            {"red_athlete_id": aid},
            {"blue_athlete_id": aid},
            {"performer_ids": aid},
        ]}),
        ("registrasi", db.registrations, {"athlete_id": aid}),
    ])
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
async def _lookup_names(collection, ids: set) -> Dict[str, str]:
    clean = [i for i in ids if i]
    if not clean:
        return {}
    docs = await collection.find({"id": {"$in": clean}}, {"_id": 0, "id": 1, "name": 1}).to_list(len(clean))
    return {d["id"]: d.get("name") or "" for d in docs}

async def _hydrate_registrations(regs: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """Attach files plus display names for contingent, category, and class."""
    if not regs:
        return regs
    ids = [r["id"] for r in regs if r.get("id")]
    files = await db.registration_files.find({"registration_id": {"$in": ids}}, {"_id": 0}).to_list(max(len(ids) * 10, 1))
    files_by_reg: Dict[str, list] = {}
    for f in files:
        files_by_reg.setdefault(f.get("registration_id"), []).append(f)
    contingents = await _lookup_names(db.contingents, {r.get("contingent_id") for r in regs})
    categories = await _lookup_names(db.categories, {r.get("category_id") for r in regs})
    classes = await _lookup_names(db.classes, {r.get("class_id") for r in regs})
    for r in regs:
        r["files"] = files_by_reg.get(r.get("id"), [])
        if r.get("contingent_id") and not (r.get("contingent_name") or "").strip():
            r["contingent_name"] = contingents.get(r["contingent_id"], "")
        r["category_name"] = categories.get(r.get("category_id") or "", "")
        r["class_name"] = classes.get(r.get("class_id") or "", "")
    return regs

async def _hydrate_registration(reg: Dict[str, Any]) -> Dict[str, Any]:
    await _hydrate_registrations([reg])
    return reg

_PUBLIC_LOOKUP_DENIED = "Nomor atau kode akses tidak sesuai"

def _access_codes_match(stored: str, provided: str) -> bool:
    left = stored or ""
    right = provided or ""
    if not left or not right or len(left) != len(right):
        return False
    return hmac.compare_digest(left, right)

async def _ensure_access_code(reg: Dict[str, Any]) -> Dict[str, Any]:
    """Create an access code for registrations saved before codes existed."""
    if (reg.get("access_code") or "").strip():
        return reg
    code = secrets.token_urlsafe(6)
    updated = await db.registrations.find_one_and_update(
        {
            "id": reg["id"],
            "$or": [
                {"access_code": {"$exists": False}},
                {"access_code": None},
                {"access_code": ""},
            ],
        },
        {"$set": {"access_code": code}},
        projection={"_id": 0},
        return_document=ReturnDocument.AFTER,
    )
    if updated:
        return updated
    fresh = await db.registrations.find_one({"id": reg["id"]}, {"_id": 0})
    return fresh or reg

@api.post("/public/registrations")
async def public_create_registration(data: RegistrationIn, request: Request):
    enforce_rate_limit(request, "public_registration", PUBLIC_REGISTRATION_LIMIT, PUBLIC_REGISTRATION_WINDOW_SEC)
    # Validate event exists and is active for registration
    _normalize_registration_ids(data)
    ev = await db.events.find_one({"id": data.event_id}, {"_id": 0})
    if not ev:
        raise HTTPException(404, "Event tidak ditemukan")
    if ev.get("status") not in ("active", "registration_open"):
        # Allow by default; admin closes by setting status to "closed"
        if ev.get("status") == "closed":
            raise HTTPException(400, "Pendaftaran event ini sudah ditutup")
    if ev.get("registration_enabled") is False:
        raise HTTPException(400, "Pendaftaran event ini belum dibuka")
    await _validate_registration_placement(data)
    seq = await next_seq(f"registration:{data.event_id}")
    reg_number = fmt_number("REG", ev.get("code") or ev.get("name") or "EVENT", seq)
    doc = data.model_dump()
    doc.update({
        "id": new_id(),
        "registration_number": reg_number,
        "access_code": secrets.token_urlsafe(6),
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
    reg = await db.registrations.find_one({"id": rid}, {"_id": 0, "id": 1, "access_code": 1})
    if not reg:
        raise HTTPException(404, "Registrasi tidak ditemukan")
    if not _access_codes_match(reg.get("access_code") or "", (data.access_code or "").strip()):
        raise HTTPException(403, "Kode akses tidak valid")
    label = (data.label or "").strip()
    if _is_private_doc(label):
        path = _private_upload_path(data.url)
        stored_url = f"/api/private-uploads/{path.name}"
    else:
        path = _local_upload_path(data.url)
        stored_url = f"/api/uploads/{path.name}"
    count = await db.registration_files.count_documents({"registration_id": rid})
    if count >= MAX_REGISTRATION_FILES:
        raise HTTPException(400, f"Jumlah berkas melebihi batas ({MAX_REGISTRATION_FILES})")
    rec = {
        "id": new_id(),
        "registration_id": rid,
        "label": label or data.label,
        "url": stored_url,
        "uploaded_at": now_iso(),
    }
    await db.registration_files.insert_one(rec)
    rec.pop("_id", None)
    return rec

def _registration_file_path(rec: Dict[str, Any]) -> Path:
    url = (rec.get("url") or "").strip()
    if _PRIVATE_URL_RE.fullmatch(url):
        return _private_upload_path(url)
    return _local_upload_path(url)

@api.post("/public/registrations/lookup")
async def public_lookup_registration(data: RegistrationLookupIn, request: Request):
    """Status check for the participant who has both the number and the access code.

    A wrong number and a wrong code return the same message so numbers cannot be enumerated.
    """
    enforce_rate_limit(request, "public_lookup", PUBLIC_LOOKUP_LIMIT, PUBLIC_LOOKUP_WINDOW_SEC)
    number = (data.registration_number or "").strip()
    code = (data.access_code or "").strip()
    reg = None
    if number:
        reg = await db.registrations.find_one({"registration_number": number}, {"_id": 0})
    stored = ((reg or {}).get("access_code") or "").strip()
    if not reg or not _access_codes_match(stored, code):
        raise HTTPException(404, _PUBLIC_LOOKUP_DENIED)
    reg.pop("access_code", None)
    reg.pop("admin_notes", None)
    hydrated = await _hydrate_registration(reg)
    hydrated.pop("access_code", None)
    hydrated.pop("admin_notes", None)
    return hydrated

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
    return await _hydrate_registrations(regs)

@api.get("/registrations/{rid}")
async def get_registration(rid: str, user=Depends(require_roles("admin", "operator"))):
    reg = await db.registrations.find_one({"id": rid}, {"_id": 0})
    if not reg:
        raise HTTPException(404, "Registrasi tidak ditemukan")
    reg = await _ensure_access_code(reg)
    return await _hydrate_registration(reg)

@api.put("/registrations/{rid}")
async def update_registration(rid: str, data: RegistrationIn, user=Depends(require_roles("admin", "operator"))):
    existing = await db.registrations.find_one({"id": rid})
    if not existing:
        raise HTTPException(404, "Registrasi tidak ditemukan")
    _normalize_registration_ids(data)
    await _validate_registration_placement(data)
    payload = data.model_dump()
    merged = {**existing, **payload}
    if _occupies_acceptance_slot(existing.get("status")):
        await _retarget_acceptance_slots(existing, merged)
        result = await db.registrations.update_one(
            {"id": rid, "status": existing.get("status")},
            {"$set": {**payload, "updated_at": now_iso()}},
        )
        if result.matched_count == 0:
            await _retarget_acceptance_slots(merged, existing)
            raise HTTPException(409, "Status registrasi berubah, silakan ulangi")
    else:
        result = await db.registrations.update_one({"id": rid}, {"$set": {**payload, "updated_at": now_iso()}})
        if result.matched_count == 0:
            raise HTTPException(404, "Registrasi tidak ditemukan")
    reg = await db.registrations.find_one({"id": rid}, {"_id": 0})
    if reg and reg.get("status") in ATHLETE_SYNC_STATUSES:
        try:
            await _ensure_athlete_for_registration(reg)
            reg = await db.registrations.find_one({"id": rid}, {"_id": 0})
        except Exception as exc:
            print(f"[athletes] sync failed for reg {rid}: {exc}")
    return await _hydrate_registration(reg)

@api.delete("/registrations/{rid}")
async def delete_registration(rid: str, user=Depends(require_roles("admin"))):
    reg = await db.registrations.find_one({"id": rid})
    if reg and _occupies_acceptance_slot(reg.get("status")):
        targets = _quota_targets(reg)
        for scope, scope_id in targets:
            await _ensure_quota_counter(scope, scope_id)
        removed = await db.registrations.delete_one({"id": rid, "status": {"$in": list(OCCUPIED_REGISTRATION_STATUSES)}})
        if removed.deleted_count:
            for scope, scope_id in targets:
                await _release_quota_slot(scope, scope_id, seed=False)
        else:
            await db.registrations.delete_one({"id": rid})
    else:
        removed = await db.registrations.delete_one({"id": rid, "status": {"$nin": list(OCCUPIED_REGISTRATION_STATUSES)}})
        if removed.deleted_count == 0:
            fresh = await db.registrations.find_one({"id": rid})
            if fresh and _occupies_acceptance_slot(fresh.get("status")):
                targets = _quota_targets(fresh)
                for scope, scope_id in targets:
                    await _ensure_quota_counter(scope, scope_id)
                gone = await db.registrations.delete_one({"id": rid, "status": {"$in": list(OCCUPIED_REGISTRATION_STATUSES)}})
                if gone.deleted_count:
                    for scope, scope_id in targets:
                        await _release_quota_slot(scope, scope_id, seed=False)
            elif fresh:
                await db.registrations.delete_one({"id": rid})
    await db.registration_files.delete_many({"registration_id": rid})
    still = await db.registrations.find_one({"id": rid}, {"_id": 1})
    if not still and reg:
        try:
            await _drop_athlete_for_registration(reg, clear_link=False)
        except Exception as exc:
            print(f"[athletes] cleanup failed for reg {rid}: {exc}")
    return {"ok": True}

@api.get("/registrations/{rid}/files/{fid}")
async def download_registration_file(rid: str, fid: str, user=Depends(require_roles("admin", "operator"))):
    """KTP and health letters. The access code stays out of the URL and the access log."""
    rec = await db.registration_files.find_one({"id": fid, "registration_id": rid}, {"_id": 0})
    if not rec:
        raise HTTPException(404, "Berkas tidak ditemukan")
    try:
        path = _registration_file_path(rec)
    except HTTPException:
        raise HTTPException(404, "Berkas tidak ditemukan")
    return FileResponse(path, content_disposition_type="inline")

@api.delete("/registrations/{rid}/files/{fid}")
async def delete_registration_file(rid: str, fid: str, user=Depends(require_roles("admin", "operator"))):
    await db.registration_files.delete_one({"id": fid, "registration_id": rid})
    return {"ok": True}

def _clean_id(value: Optional[str]) -> Optional[str]:
    if value is None:
        return None
    text = str(value).strip()
    return text or None


def _normalize_registration_ids(data: RegistrationIn) -> None:
    data.category_id = _clean_id(data.category_id)
    data.class_id = _clean_id(data.class_id)
    data.contingent_id = _clean_id(data.contingent_id)


def _occupies_acceptance_slot(status: Optional[str]) -> bool:
    return status in OCCUPIED_REGISTRATION_STATUSES


def _quota_doc_id(scope: str, scope_id: str) -> str:
    return f"{scope}:{scope_id}"


def _quota_targets(reg: Dict[str, Any]) -> List[tuple]:
    targets = []
    class_id = _clean_id(reg.get("class_id"))
    category_id = _clean_id(reg.get("category_id"))
    if class_id:
        targets.append(("class", class_id))
    if category_id:
        targets.append(("category", category_id))
    return targets


def _format_kg(value: float) -> str:
    number = float(value)
    if number.is_integer():
        return str(int(number))
    return format(number, "f").rstrip("0").rstrip(".")


def _weight_bounds(kelas: Dict[str, Any]) -> tuple:
    try:
        raw_min = kelas.get("weight_min")
        raw_max = kelas.get("weight_max")
        weight_min = float(0 if raw_min is None else raw_min)
        weight_max = float(0 if raw_max is None else raw_max)
    except (TypeError, ValueError):
        raise HTTPException(400, "Data kelas rusak: rentang berat tidak valid")
    return weight_min, weight_max


async def _validate_registration_placement(data: RegistrationIn) -> None:
    """Category is required and must belong to the event. Gender must match (`campuran` accepts both).

    Gender is checked before a missing tanding class. A class range other than 0–0 includes its bounds.
    """
    category_id = _clean_id(data.category_id)
    class_id = _clean_id(data.class_id)
    if not category_id:
        raise HTTPException(400, "Kategori wajib diisi")
    category = await db.categories.find_one(
        {"id": category_id},
        {"_id": 0, "event_id": 1, "gender": 1, "type": 1},
    )
    if not category or category.get("event_id") != data.event_id:
        raise HTTPException(400, "Kategori bukan milik event ini")
    category_gender = category.get("gender") or "putra"
    if category_gender != "campuran" and data.gender != category_gender:
        raise HTTPException(400, "Gender peserta tidak sesuai dengan kategori")
    if (category.get("type") or "tanding") == "tanding" and not class_id:
        raise HTTPException(400, "Kelas wajib untuk kategori tanding")
    if not class_id:
        return
    kelas = await db.classes.find_one(
        {"id": class_id},
        {"_id": 0, "event_id": 1, "category_id": 1, "name": 1, "weight_min": 1, "weight_max": 1},
    )
    if not kelas or kelas.get("event_id") != data.event_id:
        raise HTTPException(400, "Kelas bukan milik event ini")
    if kelas.get("category_id") != category_id:
        raise HTTPException(400, "Kelas bukan bagian dari kategori yang dipilih")
    weight_min, weight_max = _weight_bounds(kelas)
    if weight_min > weight_max:
        raise HTTPException(400, "Data kelas rusak: berat minimum lebih besar dari berat maksimum")
    if weight_min == 0 and weight_max == 0:
        return
    weight = float(data.weight or 0)
    if weight_min <= weight <= weight_max:
        return
    name = (kelas.get("name") or "").strip() or "Kelas"
    raise HTTPException(
        400,
        f"Berat {_format_kg(weight)} kg di luar rentang {name} ({_format_kg(weight_min)}\u2013{_format_kg(weight_max)} kg)",
    )


async def _lookup_quota(scope: str, scope_id: str) -> int:
    coll = db.classes if scope == "class" else db.categories
    doc = await coll.find_one({"id": scope_id}, {"quota": 1})
    try:
        return int((doc or {}).get("quota") or 0)
    except (TypeError, ValueError):
        return 0


async def _ensure_quota_counter(scope: str, scope_id: str) -> None:
    """Create the counter from registrations already occupying a slot, once."""
    key = _quota_doc_id(scope, scope_id)
    existing = await db.acceptance_quotas.find_one({"_id": key}, {"_id": 1})
    if existing:
        return
    field = "class_id" if scope == "class" else "category_id"
    used = await db.registrations.count_documents({
        field: scope_id,
        "status": {"$in": list(OCCUPIED_REGISTRATION_STATUSES)},
    })
    try:
        await db.acceptance_quotas.insert_one({
            "_id": key,
            "scope": scope,
            "scope_id": scope_id,
            "used": int(used),
            "quota": 0,
        })
    except DuplicateKeyError:
        return


async def _acquire_quota_slot(scope: str, scope_id: str) -> None:
    """Increment one class or category counter. Limited quotas only move while used < quota."""
    quota = await _lookup_quota(scope, scope_id)
    key = _quota_doc_id(scope, scope_id)
    await _ensure_quota_counter(scope, scope_id)
    label = "kelas" if scope == "class" else "kategori"
    fields = {"quota": quota, "scope": scope, "scope_id": scope_id}
    if quota <= 0:
        await db.acceptance_quotas.update_one({"_id": key}, {"$inc": {"used": 1}, "$set": fields})
        return
    updated = await db.acceptance_quotas.find_one_and_update(
        {"_id": key, "used": {"$lt": quota}},
        {"$inc": {"used": 1}, "$set": fields},
        return_document=ReturnDocument.AFTER,
    )
    if updated:
        return
    current = await db.acceptance_quotas.find_one({"_id": key}, {"used": 1})
    used = int((current or {}).get("used") or quota)
    raise HTTPException(400, f"Kuota {label} penuh ({used}/{quota}). Jadikan cadangan atau tolak.")


async def _release_quota_slot(scope: str, scope_id: str, *, seed: bool = True) -> None:
    key = _quota_doc_id(scope, scope_id)
    if seed:
        await _ensure_quota_counter(scope, scope_id)
    await db.acceptance_quotas.update_one({"_id": key, "used": {"$gt": 0}}, {"$inc": {"used": -1}})


async def _acquire_acceptance_slots(reg: Dict[str, Any]) -> None:
    acquired: List[tuple] = []
    try:
        for scope, scope_id in _quota_targets(reg):
            await _acquire_quota_slot(scope, scope_id)
            acquired.append((scope, scope_id))
    except HTTPException:
        for scope, scope_id in reversed(acquired):
            await _release_quota_slot(scope, scope_id, seed=False)
        raise


async def _release_acceptance_slots(reg: Dict[str, Any], *, seed: bool = True) -> None:
    for scope, scope_id in _quota_targets(reg):
        await _release_quota_slot(scope, scope_id, seed=seed)


async def _retarget_acceptance_slots(old_reg: Dict[str, Any], new_reg: Dict[str, Any]) -> None:
    """Move an occupied slot when class or category changes. Same ids are left untouched."""
    old_targets = _quota_targets(old_reg)
    new_targets = _quota_targets(new_reg)
    old_set = set(old_targets)
    new_set = set(new_targets)
    acquired: List[tuple] = []
    try:
        for scope, scope_id in new_targets:
            if (scope, scope_id) in old_set:
                continue
            await _acquire_quota_slot(scope, scope_id)
            acquired.append((scope, scope_id))
    except HTTPException:
        for scope, scope_id in reversed(acquired):
            await _release_quota_slot(scope, scope_id, seed=False)
        raise
    for scope, scope_id in old_targets:
        if (scope, scope_id) not in new_set:
            await _release_quota_slot(scope, scope_id, seed=True)


async def _next_participant_number(event_id: str) -> str:
    ev = await db.events.find_one({"id": event_id}, {"code": 1, "name": 1})
    code = (ev or {}).get("code") or (ev or {}).get("name") or "EVENT"
    seq = await next_seq(f"participant:{event_id}")
    return fmt_number("PST", code, seq)


async def _resolve_contingent_id(reg: Dict[str, Any]) -> str:
    contingent_id = _clean_id(reg.get("contingent_id"))
    if contingent_id and await db.contingents.find_one({"id": contingent_id}, {"_id": 1}):
        return contingent_id
    name = (reg.get("contingent_name") or "").strip() or "Tanpa Kontingen"
    existing = await db.contingents.find_one({"event_id": reg["event_id"], "name": name}, {"id": 1})
    if existing:
        return existing["id"]
    created = {
        "id": new_id(),
        "event_id": reg["event_id"],
        "name": name,
        "region": "",
        "created_at": now_iso(),
    }
    await db.contingents.insert_one(created)
    return created["id"]


async def _athlete_category_id(reg: Dict[str, Any]) -> Optional[str]:
    category_id = _clean_id(reg.get("category_id"))
    if category_id:
        return category_id
    class_id = _clean_id(reg.get("class_id"))
    if not class_id:
        return None
    kelas = await db.classes.find_one({"id": class_id}, {"category_id": 1})
    return _clean_id((kelas or {}).get("category_id"))


async def _ensure_athlete_for_registration(reg: Dict[str, Any]) -> Dict[str, Any]:
    """Create or refresh the athlete row for a verified registration."""
    contingent_id = await _resolve_contingent_id(reg)
    gender = reg.get("gender") if reg.get("gender") in ("putra", "putri") else "putra"
    try:
        weight = float(reg.get("weight") or 0)
    except (TypeError, ValueError):
        weight = 0.0
    fields = {
        "event_id": reg["event_id"],
        "contingent_id": contingent_id,
        "class_id": _clean_id(reg.get("class_id")),
        "category_id": await _athlete_category_id(reg),
        "name": reg.get("name") or "",
        "gender": gender,
        "dob": reg.get("dob"),
        "weight": weight,
        "photo_url": reg.get("photo_url") or "",
        "phone": reg.get("phone") or "",
        "source": "self_registration",
        "registration_id": reg["id"],
        "status": "active",
    }
    existing = None
    if reg.get("athlete_id"):
        existing = await db.athletes.find_one({"id": reg["athlete_id"]})
    if not existing:
        existing = await db.athletes.find_one({"registration_id": reg["id"]})
    if existing:
        pnum = (existing.get("participant_number") or reg.get("participant_number") or "").strip()
        if not pnum:
            pnum = await _next_participant_number(reg["event_id"])
        await db.athletes.update_one({"id": existing["id"]}, {"$set": {**fields, "participant_number": pnum}})
        await db.registrations.update_one(
            {"id": reg["id"]},
            {"$set": {"athlete_id": existing["id"], "participant_number": pnum}},
        )
        existing.pop("_id", None)
        existing.update(fields)
        existing["participant_number"] = pnum
        return existing
    pnum = (reg.get("participant_number") or "").strip() or await _next_participant_number(reg["event_id"])
    athlete = {"id": new_id(), **fields, "participant_number": pnum, "created_at": now_iso()}
    await db.athletes.insert_one(dict(athlete))
    await db.registrations.update_one(
        {"id": reg["id"]},
        {"$set": {"athlete_id": athlete["id"], "participant_number": pnum}},
    )
    return athlete


async def _athlete_is_in_use(athlete_id: str) -> bool:
    used = await db.matches.find_one({"$or": [
        {"red_athlete_id": athlete_id},
        {"blue_athlete_id": athlete_id},
        {"performer_ids": athlete_id},
    ]}, {"_id": 1})
    if used:
        return True
    slotted = await db.bracket_slots.find_one({"athlete_id": athlete_id}, {"_id": 1})
    return slotted is not None


async def _drop_athlete_for_registration(reg: Dict[str, Any], *, clear_link: bool = True) -> None:
    athlete = None
    if reg.get("athlete_id"):
        athlete = await db.athletes.find_one({"id": reg["athlete_id"]})
    if not athlete and reg.get("id"):
        athlete = await db.athletes.find_one({"registration_id": reg["id"], "source": "self_registration"})
    if not athlete:
        return
    athlete_id = athlete["id"]
    if await _athlete_is_in_use(athlete_id):
        await db.athletes.update_one({"id": athlete_id}, {"$set": {"status": "inactive"}})
        return
    await db.athletes.delete_one({"id": athlete_id})
    if clear_link and reg.get("id"):
        await db.registrations.update_one({"id": reg["id"]}, {"$unset": {"athlete_id": ""}})


async def _backfill_athletes_from_registrations(event_id: Optional[str] = None) -> None:
    query: Dict[str, Any] = {"status": {"$in": list(ATHLETE_SYNC_STATUSES)}}
    if event_id:
        query["event_id"] = event_id
    regs = await db.registrations.find(query).to_list(5000)
    if not regs:
        return
    athlete_ids = [row.get("athlete_id") for row in regs if row.get("athlete_id")]
    linked_ids = set()
    if athlete_ids:
        async for doc in db.athletes.find({"id": {"$in": athlete_ids}}, {"id": 1}):
            linked_ids.add(doc["id"])
    for reg in regs:
        if reg.get("athlete_id") in linked_ids:
            continue
        try:
            await _ensure_athlete_for_registration(reg)
        except Exception as exc:
            print(f"[athletes] sync failed for reg {reg.get('id')}: {exc}")


@api.post("/registrations/{rid}/status")
async def update_registration_status(rid: str, data: RegistrationUpdateStatusIn, user=Depends(require_roles("admin", "operator"))):
    reg = await db.registrations.find_one({"id": rid})
    if not reg:
        raise HTTPException(404, "Registrasi tidak ditemukan")
    old_status = reg.get("status")
    new_status = data.status
    entering = _occupies_acceptance_slot(new_status) and not _occupies_acceptance_slot(old_status)
    leaving = _occupies_acceptance_slot(old_status) and not _occupies_acceptance_slot(new_status)
    if entering:
        await _acquire_acceptance_slots(reg)
    elif leaving:
        for scope, scope_id in _quota_targets(reg):
            await _ensure_quota_counter(scope, scope_id)
    history_entry = {"status": new_status, "at": now_iso(), "by": user["id"], "notes": data.admin_notes}
    update = {
        "$set": {"status": new_status, "admin_notes": data.admin_notes, "updated_at": now_iso()},
        "$push": {"history": history_entry},
    }
    try:
        result = await db.registrations.update_one({"id": rid, "status": old_status}, update)
    except Exception:
        if entering:
            await _release_acceptance_slots(reg, seed=False)
        raise
    if result.matched_count == 0:
        if entering:
            await _release_acceptance_slots(reg, seed=False)
        fresh = await db.registrations.find_one({"id": rid}, {"_id": 0})
        if not fresh:
            raise HTTPException(404, "Registrasi tidak ditemukan")
        raise HTTPException(409, "Status registrasi berubah, silakan ulangi")
    if leaving:
        await _release_acceptance_slots(reg, seed=False)
    fresh = await db.registrations.find_one({"id": rid}, {"_id": 0})
    try:
        if new_status in ATHLETE_SYNC_STATUSES:
            await _ensure_athlete_for_registration(fresh)
        elif old_status in ATHLETE_SYNC_STATUSES:
            await _drop_athlete_for_registration(fresh)
        fresh = await db.registrations.find_one({"id": rid}, {"_id": 0})
    except Exception as exc:
        print(f"[athletes] sync failed for reg {rid}: {exc}")
    # Best-effort WhatsApp notification (skipped if WAHA disabled or no template)
    try:
        await _dispatch_registration_notification(fresh, new_status)
    except Exception as e:
        print(f"[waha] notification dispatch failed for reg {rid}: {e}")
    return await _hydrate_registration(fresh)

@api.post("/registrations/{rid}/convert-to-athlete")
async def convert_to_athlete(rid: str, user=Depends(require_roles("admin", "operator"))):
    """Convert an accepted/reserve registration into an active participant in `athletes` collection.
    The registration must already be in 'accepted' status (or admin override).

    Moving accepted → active_participant keeps the same quota slot. A reserve
    promotion takes a slot only if one is still free.
    """
    reg = await db.registrations.find_one({"id": rid})
    if not reg:
        raise HTTPException(404, "Registrasi tidak ditemukan")
    if reg.get("status") not in ("accepted", "reserve"):
        raise HTTPException(400, "Hanya registrasi dengan status diterima yang dapat dijadikan peserta aktif")
    acquired = False
    if reg.get("status") == "reserve":
        await _acquire_acceptance_slots(reg)
        acquired = True
    try:
        athlete = await _ensure_athlete_for_registration(reg)
        pnum = athlete["participant_number"]
        history_entry = {"status": "active_participant", "at": now_iso(), "by": user["id"], "notes": f"Dikonversi ke peserta aktif {pnum}"}
        result = await db.registrations.update_one({"id": rid, "status": reg.get("status")}, {
            "$set": {
                "status": "active_participant",
                "athlete_id": athlete["id"],
                "participant_number": pnum,
                "updated_at": now_iso(),
            },
            "$push": {"history": history_entry},
        })
        if result.matched_count == 0:
            raise HTTPException(409, "Status registrasi berubah, silakan ulangi")
    except Exception:
        if acquired:
            await _release_acceptance_slots(reg, seed=False)
        raise
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
        "access_code": reg.get("access_code", ""),
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

_PUBLIC_ATHLETE_KEYS = ("id", "name", "photo_url", "gender", "weight", "contingent_id")
_PUBLIC_ATHLETE_PROJECTION = {"_id": 0, **{key: 1 for key in _PUBLIC_ATHLETE_KEYS}}

def _redact_public_athlete(doc: Optional[Dict[str, Any]]) -> Optional[Dict[str, Any]]:
    if not doc:
        return None
    return {key: doc.get(key) for key in _PUBLIC_ATHLETE_KEYS}

@api.get("/public/athletes")
async def public_list_athletes(event_id: Optional[str] = None):
    q = {"event_id": event_id} if event_id else {}
    docs = await db.athletes.find(q, _PUBLIC_ATHLETE_PROJECTION).to_list(2000)
    return [_redact_public_athlete(doc) for doc in docs]

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
        "timer": {"running": False, "remaining_sec": 0, "started_at": None, "round": 1, "phase": "round"},
        "winner_corner": None,
        "decision_method": None,
        "approved_by": None,
        "approved_at": None,
        "started_at": None,
        "finished_at": None,
    })
    rule = await db.scoring_rules.find_one({"id": data.scoring_rule_id})
    if doc.get("round_duration_sec") is None:
        doc.pop("round_duration_sec", None)
    doc["timer"]["remaining_sec"] = _match_round_duration(doc, rule)
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
    return redact_public_match(state)

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
    return {"match": redact_public_match(state) if state else None}

@api.delete("/matches/{mid}")
async def delete_match(mid: str, user=Depends(require_roles("admin", "operator"))):
    match = await db.matches.find_one({"id": mid}, {"bracket_id": 1})
    if match and match.get("bracket_id"):
        bracket = await db.brackets.find_one({"id": match["bracket_id"]}, {"status": 1})
        if bracket and bracket.get("status") == "running":
            raise HTTPException(400, "Partai pada bracket yang sedang berjalan tidak dapat dihapus")
    await db.matches.delete_one({"id": mid})
    await db.score_logs.delete_many({"match_id": mid})
    await db.score_votes.delete_many({"match_id": mid})
    await db.seni_scores.delete_many({"match_id": mid})
    await db.seni_penalties.delete_many({"match_id": mid})
    return {"ok": True}

def _action_points(data: ScoreActionIn, rule: Dict[str, Any]) -> int:
    """Use the match rule. A number sent by the browser is never the score."""
    rule = rule or {}
    if data.action_type == "score":
        table = rule.get("points") or {}
        label = "skor"
    elif data.action_type == "penalty":
        table = rule.get("penalty_points") or {}
        label = "hukuman"
    elif data.action_type in ("binaan", "absolute_win", "fall"):
        return 0
    else:
        raise HTTPException(400, "Jenis tindakan tidak dikenal")
    if not isinstance(table, dict) or data.code not in table:
        raise HTTPException(400, f"Kode {label} tidak ada di aturan partai")
    try:
        points = int(table[data.code])
    except (TypeError, ValueError):
        raise HTTPException(400, "Nilai poin pada aturan tidak valid")
    if points < 0:
        raise HTTPException(400, "Nilai poin pada aturan tidak valid")
    return points

async def _apply_jury_consensus(mid: str, match: Dict[str, Any], data: ScoreActionIn, user: Dict[str, Any], role: str, points: int, rule: Dict[str, Any]) -> Dict[str, Any]:
    """A score counts once when two different juries press the same action within the window."""
    lock = _consensus_lock(mid)
    async with lock:
        now = datetime.now(timezone.utc)
        window_start = (now - timedelta(seconds=_consensus_window_sec(rule))).isoformat()
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
        await _maybe_technical_win(match, rule, log["id"])
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
    if data.action_type == "fall":
        raise HTTPException(400, "Jatuhan masuk lewat juri.")
    if data.action_type == "score" and role not in ("jury", "admin"):
        raise HTTPException(403, "Hanya juri yang dapat memberi skor")
    if data.action_type in ("penalty", "binaan", "absolute_win") and role not in ("referee", "head_jury", "admin"):
        raise HTTPException(403, "Hanya wasit/ketua juri yang dapat memberi tindakan ini")

    timer = match.get("timer") or {}
    if data.action_type == "score" and timer.get("phase") == "rest":
        raise HTTPException(400, "Sedang istirahat. Mulai ronde berikutnya sebelum menambah skor.")
    clock_done = not timer.get("running") and float(timer.get("remaining_sec") or 0) <= 0
    if data.action_type == "score" and clock_done:
        raise HTTPException(400, "Waktu ronde habis. Skor tidak dapat ditambah.")

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
        return await _apply_jury_consensus(mid, match, data, user, role, points, rule)

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
    elif int(points or 0) != 0:
        await _maybe_technical_win(match, rule, log["id"])
    await broadcast_match_update(mid, "score_update")
    log.pop("_id", None)
    return log

@api.get("/matches/{mid}/logs")
async def list_logs(mid: str, user=Depends(get_current_user)):
    logs = await db.score_logs.find({"match_id": mid}, {"_id": 0}).sort("timestamp", 1).to_list(5000)
    return logs

@api.post("/matches/{mid}/logs/{log_id}/invalidate")
async def invalidate_log(mid: str, log_id: str, user=Depends(require_roles("head_jury", "admin"))):
    match = await db.matches.find_one({"id": mid})
    if not match:
        raise HTTPException(404, "Match tidak ditemukan")
    if match.get("status") == "approved":
        raise HTTPException(400, "Partai yang sudah disahkan tidak dapat dikoreksi")
    log = await db.score_logs.find_one({"id": log_id, "match_id": mid})
    if not log:
        raise HTTPException(404, "Log tidak ditemukan")
    was_valid = log.get("valid", True)
    await db.score_logs.update_one(
        {"id": log_id, "match_id": mid},
        {"$set": {"valid": False, "corrected_by": user["id"], "corrected_at": now_iso()}},
    )
    decisive = log.get("action_type") == "absolute_win" or (
        log.get("action_type") == "penalty" and log.get("code") == "peringatan_3"
    ) or bool(log.get("technical_win"))
    if was_valid and match.get("status") == "finished" and decisive:
        await db.matches.update_one({"id": mid}, {"$set": {
            "status": "paused",
            "winner_corner": None,
            "decision_method": None,
            "finished_at": None,
        }})
    await broadcast_match_update(mid, "correction")
    return {"ok": True}

# ===== Timer Actions =====
@api.post("/matches/{mid}/timer")
async def timer_action(mid: str, data: TimerActionIn, user=Depends(require_roles("timer", "operator", "admin"))):
    match = await db.matches.find_one({"id": mid})
    if not match:
        raise HTTPException(404, "Match tidak ditemukan")
    if match.get("status") in ("approved", "finished"):
        raise HTTPException(400, "Partai yang sudah selesai atau disahkan sudah dikunci")
    before_phase = (match.get("timer") or {}).get("phase")
    before_round = match.get("current_round")
    match = await settle_expired_timer(match)
    rule = await db.scoring_rules.find_one({"id": match["scoring_rule_id"]}) or {}
    round_duration = _match_round_duration(match, rule)
    total_rounds = _round_count(rule)
    timer = dict(match.get("timer") or {
        "running": False, "remaining_sec": round_duration, "round": 1, "started_at": None, "phase": "round",
    })
    settled_forward = (timer.get("phase") or "round") != (before_phase or "round") or match.get("current_round") != before_round
    now = datetime.now(timezone.utc)

    def consume_running():
        nonlocal timer
        timer = _consume_timer(timer, now)

    def begin_clock():
        """Start the clock that is already on screen. A finished round is never refilled."""
        nonlocal timer
        phase = timer.get("phase") or "round"
        remaining = float(timer.get("remaining_sec") or 0)
        if phase == "rest" and timer.get("running"):
            return
        if phase == "rest" and remaining <= 0:
            timer = {
                "running": True,
                "remaining_sec": round_duration,
                "started_at": now.isoformat(),
                "round": timer.get("round", match.get("current_round", 1)),
                "phase": "round",
            }
            return
        if phase == "rest":
            timer["running"] = True
            timer["started_at"] = now.isoformat()
            timer["phase"] = "rest"
            return
        if timer.get("running"):
            return
        if remaining <= 0 and match.get("started_at"):
            raise HTTPException(400, "Waktu ronde sudah habis. Ronde ini tidak diulang.")
        if remaining <= 0:
            timer["remaining_sec"] = round_duration
        timer["running"] = True
        timer["started_at"] = now.isoformat()
        timer["phase"] = "round"

    update = {}
    if data.action in ("start", "resume"):
        begin_clock()
        update["status"] = "in_progress"
        if not match.get("started_at"):
            update["started_at"] = now.isoformat()
    elif data.action == "pause":
        if not settled_forward:
            consume_running()
            update["status"] = "paused"
    elif data.action == "reset":
        phase = timer.get("phase") or "round"
        duration = _rest_seconds(rule) if phase == "rest" else round_duration
        timer = {
            "running": False,
            "remaining_sec": duration,
            "round": match.get("current_round", 1),
            "started_at": None,
            "phase": phase,
        }
    elif data.action == "next_round":
        if not settled_forward:
            consume_running()
            phase = timer.get("phase") or "round"
            cur = _safe_int(match.get("current_round"), 1)
            if phase == "rest":
                timer = _parked_round_timer(cur, round_duration)
                update["status"] = "paused"
            elif cur < total_rounds:
                nxt = cur + 1
                rest = _rest_seconds(rule)
                if rest > 0:
                    timer = _running_rest_timer(nxt, rest, now)
                    update["status"] = "in_progress"
                else:
                    timer = _parked_round_timer(nxt, round_duration)
                    update["status"] = "paused"
                update["current_round"] = nxt
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
    if match.get("bracket_id") and winner not in ("red", "blue"):
        raise HTTPException(400, "Hasil seri pada partai bagan ditolak. Ketua juri wajib menunjuk sudut merah atau biru.")
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
    bracket_warning = None
    if match.get("bracket_id") and winner in ("red", "blue"):
        winner_athlete_id = match["red_athlete_id"] if winner == "red" else match.get("blue_athlete_id")
        if not match.get("bracket_slot_id") or not winner_athlete_id:
            logger.error(
                "Gagal memajukan pemenang bagan pada partai %s: slot=%s atlet=%s",
                mid, match.get("bracket_slot_id"), winner_athlete_id,
            )
            bracket_warning = "Pemenang tidak masuk ke babak berikutnya. Periksa bagan."
        else:
            try:
                await _bracket_advance_winner(match["bracket_id"], match["bracket_slot_id"], winner_athlete_id)
            except Exception:
                logger.exception("Gagal memajukan pemenang bagan pada partai %s", mid)
                bracket_warning = "Pemenang tidak masuk ke babak berikutnya. Periksa bagan."
    result = await compute_match_state(mid)
    if bracket_warning:
        result["bracket_warning"] = bracket_warning
    return result

# ============ Routes: Brackets ============
import math
import random as _rnd

BRACKET_MAX_SIZE = 32

def _next_pow2(n: int) -> int:
    if n <= 1: return 2
    return 1 << (n - 1).bit_length()

def _bracket_size_for_athletes(count: int) -> int:
    """Smallest power of two from 2 to 32 that can hold this many athletes."""
    return _next_pow2(max(1, min(count, BRACKET_MAX_SIZE)))

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
    seen_ids = set()
    unique = []
    for athlete in athletes:
        aid = athlete.get("id")
        if not aid or aid in seen_ids:
            continue
        seen_ids.add(aid)
        unique.append(athlete)
    athletes = unique
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
    await _attach_bracket_print_meta(bracket)
    return bracket


async def _attach_bracket_print_meta(bracket: Dict[str, Any]) -> None:
    """Class name and letterhead fields for the paper bracket. Logos are already public."""
    bracket["class_name"] = ""
    if bracket.get("class_id"):
        cls = await db.classes.find_one({"id": bracket["class_id"]}, {"_id": 0, "name": 1})
        bracket["class_name"] = (cls or {}).get("name") or ""
    bracket["event"] = None
    if not bracket.get("event_id"):
        return
    ev = await db.events.find_one({"id": bracket["event_id"]}, {
        "_id": 0, "id": 1, "name": 1, "code": 1, "location": 1,
        "start_date": 1, "end_date": 1, "logo_url": 1,
        "institution_name": 1, "institution_logo_url": 1,
    })
    if not ev:
        return
    bracket["event"] = {
        "id": ev.get("id") or "",
        "name": ev.get("name") or "",
        "code": ev.get("code") or "",
        "location": ev.get("location") or "",
        "start_date": ev.get("start_date"),
        "end_date": ev.get("end_date"),
        "logo_url": ev.get("logo_url") or "",
        "institution_name": ev.get("institution_name") or "",
        "institution_logo_url": ev.get("institution_logo_url") or "",
    }

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
        "timer": {"running": False, "remaining_sec": 0, "started_at": None, "round": 1, "phase": "round"},
        "winner_corner": None,
        "decision_method": None,
        "approved_by": None, "approved_at": None,
        "started_at": None, "finished_at": None,
        "created_at": now_iso(),
    }
    rule = await db.scoring_rules.find_one({"id": bracket["scoring_rule_id"]})
    match["timer"]["remaining_sec"] = _match_round_duration(match, rule)
    await db.matches.insert_one(match)
    await db.bracket_slots.update_one({"id": source_a["id"]}, {"$set": {"match_id": match["id"]}})
    await db.bracket_slots.update_one({"id": source_b["id"]}, {"$set": {"match_id": match["id"]}})
    match.pop("_id", None)
    return match

async def _create_draft_bracket(payload: Dict[str, Any], *, size: int, auto_fill: bool) -> Dict[str, Any]:
    doc = dict(payload)
    doc.update({
        "id": new_id(), "size": size, "status": "draft", "auto_fill": auto_fill,
        "created_at": now_iso(), "winner_athlete_id": None, "finished_at": None,
    })
    await db.brackets.insert_one(doc)
    await _build_bracket_slots(doc["id"], size)
    if auto_fill:
        await _auto_fill_round1(doc)
    doc.pop("_id", None)
    return doc

@api.post("/brackets")
async def create_bracket(data: BracketIn, user=Depends(require_roles("admin", "operator"))):
    size = _next_pow2(max(2, int(data.size)))
    doc = await _create_draft_bracket(data.model_dump(), size=size, auto_fill=data.auto_fill)
    return await _hydrate_bracket(doc)

@api.post("/brackets/generate")
async def generate_brackets(data: BracketGenerateIn, user=Depends(require_roles("admin", "operator"))):
    """One draft single-elimination bracket per tanding class that has active athletes."""
    event = await db.events.find_one({"id": data.event_id}, {"_id": 0, "id": 1})
    if not event:
        raise HTTPException(404, "Event tidak ditemukan")
    arena = await db.arenas.find_one({"id": data.arena_id, "event_id": data.event_id}, {"_id": 0, "id": 1})
    if not arena:
        raise HTTPException(400, "Arena tidak ditemukan pada event ini")
    rule = await db.scoring_rules.find_one({"id": data.scoring_rule_id, "event_id": data.event_id}, {"_id": 0, "id": 1, "category_type": 1})
    if not rule:
        raise HTTPException(400, "Aturan skoring tidak ditemukan pada event ini")
    if (rule.get("category_type") or "tanding") != "tanding":
        raise HTTPException(400, "Aturan skoring harus untuk kategori tanding")

    classes = await db.classes.find({"event_id": data.event_id}, {"_id": 0}).sort("name", 1).to_list(2000)
    categories = {
        c["id"]: c
        async for c in db.categories.find({"event_id": data.event_id}, {"_id": 0, "id": 1, "name": 1, "type": 1})
    }
    existing = await db.brackets.find({"event_id": data.event_id}, {"_id": 0, "class_id": 1}).to_list(2000)
    taken = {b.get("class_id") for b in existing if b.get("class_id")}

    created: List[Dict[str, Any]] = []
    skipped: List[Dict[str, Any]] = []
    for cls in classes:
        category = categories.get(cls.get("category_id") or "")
        category_type = (category or {}).get("type") or ""
        label = cls.get("name") or "Kelas"
        if category and category.get("name"):
            label = f"{category['name']} — {cls.get('name') or 'Kelas'}"
        athlete_count = await db.athletes.count_documents({
            "event_id": data.event_id,
            "class_id": cls["id"],
            "status": {"$ne": "inactive"},
        })
        if category_type != "tanding":
            if athlete_count:
                reason = "Bukan kategori tanding" if category_type else "Kategori tidak ditemukan"
                skipped.append({"class_id": cls["id"], "name": label, "reason": reason, "athlete_count": athlete_count})
            continue
        if cls["id"] in taken:
            skipped.append({"class_id": cls["id"], "name": label, "reason": "Sudah punya bagan", "athlete_count": athlete_count})
            continue
        if athlete_count < 1:
            skipped.append({"class_id": cls["id"], "name": label, "reason": "Tidak ada peserta aktif", "athlete_count": 0})
            continue
        if athlete_count > BRACKET_MAX_SIZE:
            skipped.append({
                "class_id": cls["id"], "name": label,
                "reason": f"Peserta aktif {athlete_count} melebihi {BRACKET_MAX_SIZE}",
                "athlete_count": athlete_count,
            })
            continue
        size = _bracket_size_for_athletes(athlete_count)
        doc = await _create_draft_bracket({
            "event_id": data.event_id,
            "class_id": cls["id"],
            "category_id": cls.get("category_id"),
            "name": label,
            "discipline": "tanding",
            "arena_id": data.arena_id,
            "scoring_rule_id": data.scoring_rule_id,
            "size": size,
        }, size=size, auto_fill=True)
        created.append({
            "id": doc["id"], "name": doc["name"], "class_id": cls["id"],
            "size": size, "athlete_count": athlete_count,
        })
    return {"created": created, "skipped": skipped}

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
    hydrated = await _hydrate_bracket(b)
    for slot in hydrated.get("slots") or []:
        if slot.get("athlete"):
            slot["athlete"] = _redact_public_athlete(slot["athlete"])
    return hydrated

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
    if data.athlete_id:
        athlete = await db.athletes.find_one({"id": data.athlete_id}, {"_id": 0, "id": 1, "event_id": 1, "class_id": 1, "category_id": 1, "status": 1})
        if not athlete or athlete.get("event_id") != b.get("event_id"):
            raise HTTPException(400, "Peserta tidak ditemukan pada event ini")
        if athlete.get("status") == "inactive":
            raise HTTPException(400, "Peserta tidak aktif")
        if b.get("class_id") and athlete.get("class_id") != b.get("class_id"):
            raise HTTPException(400, "Peserta bukan dari kelas bagan ini")
        if not b.get("class_id") and b.get("category_id") and athlete.get("category_id") != b.get("category_id"):
            raise HTTPException(400, "Peserta bukan dari kategori bagan ini")
        taken = await db.bracket_slots.find_one(
            {"bracket_id": bid, "athlete_id": data.athlete_id, "id": {"$ne": sid}},
            {"_id": 1},
        )
        if taken:
            raise HTTPException(400, "Peserta ini sudah berada di slot lain")
    upd: Dict[str, Any] = {"athlete_id": data.athlete_id, "is_bye": False if data.athlete_id else True}
    await db.bracket_slots.update_one({"id": sid}, {"$set": upd})
    return await _hydrate_bracket(await db.brackets.find_one({"id": bid}, {"_id": 0}))

@api.post("/brackets/{bid}/slots/swap")
async def swap_slots(bid: str, data: BracketSlotSwapIn, user=Depends(require_roles("admin", "operator"))):
    """Swap two round-1 slots while the bracket is still a draft. Later rounds stay untouched."""
    b = await db.brackets.find_one({"id": bid})
    if not b:
        raise HTTPException(404, "Bracket tidak ditemukan")
    if b.get("status") != "draft":
        raise HTTPException(400, "Hanya bagan berstatus draft yang dapat diubah")
    if data.slot_a == data.slot_b:
        return await _hydrate_bracket(await db.brackets.find_one({"id": bid}, {"_id": 0}))
    first = await db.bracket_slots.find_one({"id": data.slot_a, "bracket_id": bid})
    second = await db.bracket_slots.find_one({"id": data.slot_b, "bracket_id": bid})
    if not first or not second or first.get("round") != 1 or second.get("round") != 1:
        raise HTTPException(400, "Hanya slot babak 1 yang dapat ditukar")
    if first.get("match_id") or second.get("match_id"):
        raise HTTPException(400, "Slot yang sudah punya pertandingan tidak dapat ditukar")
    await db.bracket_slots.update_one(
        {"id": first["id"]},
        {"$set": {"athlete_id": second.get("athlete_id"), "is_bye": not bool(second.get("athlete_id"))}},
    )
    await db.bracket_slots.update_one(
        {"id": second["id"]},
        {"$set": {"athlete_id": first.get("athlete_id"), "is_bye": not bool(first.get("athlete_id"))}},
    )
    return await _hydrate_bracket(await db.brackets.find_one({"id": bid}, {"_id": 0}))

@api.post("/brackets/{bid}/start")
async def start_bracket(bid: str, user=Depends(require_roles("admin", "operator"))):
    b = await db.brackets.find_one({"id": bid})
    if not b: raise HTTPException(404, "Bracket tidak ditemukan")
    if (b.get("discipline") or "tanding") != "tanding":
        raise HTTPException(400, "Bagan gugur hanya untuk kategori tanding")
    if b.get("status") not in ("draft",):
        raise HTTPException(400, "Bracket sudah dimulai atau selesai")
    if not (b.get("arena_id") and b.get("scoring_rule_id")):
        raise HTTPException(400, "Set arena dan aturan skoring bracket terlebih dahulu")
    # Create round-1 matches; resolve byes immediately
    r1 = await db.bracket_slots.find({"bracket_id": bid, "round": 1}).sort("position", 1).to_list(1024)
    seen_athletes = []
    for slot in r1:
        aid = slot.get("athlete_id")
        if not aid:
            continue
        if aid in seen_athletes:
            raise HTTPException(400, "Peserta yang sama terpasang di lebih dari satu slot babak 1. Ganti dulu sebelum bagan dimulai.")
        seen_athletes.append(aid)
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
                "timer": {"running": False, "remaining_sec": 0, "started_at": None, "round": 1, "phase": "round"},
                "winner_corner": None, "decision_method": None,
                "approved_by": None, "approved_at": None, "started_at": None, "finished_at": None,
                "created_at": now_iso(),
            }
            rule = await db.scoring_rules.find_one({"id": b["scoring_rule_id"]})
            match["timer"]["remaining_sec"] = _match_round_duration(match, rule)
            await db.matches.insert_one(match)
            # Mark match_id on the LOWER slot (a) so we can find it (we use a's id as marker for the pair's match)
            await db.bracket_slots.update_one({"id": a["id"]}, {"$set": {"match_id": match["id"]}})
            await db.bracket_slots.update_one({"id": c["id"]}, {"$set": {"match_id": match["id"]}})
    await db.brackets.update_one({"id": bid}, {"$set": {"status": "running", "started_at": now_iso()}})
    return await _hydrate_bracket(await db.brackets.find_one({"id": bid}, {"_id": 0}))

@api.delete("/brackets/{bid}")
async def delete_bracket(bid: str, user=Depends(require_roles("admin", "operator"))):
    b = await db.brackets.find_one({"id": bid})
    if not b: raise HTTPException(404, "Bracket tidak ditemukan")
    matches = await db.matches.find({"bracket_id": bid}, {"id": 1}).to_list(5000)
    match_ids = [m["id"] for m in matches]
    if match_ids:
        await db.score_logs.delete_many({"match_id": {"$in": match_ids}})
        await db.score_votes.delete_many({"match_id": {"$in": match_ids}})
        await db.seni_scores.delete_many({"match_id": {"$in": match_ids}})
        await db.seni_penalties.delete_many({"match_id": {"$in": match_ids}})
        await db.matches.delete_many({"bracket_id": bid})
    await db.bracket_slots.delete_many({"bracket_id": bid})
    await db.brackets.delete_one({"id": bid})
    return {"ok": True}

# ============ Medals ============
_PLACE_LABEL = {1: "Juara 1", 2: "Juara 2", 3: "Juara 3"}

def _other_corner_athlete(match: Dict[str, Any], winner_id: Optional[str]) -> Optional[str]:
    """Athlete who lost this match, given the athlete who advanced."""
    red = match.get("red_athlete_id") or None
    blue = match.get("blue_athlete_id") or None
    if winner_id and winner_id == red and blue and blue != winner_id:
        return blue
    if winner_id and winner_id == blue and red and red != winner_id:
        return red
    corner = match.get("winner_corner")
    if corner == "red" and blue and blue != winner_id:
        return blue
    if corner == "blue" and red and red != winner_id:
        return red
    return None

def _seni_performer_ids(match: Dict[str, Any]) -> List[str]:
    ids: List[str] = []
    if match.get("red_athlete_id"):
        ids.append(match["red_athlete_id"])
    for pid in match.get("performer_ids") or []:
        if pid and pid not in ids:
            ids.append(pid)
    return ids

def _medal_athlete(doc: Optional[Dict[str, Any]], contingent_names: Dict[str, str]) -> Dict[str, Any]:
    if not doc:
        return {"id": "", "name": "Peserta tidak ditemukan", "photo_url": "", "gender": "", "weight": None, "contingent_id": "", "contingent_name": ""}
    out = _redact_public_athlete(doc) or {}
    out["contingent_name"] = contingent_names.get(doc.get("contingent_id") or "", "")
    return out

async def _event_medals(eid: str) -> Dict[str, Any]:
    """Tanding medals from completed brackets. Seni medals are the top three approved scores per class."""
    event = await db.events.find_one({"id": eid}, {"_id": 0, "id": 1, "name": 1})
    if not event:
        raise HTTPException(404, "Event tidak ditemukan")

    raw_brackets = await db.brackets.find({"event_id": eid, "status": "completed"}, {"_id": 0}).to_list(500)
    brackets = [b for b in raw_brackets if (b.get("discipline") or "tanding") == "tanding"]
    bracket_ids = [b["id"] for b in brackets]
    slots: List[Dict[str, Any]] = []
    bracket_matches: List[Dict[str, Any]] = []
    if bracket_ids:
        slots = await db.bracket_slots.find({"bracket_id": {"$in": bracket_ids}}, {"_id": 0}).to_list(8000)
        bracket_matches = await db.matches.find(
            {"bracket_id": {"$in": bracket_ids}, "status": "approved"},
            {"_id": 0, "id": 1, "bracket_id": 1, "bracket_slot_id": 1, "red_athlete_id": 1, "blue_athlete_id": 1, "winner_corner": 1, "approved_at": 1},
        ).to_list(5000)

    slots_by_bracket: Dict[str, List[Dict[str, Any]]] = {}
    for slot in slots:
        slots_by_bracket.setdefault(slot["bracket_id"], []).append(slot)
    match_by_slot: Dict[tuple, Dict[str, Any]] = {}
    for match in bracket_matches:
        key = (match.get("bracket_id"), match.get("bracket_slot_id"))
        prev = match_by_slot.get(key)
        if not prev or (match.get("approved_at") or "") >= (prev.get("approved_at") or ""):
            match_by_slot[key] = match

    athlete_ids: set = set()
    class_ids: set = set()
    category_ids: set = set()
    tanding_raw: List[Dict[str, Any]] = []

    for bracket in brackets:
        bslots = slots_by_bracket.get(bracket["id"], [])
        if not bslots:
            continue
        max_round = max(int(s.get("round") or 0) for s in bslots)
        finals = [s for s in bslots if int(s.get("round") or 0) == max_round]
        finals.sort(key=lambda s: int(s.get("position") or 0))
        final_slot = finals[0]
        final_match = match_by_slot.get((bracket["id"], final_slot["id"]))
        gold_id = bracket.get("winner_athlete_id") or final_slot.get("athlete_id")
        if not gold_id and final_match:
            corner = final_match.get("winner_corner")
            if corner == "red":
                gold_id = final_match.get("red_athlete_id")
            elif corner == "blue":
                gold_id = final_match.get("blue_athlete_id")
        silver_id = _other_corner_athlete(final_match, gold_id) if final_match else None
        if silver_id == gold_id:
            silver_id = None

        bronze_ids: List[str] = []
        for source_id in (final_slot.get("source_a"), final_slot.get("source_b")):
            if not source_id:
                continue
            semi = match_by_slot.get((bracket["id"], source_id))
            if not semi:
                continue
            dest = next((s for s in bslots if s.get("id") == source_id), None)
            advanced = (dest or {}).get("athlete_id")
            if not advanced:
                corner = semi.get("winner_corner")
                if corner == "red":
                    advanced = semi.get("red_athlete_id")
                elif corner == "blue":
                    advanced = semi.get("blue_athlete_id")
            loser = _other_corner_athlete(semi, advanced)
            if loser and loser not in bronze_ids and loser not in (gold_id, silver_id):
                bronze_ids.append(loser)

        places: List[tuple] = []
        if gold_id:
            places.append((1, gold_id))
            athlete_ids.add(gold_id)
        if silver_id:
            places.append((2, silver_id))
            athlete_ids.add(silver_id)
        for bronze_id in bronze_ids:
            places.append((3, bronze_id))
            athlete_ids.add(bronze_id)
        if not places:
            continue
        if bracket.get("class_id"):
            class_ids.add(bracket["class_id"])
        if bracket.get("category_id"):
            category_ids.add(bracket["category_id"])
        tanding_raw.append({"bracket": bracket, "places": places})

    seni_matches = await db.matches.find(
        {"event_id": eid, "status": "approved", "discipline": {"$in": ["tunggal", "ganda", "regu"]}},
        {"_id": 0},
    ).to_list(5000)
    seni_groups: Dict[tuple, List[Dict[str, Any]]] = {}
    for match in seni_matches:
        key = (match.get("class_id") or "", match.get("discipline") or "tunggal")
        seni_groups.setdefault(key, []).append(match)
        if match.get("class_id"):
            class_ids.add(match["class_id"])
        if match.get("category_id"):
            category_ids.add(match["category_id"])
        for aid in _seni_performer_ids(match):
            athlete_ids.add(aid)

    class_names = await _lookup_names(db.classes, class_ids)
    category_names = await _lookup_names(db.categories, category_ids)
    athletes = await db.athletes.find({"id": {"$in": list(athlete_ids)}}, {"_id": 0}).to_list(max(len(athlete_ids), 1)) if athlete_ids else []
    athlete_by_id = {a["id"]: a for a in athletes}
    contingent_names = await _lookup_names(db.contingents, {a.get("contingent_id") for a in athletes})

    def pack(aid: Optional[str]) -> Dict[str, Any]:
        athlete = _medal_athlete(athlete_by_id.get(aid) if aid else None, contingent_names)
        if aid and not athlete.get("id"):
            athlete["id"] = aid
        return athlete

    tanding = []
    for row in tanding_raw:
        bracket = row["bracket"]
        tanding.append({
            "bracket_id": bracket["id"],
            "name": bracket.get("name") or "",
            "class_id": bracket.get("class_id"),
            "class_name": class_names.get(bracket.get("class_id") or "", ""),
            "category_id": bracket.get("category_id"),
            "category_name": category_names.get(bracket.get("category_id") or "", ""),
            "places": [
                {"place": place, "label": _PLACE_LABEL[place], "athlete": pack(aid)}
                for place, aid in row["places"]
            ],
        })
    tanding.sort(key=lambda g: ((g["category_name"] or ""), (g["class_name"] or ""), (g["name"] or "")))

    discipline_order = {"tunggal": 0, "ganda": 1, "regu": 2}
    seni = []
    for (class_id, discipline), rows in seni_groups.items():
        rows.sort(key=lambda m: (-float(m.get("seni_final_score") or 0), m.get("approved_at") or "", m.get("id") or ""))
        top = rows[:3]
        category_id = next((m.get("category_id") for m in top if m.get("category_id")), None)
        places = []
        for index, match in enumerate(top, start=1):
            places.append({
                "place": index,
                "label": _PLACE_LABEL[index],
                "score": float(match.get("seni_final_score") or 0),
                "match_id": match.get("id"),
                "athletes": [pack(aid) for aid in _seni_performer_ids(match)],
            })
        seni.append({
            "class_id": class_id or None,
            "class_name": class_names.get(class_id, ""),
            "category_id": category_id,
            "category_name": category_names.get(category_id or "", ""),
            "discipline": discipline,
            "places": places,
        })
    seni.sort(key=lambda g: (discipline_order.get(g["discipline"], 9), g["category_name"] or "", g["class_name"] or ""))

    return {
        "event_id": event["id"],
        "event_name": event.get("name") or "",
        "tanding": tanding,
        "seni": seni,
    }

@api.get("/events/{eid}/medals")
async def event_medals(eid: str, user=Depends(require_roles("admin", "operator"))):
    return await _event_medals(eid)

@api.get("/public/events/{eid}/medals")
async def public_event_medals(eid: str):
    return await _event_medals(eid)

@api.get("/events/{eid}/match-reports")
async def event_match_reports(eid: str, user=Depends(require_roles("admin", "operator"))):
    """Finished and approved matches, with scores, logs, and seni totals, for bulk printing."""
    event = await db.events.find_one({"id": eid}, {"_id": 0})
    if not event:
        raise HTTPException(404, "Event tidak ditemukan")
    matches = await db.matches.find(
        {"event_id": eid, "status": {"$in": ["finished", "approved"]}},
        {"_id": 0, "id": 1, "match_number": 1},
    ).sort("match_number", 1).to_list(2000)
    ids = [m["id"] for m in matches]
    logs_by: Dict[str, List[Dict[str, Any]]] = {mid: [] for mid in ids}
    if ids:
        all_logs = await db.score_logs.find({"match_id": {"$in": ids}}, {"_id": 0}).sort("timestamp", 1).to_list(50000)
        for log in all_logs:
            logs_by.setdefault(log.get("match_id"), []).append(log)
    arenas = await db.arenas.find({"event_id": eid}, {"_id": 0}).to_list(200)
    athletes = await db.athletes.find({"event_id": eid}, {"_id": 0}).to_list(5000)
    reports = []
    for row in matches:
        state = await compute_match_state(row["id"])
        if not state:
            continue
        state.pop("pending_votes", None)
        state.pop("rule", None)
        seni = None
        if (state.get("discipline") or "tanding") != "tanding":
            summary = await _seni_summary(row["id"])
            raw = await db.matches.find_one({"id": row["id"]}, {"_id": 0})
            seni = await _attach_match_athletes(summary, raw or state)
            seni.pop("match", None)
        reports.append({"state": state, "logs": logs_by.get(row["id"], []), "seni": seni})
    return {
        "event": normalize_public_event(event),
        "arenas": arenas,
        "athletes": athletes,
        "reports": reports,
    }

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

def _reject_locked_seni(match: Dict[str, Any]) -> None:
    if match.get("status") == "approved":
        raise HTTPException(400, "Nilai seni sudah disahkan dan tidak dapat diubah")

@api.get("/public/matches/{mid}/seni")
async def public_get_seni(mid: str):
    match = await db.matches.find_one({"id": mid}, {"_id": 0})
    if not match: raise HTTPException(404, "Match tidak ditemukan")
    summary = await _seni_summary(mid)
    attached = await _attach_match_athletes(summary, match)
    redacted = []
    for athlete in attached.get("athletes") or []:
        public_athlete = _redact_public_athlete(athlete)
        if public_athlete:
            redacted.append(public_athlete)
    attached["athletes"] = redacted
    return attached

@api.post("/matches/{mid}/seni/score")
async def post_seni_score(mid: str, data: SeniScoreIn, user=Depends(require_roles("jury", "head_jury", "admin"))):
    match = await db.matches.find_one({"id": mid})
    if not match: raise HTTPException(404, "Match tidak ditemukan")
    _reject_locked_seni(match)
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
    match = await db.matches.find_one({"id": mid})
    if not match: raise HTTPException(404, "Match tidak ditemukan")
    _reject_locked_seni(match)
    await db.seni_scores.delete_one({"match_id": mid, "jury_id": user["id"]})
    await broadcast_match_update(mid, "seni_score_deleted")
    return await _seni_summary(mid)

@api.post("/matches/{mid}/seni/penalty")
async def post_seni_penalty(mid: str, data: SeniPenaltyIn, user=Depends(require_roles("head_jury", "admin"))):
    match = await db.matches.find_one({"id": mid})
    if not match: raise HTTPException(404, "Match tidak ditemukan")
    _reject_locked_seni(match)
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
    match = await db.matches.find_one({"id": mid})
    if not match: raise HTTPException(404, "Match tidak ditemukan")
    _reject_locked_seni(match)
    await db.seni_penalties.delete_one({"id": pid, "match_id": mid})
    await broadcast_match_update(mid, "seni_penalty_deleted")
    return await _seni_summary(mid)

@api.post("/matches/{mid}/seni/finalize")
async def finalize_seni(mid: str, user=Depends(require_roles("head_jury", "admin"))):
    match = await db.matches.find_one({"id": mid})
    if not match: raise HTTPException(404, "Match tidak ditemukan")
    _reject_locked_seni(match)
    summary = await _seni_summary(mid)
    if summary["jury_count"] < 3:
        raise HTTPException(400, "Minimal 3 juri untuk mengesahkan nilai seni")
    update = {
        "status": "approved",
        "winner_corner": None,
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
    return await _seni_summary(mid)

# ============ WebSocket endpoints ============
WS_AUTH_TIMEOUT_SEC = 10

def _token_from_ws_message(raw: str) -> str:
    text = (raw or "").strip()
    if text.lower().startswith("bearer "):
        return text[7:].strip()
    if text.startswith("{"):
        try:
            payload = json.loads(text)
        except json.JSONDecodeError:
            return ""
        if isinstance(payload, dict) and payload.get("token"):
            return str(payload["token"]).strip()
        return ""
    return text

async def _user_from_access_token(token: str) -> Optional[Dict[str, Any]]:
    if not token:
        return None
    try:
        payload = decode_token(token)
    except jwt.PyJWTError:
        return None
    user_id = payload.get("sub")
    if not user_id:
        return None
    return await db.users.find_one({"id": user_id}, {"_id": 0, "password_hash": 0})

async def _close_ws(websocket: WebSocket, code: int = 1008) -> None:
    try:
        await websocket.close(code=code)
    except Exception:
        pass

@app.websocket("/api/ws/arena/{arena_id}")
async def ws_arena(websocket: WebSocket, arena_id: str):
    room = f"arena:{arena_id}"
    await manager.connect(room, websocket)
    try:
        # send initial state
        m = await db.matches.find_one({"arena_id": arena_id, "status": {"$in": ["in_progress", "paused"]}})
        if m:
            await settle_expired_timer(m)
            state = redact_public_match(await compute_match_state(m["id"]))
            if state:
                await websocket.send_text(json.dumps({"type": "initial", "match_id": m["id"], "state": state}, default=str))
        while True:
            await websocket.receive_text()  # keepalive
    except WebSocketDisconnect:
        await manager.disconnect(room, websocket)
    except Exception:
        await manager.disconnect(room, websocket)

@app.websocket("/api/ws/match/{match_id}")
async def ws_match(websocket: WebSocket, match_id: str):
    """Jury socket. The first frame must be a login token; pending votes stay in this room."""
    await websocket.accept()
    room = f"match:{match_id}"
    joined = False
    try:
        raw = await asyncio.wait_for(websocket.receive_text(), timeout=WS_AUTH_TIMEOUT_SEC)
        user = await _user_from_access_token(_token_from_ws_message(raw))
        if not user:
            await _close_ws(websocket)
            return
        async with manager.lock:
            manager.rooms.setdefault(room, []).append(websocket)
        joined = True
        await _load_match_settled(match_id)
        state = await compute_match_state(match_id)
        await websocket.send_text(json.dumps({"type": "initial", "match_id": match_id, "state": state}, default=str))
        while True:
            await websocket.receive_text()
    except WebSocketDisconnect:
        pass
    except Exception:
        await _close_ws(websocket)
    finally:
        if joined:
            await manager.disconnect(room, websocket)

@app.websocket("/api/ws/public/match/{match_id}")
async def ws_public_match(websocket: WebSocket, match_id: str):
    """Public scoreboard socket. Jury room /ws/match stays complete, including pending votes."""
    room = f"public:{match_id}"
    await manager.connect(room, websocket)
    try:
        await _load_match_settled(match_id)
        state = redact_public_match(await compute_match_state(match_id))
        if state:
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
    if env_flag("SEED_DEMO"):
        await seed_demo_users()
        # Akun demo saja. Event yang sudah dihapus tidak boleh dibuat ulang saat restart.
    global _expire_task
    if _expire_task is None or _expire_task.done():
        _expire_task = asyncio.create_task(_expire_running_matches_loop())
    logger.info("Startup complete")

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
    """Create the admin account once. A password changed in the app is left alone on restart."""
    existing = await db.users.find_one({"email": ADMIN_EMAIL}, {"_id": 1})
    if existing:
        return
    await db.users.insert_one({
        "id": new_id(),
        "email": ADMIN_EMAIL,
        "password_hash": hash_password(ADMIN_PASSWORD),
        "name": "Administrator",
        "role": "admin",
        "created_at": now_iso(),
    })

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
    # Only seed once. Match name, code, or slug so a renamed demo event is not inserted again.
    if await db.events.find_one({
        "$or": [
            {"name": "Kejuaraan Nasional Pencak Silat 2026 (Demo)"},
            {"code": "KEJURNAS2026"},
            {"slug": "kejurnas-pencak-silat-2026"},
        ]
    }):
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
        "institution_name": "",
        "institution_logo_url": "",
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
        "jury_consensus_window_sec": 2,
        "technical_win_margin": 0,
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
        "timer": {"running": False, "remaining_sec": 120, "round": 1, "started_at": None, "phase": "round"},
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
