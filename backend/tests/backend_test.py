"""
Backend regression tests for Silat Scoring API.
Covers: health, auth (admin + seeded demo users), CRUD master data,
match creation, timer flow, jury scoring, referee penalty, role-based
access control, head jury approval, score correction, and public
(no-auth) endpoints + WebSocket smoke test.
"""
import os
import json
import time
import asyncio
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL") or os.environ["BASE_URL"]
BASE_URL = BASE_URL.rstrip("/")
API = f"{BASE_URL}/api"


# ---------- shared session / login helpers ----------
def _login(email, password):
    r = requests.post(f"{API}/auth/login", json={"email": email, "password": password}, timeout=20)
    assert r.status_code == 200, f"login {email} failed: {r.status_code} {r.text}"
    return r.json()["token"]


@pytest.fixture(scope="session")
def tokens():
    return {
        "admin": _login("admin@silat.id", "admin123"),
        "operator": _login("operator@silat.id", "password123"),
        "juri1": _login("juri1@silat.id", "password123"),
        "juri2": _login("juri2@silat.id", "password123"),
        "wasit": _login("wasit@silat.id", "password123"),
        "ketuajuri": _login("ketuajuri@silat.id", "password123"),
        "timer": _login("timer@silat.id", "password123"),
    }


def H(tok):
    return {"Authorization": f"Bearer {tok}", "Content-Type": "application/json"}


# ---------- module-level fixture: seeded demo event objects ----------
@pytest.fixture(scope="session")
def demo(tokens):
    events = requests.get(f"{API}/events", headers=H(tokens["admin"])).json()
    ev = next((e for e in events if "Demo" in e.get("name", "")), events[0])
    arenas = requests.get(f"{API}/arenas?event_id={ev['id']}", headers=H(tokens["admin"])).json()
    athletes = requests.get(f"{API}/athletes?event_id={ev['id']}", headers=H(tokens["admin"])).json()
    rules = requests.get(f"{API}/scoring-rules?event_id={ev['id']}", headers=H(tokens["admin"])).json()
    return {"event": ev, "arenas": arenas, "athletes": athletes, "rule": rules[0]}


# ===================== Health =====================
def test_health():
    r = requests.get(f"{API}/")
    assert r.status_code == 200
    body = r.json()
    assert body.get("status") == "ok"


# ===================== Auth =====================
def test_admin_login_and_me():
    r = requests.post(f"{API}/auth/login", json={"email": "admin@silat.id", "password": "admin123"})
    assert r.status_code == 200
    data = r.json()
    assert "token" in data and data["user"]["role"] == "admin"
    me = requests.get(f"{API}/auth/me", headers=H(data["token"]))
    assert me.status_code == 200
    assert me.json()["email"] == "admin@silat.id"


def test_admin_login_wrong_password():
    r = requests.post(f"{API}/auth/login", json={"email": "admin@silat.id", "password": "WRONG"})
    assert r.status_code == 401


@pytest.mark.parametrize("email,role", [
    ("operator@silat.id", "operator"),
    ("juri1@silat.id", "jury"),
    ("juri2@silat.id", "jury"),
    ("juri3@silat.id", "jury"),
    ("wasit@silat.id", "referee"),
    ("ketuajuri@silat.id", "head_jury"),
    ("timer@silat.id", "timer"),
])
def test_demo_users_login(email, role):
    r = requests.post(f"{API}/auth/login", json={"email": email, "password": "password123"})
    assert r.status_code == 200, r.text
    assert r.json()["user"]["role"] == role


def test_me_requires_token():
    r = requests.get(f"{API}/auth/me")
    assert r.status_code == 401


# ===================== Master data CRUD (admin) =====================
def test_admin_event_crud(tokens):
    h = H(tokens["admin"])
    create = requests.post(f"{API}/events", headers=h, json={"name": "TEST_Event_X", "location": "Bandung"})
    assert create.status_code == 200
    eid = create.json()["id"]
    # list and find
    lst = requests.get(f"{API}/events", headers=h).json()
    assert any(e["id"] == eid for e in lst)
    # delete
    d = requests.delete(f"{API}/events/{eid}", headers=h)
    assert d.status_code == 200


def test_admin_master_data_scoped(tokens, demo):
    h = H(tokens["admin"])
    eid = demo["event"]["id"]
    # Category
    c = requests.post(f"{API}/categories", headers=h, json={"event_id": eid, "name": "TEST_Cat", "type": "tanding", "gender": "putra"})
    assert c.status_code == 200
    cid = c.json()["id"]
    # Class
    cls = requests.post(f"{API}/classes", headers=h, json={"event_id": eid, "category_id": cid, "name": "TEST_Class"})
    assert cls.status_code == 200
    # Contingent
    con = requests.post(f"{API}/contingents", headers=h, json={"event_id": eid, "name": "TEST_Cont"})
    assert con.status_code == 200
    # Athlete
    ath = requests.post(f"{API}/athletes", headers=h, json={"event_id": eid, "contingent_id": con.json()["id"], "name": "TEST_Athlete", "gender": "putra"})
    assert ath.status_code == 200
    # Arena
    ar = requests.post(f"{API}/arenas", headers=h, json={"event_id": eid, "name": "TEST_Arena"})
    assert ar.status_code == 200
    # Scoping
    cats = requests.get(f"{API}/categories?event_id={eid}", headers=h).json()
    assert any(x["id"] == cid for x in cats)
    # Cleanup
    requests.delete(f"{API}/categories/{cid}", headers=h)
    requests.delete(f"{API}/classes/{cls.json()['id']}", headers=h)
    requests.delete(f"{API}/athletes/{ath.json()['id']}", headers=h)
    requests.delete(f"{API}/contingents/{con.json()['id']}", headers=h)
    requests.delete(f"{API}/arenas/{ar.json()['id']}", headers=h)


def test_scoring_rule_update(tokens, demo):
    h = H(tokens["admin"])
    rule = demo["rule"]
    payload = {**rule, "round_duration_sec": 90}
    # strip server-side keys
    payload = {k: v for k, v in payload.items() if k in {"event_id", "name", "category_type", "round_count", "round_duration_sec", "rest_duration_sec", "points", "penalty_points", "binaan_limit", "is_default"}}
    r = requests.put(f"{API}/scoring-rules/{rule['id']}", headers=h, json=payload)
    assert r.status_code == 200
    assert r.json()["round_duration_sec"] == 90
    # revert
    payload["round_duration_sec"] = 120
    requests.put(f"{API}/scoring-rules/{rule['id']}", headers=h, json=payload)


# ===================== Match flow =====================
@pytest.fixture(scope="session")
def created_match(tokens, demo):
    h = H(tokens["operator"])
    payload = {
        "event_id": demo["event"]["id"],
        "arena_id": demo["arenas"][0]["id"],
        "scoring_rule_id": demo["rule"]["id"],
        "red_athlete_id": demo["athletes"][0]["id"],
        "blue_athlete_id": demo["athletes"][1]["id"],
        "match_number": 999,
        "round_label": "TEST_Babak",
    }
    r = requests.post(f"{API}/matches", headers=h, json=payload)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["status"] == "scheduled"
    assert body["timer"]["remaining_sec"] > 0
    yield body
    # cleanup
    requests.delete(f"{API}/matches/{body['id']}", headers=H(tokens["admin"]))


def test_match_created_with_timer(created_match):
    assert created_match["status"] == "scheduled"
    assert created_match["current_round"] == 1


def test_timer_start_and_state(tokens, created_match):
    mid = created_match["id"]
    r = requests.post(f"{API}/matches/{mid}/timer", headers=H(tokens["timer"]), json={"action": "start"})
    assert r.status_code == 200, r.text
    state = r.json()
    assert state["status"] == "in_progress"
    assert state["timer"]["running"] is True
    # GET match
    g = requests.get(f"{API}/matches/{mid}", headers=H(tokens["timer"]))
    assert g.status_code == 200
    assert g.json()["status"] == "in_progress"


def test_jury_scoring(tokens, created_match):
    mid = created_match["id"]
    # red pukulan (=1)
    r1 = requests.post(f"{API}/matches/{mid}/actions", headers=H(tokens["juri1"]),
                       json={"corner": "red", "action_type": "score", "code": "pukulan"})
    assert r1.status_code == 200, r1.text
    assert r1.json()["points"] == 1
    # blue tendangan (=2)
    r2 = requests.post(f"{API}/matches/{mid}/actions", headers=H(tokens["juri2"]),
                       json={"corner": "blue", "action_type": "score", "code": "tendangan"})
    assert r2.status_code == 200
    assert r2.json()["points"] == 2
    # red jatuhan (=3) via fall action type
    r3 = requests.post(f"{API}/matches/{mid}/actions", headers=H(tokens["wasit"]),
                       json={"corner": "red", "action_type": "fall", "code": "jatuhan"})
    assert r3.status_code == 200
    assert r3.json()["points"] == 3

    g = requests.get(f"{API}/matches/{mid}", headers=H(tokens["admin"])).json()
    assert g["red"]["score"] == 4  # 1 + 3
    assert g["blue"]["score"] == 2


def test_role_based_access(tokens, created_match):
    mid = created_match["id"]
    # wasit cannot score
    r = requests.post(f"{API}/matches/{mid}/actions", headers=H(tokens["wasit"]),
                      json={"corner": "red", "action_type": "score", "code": "pukulan"})
    assert r.status_code == 403
    # jury cannot penalty
    r2 = requests.post(f"{API}/matches/{mid}/actions", headers=H(tokens["juri1"]),
                       json={"corner": "red", "action_type": "penalty", "code": "teguran_1"})
    assert r2.status_code == 403
    # timer cannot give actions at all (outer role check)
    r3 = requests.post(f"{API}/matches/{mid}/actions", headers=H(tokens["timer"]),
                       json={"corner": "red", "action_type": "score", "code": "pukulan"})
    assert r3.status_code == 403


def test_referee_penalty(tokens, created_match):
    mid = created_match["id"]
    before = requests.get(f"{API}/matches/{mid}", headers=H(tokens["admin"])).json()
    blue_before = before["blue"]["score"]
    r = requests.post(f"{API}/matches/{mid}/actions", headers=H(tokens["wasit"]),
                      json={"corner": "red", "action_type": "penalty", "code": "teguran_1"})
    assert r.status_code == 200, r.text
    assert r.json()["points"] == 1
    after = requests.get(f"{API}/matches/{mid}", headers=H(tokens["admin"])).json()
    assert after["blue"]["score"] == blue_before + 1
    assert after["red"]["teguran"] >= 1


def test_timer_pause_next_end(tokens, created_match):
    mid = created_match["id"]
    p = requests.post(f"{API}/matches/{mid}/timer", headers=H(tokens["timer"]), json={"action": "pause"})
    assert p.status_code == 200
    assert p.json()["status"] == "paused"
    n = requests.post(f"{API}/matches/{mid}/timer", headers=H(tokens["timer"]), json={"action": "next_round"})
    assert n.status_code == 200
    assert n.json()["current_round"] == 2
    e = requests.post(f"{API}/matches/{mid}/timer", headers=H(tokens["timer"]), json={"action": "end_match"})
    assert e.status_code == 200
    assert e.json()["status"] == "finished"


def test_score_correction(tokens, created_match):
    mid = created_match["id"]
    logs = requests.get(f"{API}/matches/{mid}/logs", headers=H(tokens["admin"])).json()
    valid_log = next((l for l in logs if l.get("valid") and l["action_type"] in ("score", "fall")), None)
    assert valid_log, "No valid log to invalidate"
    before = requests.get(f"{API}/matches/{mid}", headers=H(tokens["admin"])).json()
    inv = requests.post(f"{API}/matches/{mid}/logs/{valid_log['id']}/invalidate", headers=H(tokens["ketuajuri"]))
    assert inv.status_code == 200
    after = requests.get(f"{API}/matches/{mid}", headers=H(tokens["admin"])).json()
    color = valid_log["corner"]
    assert after[color]["score"] == before[color]["score"] - valid_log["points"]


def test_head_jury_approve(tokens, created_match):
    mid = created_match["id"]
    r = requests.post(f"{API}/matches/{mid}/approve", headers=H(tokens["ketuajuri"]),
                      json={"decision_method": "menang_angka"})
    assert r.status_code == 200, r.text
    data = r.json()
    assert data["status"] == "approved"
    assert data["winner_corner"] in ("red", "blue", "draw")
    assert data["approved_by"]


# ===================== Public endpoints (no auth) =====================
def test_public_endpoints(demo):
    r1 = requests.get(f"{API}/public/events")
    assert r1.status_code == 200 and isinstance(r1.json(), list)
    r2 = requests.get(f"{API}/public/arenas?event_id={demo['event']['id']}")
    assert r2.status_code == 200 and len(r2.json()) >= 1
    r3 = requests.get(f"{API}/public/athletes?event_id={demo['event']['id']}")
    assert r3.status_code == 200
    arena_id = demo["arenas"][0]["id"]
    r4 = requests.get(f"{API}/public/arenas/{arena_id}/current")
    assert r4.status_code == 200


def test_public_match_by_id(tokens, demo):
    # find any existing match for arena
    matches = requests.get(f"{API}/matches?event_id={demo['event']['id']}", headers=H(tokens["admin"])).json()
    if not matches:
        pytest.skip("no matches")
    mid = matches[0]["id"]
    r = requests.get(f"{API}/public/matches/{mid}")
    assert r.status_code == 200


# ===================== WebSocket smoke test =====================
def test_websocket_arena(demo, tokens, created_match):
    try:
        import websockets  # noqa
    except ImportError:
        pytest.skip("websockets not installed")

    ws_base = BASE_URL.replace("https://", "wss://").replace("http://", "ws://")
    arena_id = created_match["arena_id"]
    mid = created_match["id"]

    async def run():
        import websockets
        url = f"{ws_base}/api/ws/match/{mid}"
        async with websockets.connect(url, open_timeout=10) as ws:
            msg = await asyncio.wait_for(ws.recv(), timeout=10)
            data = json.loads(msg)
            assert data["type"] == "initial"
            assert data["match_id"] == mid
        return True

    assert asyncio.get_event_loop().run_until_complete(run())
