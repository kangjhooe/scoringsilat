"""
Phase 2 backend tests:
- Self-registration (public, no auth) → REG-{KODE}-NNN
- Document upload validation (image/pdf accept, txt reject)
- Admin status transitions + history[]
- Quota enforcement on accepted
- Convert-to-athlete (source='self_registration', PST-{KODE}-NNN, contingent auto-create)
- Manual athlete creation still works + auto participant_number
- WAHA config + test-connection / test-send error paths
"""
import io
import os
import time
from concurrent.futures import ThreadPoolExecutor
import pytest
import requests

BASE_URL = (os.environ.get("REACT_APP_BACKEND_URL") or os.environ["BASE_URL"]).rstrip("/")
API = f"{BASE_URL}/api"


def _login(email, password):
    r = requests.post(f"{API}/auth/login", json={"email": email, "password": password}, timeout=20)
    assert r.status_code == 200, r.text
    return r.json()["token"]


def H(tok):
    return {"Authorization": f"Bearer {tok}", "Content-Type": "application/json"}


@pytest.fixture(scope="module")
def admin_tok():
    return _login("admin@silat.id", "admin123")


@pytest.fixture(scope="module")
def operator_tok():
    return _login("operator@silat.id", "password123")


def _event_code(ev):
    return (ev.get("code") or ev.get("name") or "EVENT").upper().replace(" ", "")


@pytest.fixture(scope="module")
def demo_event(admin_tok):
    evs = requests.get(f"{API}/events", headers=H(admin_tok)).json()
    usable = [e for e in evs if e.get("status") != "closed" and e.get("registration_enabled") is not False]
    ev = next((e for e in usable if (e.get("code") or "").upper() == "DEMO"), None)
    if ev is None and usable:
        ev = usable[0]
    assert ev, "event missing"
    return ev


@pytest.fixture(scope="module")
def seni_category(admin_tok, demo_event):
    """Non-tanding category so class and weight stay optional for older registration flows."""
    created = requests.post(f"{API}/categories", headers=H(admin_tok), json={
        "event_id": demo_event["id"],
        "name": "TEST_SeniDaftar",
        "type": "tunggal",
        "gender": "campuran",
    })
    assert created.status_code == 200, created.text
    cat = created.json()
    yield cat
    requests.delete(f"{API}/categories/{cat['id']}", headers=H(admin_tok))


# Tiny 1x1 PNG bytes
PNG_BYTES = (
    b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01\x08\x06\x00\x00\x00\x1f\x15\xc4\x89"
    b"\x00\x00\x00\rIDATx\x9cc\xf8\xcf\xc0\x00\x00\x00\x03\x00\x01\x18\xdd\x8d\xb4\x00\x00\x00\x00IEND\xaeB`\x82"
)


# ===================== Public uploads =====================
class TestPublicUpload:
    def test_upload_png_ok(self):
        files = {"file": ("doc.png", io.BytesIO(PNG_BYTES), "image/png")}
        r = requests.post(f"{API}/public/uploads/document", files=files)
        assert r.status_code == 200, r.text
        data = r.json()
        assert data["url"].startswith("/api/uploads/")
        assert data["size"] == len(PNG_BYTES)

    def test_upload_pdf_ok(self):
        files = {"file": ("doc.pdf", io.BytesIO(b"%PDF-1.4\n%EOF"), "application/pdf")}
        r = requests.post(f"{API}/public/uploads/document", files=files)
        assert r.status_code == 200, r.text
        assert r.json()["url"].endswith(".pdf")

    def test_upload_txt_rejected(self):
        files = {"file": ("doc.txt", io.BytesIO(b"hello"), "text/plain")}
        r = requests.post(f"{API}/public/uploads/document", files=files)
        assert r.status_code == 400


# ===================== Public registration =====================
class TestPublicRegistration:
    """Creates registrations sequentially and verifies counter format."""

    def test_create_increments_and_format(self, demo_event, seni_category):
        # Two fresh registrations; numbers should be REG-DEMO-NNN and increment
        nums = []
        for i in range(2):
            payload = {
                "event_id": demo_event["id"],
                "category_id": seni_category["id"],
                "contingent_name": f"TEST_PublicCont_{i}",
                "name": f"TEST_PublicAthlete_{int(time.time())}_{i}",
                "gender": "putra",
                "phone": "081234567890",
            }
            r = requests.post(f"{API}/public/registrations", json=payload)
            assert r.status_code == 200, r.text
            body = r.json()
            assert body["status"] == "pending_verification"
            assert isinstance(body.get("access_code"), str) and len(body["access_code"]) >= 6
            n = body["registration_number"]
            assert n.startswith(f"REG-{_event_code(demo_event)}-"), n
            # Three digit suffix
            assert len(n.split("-")[-1]) == 3 and n.split("-")[-1].isdigit()
            nums.append(n)
            # Save for next tests
            TestPublicRegistration._last = body
        assert int(nums[1].split("-")[-1]) == int(nums[0].split("-")[-1]) + 1

    def test_attach_file_and_redact_admin_notes_by_number(self, demo_event):
        # Upload doc and attach
        files = {"file": ("photo.png", io.BytesIO(PNG_BYTES), "image/png")}
        up = requests.post(f"{API}/public/uploads/document", files=files).json()
        reg = TestPublicRegistration._last
        att = requests.post(
            f"{API}/public/registrations/{reg['id']}/files",
            json={"registration_id": reg["id"], "label": "photo", "url": up["url"], "access_code": reg["access_code"]},
        )
        assert att.status_code == 200, att.text
        # lookup with number + code returns files, and hides admin notes and the code itself
        looked = requests.post(
            f"{API}/public/registrations/lookup",
            json={"registration_number": reg["registration_number"], "access_code": reg["access_code"]},
        )
        assert looked.status_code == 200, looked.text
        data = looked.json()
        assert "admin_notes" not in data
        assert "access_code" not in data
        assert data["name"] == reg["name"]
        assert any(f.get("label") == "photo" for f in data.get("files", []))
        # wrong code and unknown number share one message so numbers cannot be enumerated
        wrong_code = requests.post(
            f"{API}/public/registrations/lookup",
            json={"registration_number": reg["registration_number"], "access_code": "kode-salah"},
        )
        wrong_number = requests.post(
            f"{API}/public/registrations/lookup",
            json={"registration_number": "REG-TIDAK-ADA-000", "access_code": reg["access_code"]},
        )
        assert wrong_code.status_code == 404
        assert wrong_number.status_code == 404
        assert wrong_code.json()["detail"] == wrong_number.json()["detail"]
        blank_code = requests.post(
            f"{API}/public/registrations/lookup",
            json={"registration_number": reg["registration_number"], "access_code": "   "},
        )
        assert blank_code.status_code == 404
        assert blank_code.json()["detail"] == wrong_number.json()["detail"]
        assert reg["registration_number"] not in wrong_code.text
        # number alone, or the old GET routes, no longer return the registration
        for url in (
            f"{API}/public/registrations/by-number/{reg['registration_number']}",
            f"{API}/public/registrations/{reg['id']}",
        ):
            old = requests.get(url)
            assert old.status_code in (404, 405)
            if old.headers.get("content-type", "").startswith("application/json"):
                payload = old.json()
                if isinstance(payload, dict):
                    assert payload.get("registration_number") != reg["registration_number"]
                    assert payload.get("access_code") != reg["access_code"]

    def test_committee_detail_returns_access_code(self, admin_tok, operator_tok):
        reg = TestPublicRegistration._last
        for tok in (admin_tok, operator_tok):
            detail = requests.get(f"{API}/registrations/{reg['id']}", headers=H(tok))
            assert detail.status_code == 200, detail.text
            body = detail.json()
            assert body.get("access_code") == reg["access_code"]
            assert body.get("registration_number") == reg["registration_number"]


def _local_db():
    """Mongo used by a locally running API. Skip when the target is remote."""
    from urllib.parse import urlparse
    host = (urlparse(BASE_URL).hostname or "").lower()
    if host not in ("localhost", "127.0.0.1"):
        pytest.skip("legacy access-code backfill is checked against the local database")
    try:
        from dotenv import load_dotenv
        from pymongo import MongoClient
    except ImportError:
        pytest.skip("pymongo or dotenv is not installed")
    load_dotenv(os.path.join(os.path.dirname(__file__), "..", ".env"))
    url = os.environ.get("MONGO_URL")
    name = os.environ.get("DB_NAME")
    if not url or not name:
        pytest.skip("MONGO_URL or DB_NAME is missing")
    return MongoClient(url)[name]


class TestLegacyAccessCode:
    def test_opening_detail_mints_code_once(self, admin_tok, operator_tok, demo_event, seni_category):
        db = _local_db()
        created = requests.post(f"{API}/public/registrations", json={
            "event_id": demo_event["id"],
            "category_id": seni_category["id"],
            "contingent_name": "TEST_LegacyCont",
            "name": f"TEST_Legacy_{int(time.time())}",
            "gender": "putri",
        })
        assert created.status_code == 200, created.text
        reg = created.json()
        original = reg["access_code"]
        try:
            db.registrations.update_one({"id": reg["id"]}, {"$unset": {"access_code": ""}})
            detail = requests.get(f"{API}/registrations/{reg['id']}", headers=H(operator_tok))
            assert detail.status_code == 200, detail.text
            code = detail.json().get("access_code")
            assert isinstance(code, str) and len(code) >= 6
            assert code != original
            again = requests.get(f"{API}/registrations/{reg['id']}", headers=H(operator_tok)).json()
            assert again.get("access_code") == code
            ok = requests.post(f"{API}/public/registrations/lookup", json={
                "registration_number": reg["registration_number"],
                "access_code": code,
            })
            assert ok.status_code == 200, ok.text
            assert "access_code" not in ok.json()
            stale = requests.post(f"{API}/public/registrations/lookup", json={
                "registration_number": reg["registration_number"],
                "access_code": original,
            })
            unknown = requests.post(f"{API}/public/registrations/lookup", json={
                "registration_number": "REG-TIDAK-ADA-000",
                "access_code": code,
            })
            assert stale.status_code == 404
            assert unknown.status_code == 404
            assert stale.json()["detail"] == unknown.json()["detail"]
        finally:
            requests.delete(f"{API}/registrations/{reg['id']}", headers=H(admin_tok))


PUBLIC_ATHLETE_KEYS = {"id", "name", "photo_url", "gender", "weight", "contingent_id"}


class TestPublicAthleteRedaction:
    def test_public_list_and_bracket_hide_private_fields(self, admin_tok, demo_event):
        h = H(admin_tok)
        eid = demo_event["id"]
        phone = "081199988877"
        cont = requests.post(f"{API}/contingents", headers=h, json={"event_id": eid, "name": f"TEST_RedactCont_{int(time.time())}"}).json()
        cat = requests.post(f"{API}/categories", headers=h, json={"event_id": eid, "name": "TEST_RedactCat", "type": "tanding", "gender": "putra"}).json()
        cls = requests.post(f"{API}/classes", headers=h, json={"event_id": eid, "category_id": cat["id"], "name": "TEST_RedactCls"}).json()
        ath = requests.post(f"{API}/athletes", headers=h, json={
            "event_id": eid,
            "contingent_id": cont["id"],
            "category_id": cat["id"],
            "class_id": cls["id"],
            "name": f"TEST_RedactAth_{int(time.time())}",
            "gender": "putra",
            "weight": 52,
            "dob": "2001-02-03",
            "phone": phone,
            "photo_url": "",
            "registration_id": "reg-rahasia",
        }).json()
        bracket = requests.post(f"{API}/brackets", headers=h, json={
            "event_id": eid,
            "category_id": cat["id"],
            "class_id": cls["id"],
            "name": "TEST_RedactBracket",
            "size": 4,
            "auto_fill": False,
        }).json()
        try:
            listed = requests.get(f"{API}/public/athletes", params={"event_id": eid})
            assert listed.status_code == 200, listed.text
            rows = listed.json()
            assert rows, "public athlete list is empty"
            for row in rows:
                assert set(row.keys()) == PUBLIC_ATHLETE_KEYS
                assert "phone" not in row and "dob" not in row and "registration_id" not in row
            found = next(a for a in rows if a["id"] == ath["id"])
            assert found["name"] == ath["name"]
            assert found["weight"] == 52
            assert found["gender"] == "putra"
            assert found["contingent_id"] == cont["id"]
            private = requests.get(f"{API}/athletes", headers=h, params={"event_id": eid}).json()
            private_row = next(a for a in private if a["id"] == ath["id"])
            assert private_row.get("phone") == phone
            assert private_row.get("dob") == "2001-02-03"

            slot = next(s for s in bracket["slots"] if s.get("round") == 1 and s.get("position") == 0)
            assigned = requests.put(
                f"{API}/brackets/{bracket['id']}/slots/{slot['id']}",
                headers=h,
                json={"athlete_id": ath["id"]},
            )
            assert assigned.status_code == 200, assigned.text
            admin_ath = next(s["athlete"] for s in assigned.json()["slots"] if (s.get("athlete") or {}).get("id") == ath["id"])
            assert admin_ath.get("phone") == phone
            public_bracket = requests.get(f"{API}/public/brackets/{bracket['id']}")
            assert public_bracket.status_code == 200, public_bracket.text
            public_ath = next(s["athlete"] for s in public_bracket.json()["slots"] if (s.get("athlete") or {}).get("id") == ath["id"])
            assert set(public_ath.keys()) == PUBLIC_ATHLETE_KEYS
            assert public_ath["name"] == ath["name"]
            assert public_ath["weight"] == 52
            assert "phone" not in public_ath and "dob" not in public_ath and "registration_id" not in public_ath
        finally:
            requests.delete(f"{API}/brackets/{bracket['id']}", headers=h)
            requests.delete(f"{API}/athletes/{ath['id']}", headers=h)
            requests.delete(f"{API}/classes/{cls['id']}", headers=h)
            requests.delete(f"{API}/categories/{cat['id']}", headers=h)
            requests.delete(f"{API}/contingents/{cont['id']}", headers=h)


# ===================== Admin list / status transitions =====================
class TestAdminTransitions:
    def test_admin_list_and_filter(self, admin_tok, demo_event):
        r = requests.get(
            f"{API}/registrations?event_id={demo_event['id']}&status_filter=pending_verification",
            headers=H(admin_tok),
        )
        assert r.status_code == 200, r.text
        regs = r.json()
        assert isinstance(regs, list) and len(regs) >= 1
        assert all(x["status"] == "pending_verification" for x in regs)

    def test_status_transitions_history(self, admin_tok, demo_event, seni_category):
        # Create new reg
        payload = {
            "event_id": demo_event["id"],
            "category_id": seni_category["id"],
            "contingent_name": "TEST_TransitionCont",
            "name": f"TEST_Transition_{int(time.time())}",
            "gender": "putra",
        }
        reg = requests.post(f"{API}/public/registrations", json=payload).json()
        rid = reg["id"]
        # admin user id
        me = requests.get(f"{API}/auth/me", headers=H(admin_tok)).json()
        # Cycle: need_revision -> verified -> accepted (no quota class) -> reserve -> rejected
        for st in ["need_revision", "verified", "accepted", "reserve", "rejected"]:
            r = requests.post(
                f"{API}/registrations/{rid}/status",
                headers=H(admin_tok),
                json={"status": st, "admin_notes": f"note-{st}"},
            )
            assert r.status_code == 200, r.text
            assert r.json()["status"] == st
        final = requests.get(f"{API}/registrations/{rid}", headers=H(admin_tok)).json()
        hist = final.get("history", [])
        # Initial entry is by='public', then 5 admin-driven status transitions
        assert len(hist) >= 6
        admin_entries = [h for h in hist if h.get("by") != "public"]
        assert len(admin_entries) >= 5
        assert all(h.get("by") == me["id"] for h in admin_entries)
        requests.delete(f"{API}/registrations/{rid}", headers=H(admin_tok))


# ===================== Quota enforcement =====================
class TestQuota:
    def test_class_quota_full_rejects_second_accept(self, admin_tok, demo_event):
        h = H(admin_tok)
        eid = demo_event["id"]
        # Create category + class with quota=1
        cat = requests.post(f"{API}/categories", headers=h, json={"event_id": eid, "name": "TEST_QuotaCat", "type": "tanding", "gender": "putra"}).json()
        cls = requests.post(f"{API}/classes", headers=h, json={"event_id": eid, "category_id": cat["id"], "name": "TEST_QuotaCls", "quota": 1}).json()
        try:
            reg_ids = []
            for i in range(2):
                p = {
                    "event_id": eid,
                    "category_id": cat["id"],
                    "class_id": cls["id"],
                    "contingent_name": f"TEST_QuotaCont_{i}",
                    "name": f"TEST_QuotaAthlete_{int(time.time())}_{i}",
                    "gender": "putra",
                }
                r = requests.post(f"{API}/public/registrations", json=p)
                assert r.status_code == 200
                reg_ids.append(r.json()["id"])
                # Verify -> accept candidacy
                requests.post(f"{API}/registrations/{reg_ids[-1]}/status", headers=h, json={"status": "verified"})
            # Accept first OK
            r1 = requests.post(f"{API}/registrations/{reg_ids[0]}/status", headers=h, json={"status": "accepted"})
            assert r1.status_code == 200
            # Accept second → 400 with Kuota
            r2 = requests.post(f"{API}/registrations/{reg_ids[1]}/status", headers=h, json={"status": "accepted"})
            assert r2.status_code == 400
            assert "Kuota" in r2.text or "kuota" in r2.text
        finally:
            # cleanup
            for rid in (reg_ids if 'reg_ids' in locals() else []):
                requests.delete(f"{API}/registrations/{rid}", headers=h)
            requests.delete(f"{API}/classes/{cls['id']}", headers=h)
            requests.delete(f"{API}/categories/{cat['id']}", headers=h)

    def test_category_quota_and_releasing_slot(self, admin_tok, demo_event):
        h = H(admin_tok)
        eid = demo_event["id"]
        cat = requests.post(f"{API}/categories", headers=h, json={
            "event_id": eid, "name": "TEST_CatQuota", "type": "tanding", "gender": "putra", "quota": 1,
        }).json()
        cls = requests.post(f"{API}/classes", headers=h, json={
            "event_id": eid, "category_id": cat["id"], "name": "TEST_CatQuotaCls", "quota": 0,
        }).json()
        reg_ids = []
        try:
            for i in range(2):
                created = requests.post(f"{API}/public/registrations", json={
                    "event_id": eid,
                    "category_id": cat["id"],
                    "class_id": cls["id"],
                    "contingent_name": f"TEST_CatQuotaCont_{i}",
                    "name": f"TEST_CatQuota_{time.time_ns()}_{i}",
                    "gender": "putra",
                })
                assert created.status_code == 200, created.text
                reg_ids.append(created.json()["id"])
                verified = requests.post(f"{API}/registrations/{reg_ids[-1]}/status", headers=h, json={"status": "verified"})
                assert verified.status_code == 200, verified.text
            first = requests.post(f"{API}/registrations/{reg_ids[0]}/status", headers=h, json={"status": "accepted"})
            assert first.status_code == 200, first.text
            blocked = requests.post(f"{API}/registrations/{reg_ids[1]}/status", headers=h, json={"status": "accepted"})
            assert blocked.status_code == 400
            assert "kategori" in blocked.text.lower()
            freed = requests.post(f"{API}/registrations/{reg_ids[0]}/status", headers=h, json={"status": "reserve"})
            assert freed.status_code == 200, freed.text
            second = requests.post(f"{API}/registrations/{reg_ids[1]}/status", headers=h, json={"status": "accepted"})
            assert second.status_code == 200, second.text
        finally:
            for rid in reg_ids:
                requests.delete(f"{API}/registrations/{rid}", headers=h)
            requests.delete(f"{API}/classes/{cls['id']}", headers=h)
            requests.delete(f"{API}/categories/{cat['id']}", headers=h)

    def test_convert_does_not_consume_a_second_slot(self, admin_tok, demo_event):
        h = H(admin_tok)
        eid = demo_event["id"]
        cat = requests.post(f"{API}/categories", headers=h, json={
            "event_id": eid, "name": "TEST_ConvertQuota", "type": "tanding", "gender": "putra",
        }).json()
        cls = requests.post(f"{API}/classes", headers=h, json={
            "event_id": eid, "category_id": cat["id"], "name": "TEST_ConvertQuotaCls", "quota": 1,
        }).json()
        reg_ids = []
        athlete_id = None
        try:
            for i in range(2):
                created = requests.post(f"{API}/public/registrations", json={
                    "event_id": eid,
                    "category_id": cat["id"],
                    "class_id": cls["id"],
                    "contingent_name": f"TEST_ConvertSlot_{time.time_ns()}_{i}",
                    "name": f"TEST_ConvertSlot_{time.time_ns()}_{i}",
                    "gender": "putra",
                })
                assert created.status_code == 200, created.text
                reg_ids.append(created.json()["id"])
                requests.post(f"{API}/registrations/{reg_ids[-1]}/status", headers=h, json={"status": "verified"})
            accepted = requests.post(f"{API}/registrations/{reg_ids[0]}/status", headers=h, json={"status": "accepted"})
            assert accepted.status_code == 200, accepted.text
            converted = requests.post(f"{API}/registrations/{reg_ids[0]}/convert-to-athlete", headers=h)
            assert converted.status_code == 200, converted.text
            athlete_id = converted.json()["athlete"]["id"]
            assert converted.json()["athlete"]["source"] == "self_registration"
            blocked = requests.post(f"{API}/registrations/{reg_ids[1]}/status", headers=h, json={"status": "accepted"})
            assert blocked.status_code == 400
            assert "kuota" in blocked.text.lower()
        finally:
            if athlete_id:
                requests.delete(f"{API}/athletes/{athlete_id}", headers=h)
            for rid in reg_ids:
                requests.delete(f"{API}/registrations/{rid}", headers=h)
            requests.delete(f"{API}/classes/{cls['id']}", headers=h)
            requests.delete(f"{API}/categories/{cat['id']}", headers=h)

    def test_moving_class_moves_the_slot(self, admin_tok, demo_event):
        h = H(admin_tok)
        eid = demo_event["id"]
        cat = requests.post(f"{API}/categories", headers=h, json={
            "event_id": eid, "name": "TEST_MoveQuota", "type": "tanding", "gender": "putra",
        }).json()
        class_a = requests.post(f"{API}/classes", headers=h, json={
            "event_id": eid, "category_id": cat["id"], "name": "TEST_MoveA", "quota": 1,
        }).json()
        class_b = requests.post(f"{API}/classes", headers=h, json={
            "event_id": eid, "category_id": cat["id"], "name": "TEST_MoveB", "quota": 1,
        }).json()
        reg_ids = []
        try:
            def make(class_id, label):
                created = requests.post(f"{API}/public/registrations", json={
                    "event_id": eid,
                    "category_id": cat["id"],
                    "class_id": class_id,
                    "contingent_name": f"TEST_Move_{label}",
                    "name": f"TEST_Move_{label}_{time.time_ns()}",
                    "gender": "putra",
                })
                assert created.status_code == 200, created.text
                rid = created.json()["id"]
                reg_ids.append(rid)
                assert requests.post(f"{API}/registrations/{rid}/status", headers=h, json={"status": "verified"}).status_code == 200
                return rid

            first = make(class_a["id"], "a")
            second = make(class_a["id"], "b")
            assert requests.post(f"{API}/registrations/{first}/status", headers=h, json={"status": "accepted"}).status_code == 200
            blocked = requests.post(f"{API}/registrations/{second}/status", headers=h, json={"status": "accepted"})
            assert blocked.status_code == 400
            moved = requests.put(f"{API}/registrations/{first}", headers=h, json={
                "event_id": eid,
                "category_id": cat["id"],
                "class_id": class_b["id"],
                "contingent_name": "TEST_Move_a",
                "name": "TEST_Move_a_edited",
                "gender": "putra",
            })
            assert moved.status_code == 200, moved.text
            assert moved.json()["class_id"] == class_b["id"]
            opened = requests.post(f"{API}/registrations/{second}/status", headers=h, json={"status": "accepted"})
            assert opened.status_code == 200, opened.text
            third = make(class_b["id"], "c")
            still_full = requests.post(f"{API}/registrations/{third}/status", headers=h, json={"status": "accepted"})
            assert still_full.status_code == 400
        finally:
            for rid in reg_ids:
                requests.delete(f"{API}/registrations/{rid}", headers=h)
            requests.delete(f"{API}/classes/{class_a['id']}", headers=h)
            requests.delete(f"{API}/classes/{class_b['id']}", headers=h)
            requests.delete(f"{API}/categories/{cat['id']}", headers=h)

    def test_concurrent_accept_cannot_pass_quota(self, admin_tok, demo_event):
        h = H(admin_tok)
        eid = demo_event["id"]
        cat = requests.post(f"{API}/categories", headers=h, json={
            "event_id": eid, "name": "TEST_RaceQuota", "type": "tanding", "gender": "putra",
        }).json()
        cls = requests.post(f"{API}/classes", headers=h, json={
            "event_id": eid, "category_id": cat["id"], "name": "TEST_RaceCls", "quota": 1,
        }).json()
        reg_ids = []
        try:
            for i in range(2):
                created = requests.post(f"{API}/public/registrations", json={
                    "event_id": eid,
                    "category_id": cat["id"],
                    "class_id": cls["id"],
                    "contingent_name": f"TEST_Race_{i}",
                    "name": f"TEST_Race_{time.time_ns()}_{i}",
                    "gender": "putra",
                })
                assert created.status_code == 200, created.text
                rid = created.json()["id"]
                reg_ids.append(rid)
                assert requests.post(f"{API}/registrations/{rid}/status", headers=h, json={"status": "verified"}).status_code == 200

            def accept(rid):
                return requests.post(f"{API}/registrations/{rid}/status", headers=h, json={"status": "accepted"}, timeout=20)

            with ThreadPoolExecutor(max_workers=2) as pool:
                results = list(pool.map(accept, reg_ids))
            assert sorted(r.status_code for r in results) == [200, 400]
            statuses = [
                requests.get(f"{API}/registrations/{rid}", headers=h).json()["status"]
                for rid in reg_ids
            ]
            assert sorted(statuses) == ["accepted", "verified"]
        finally:
            for rid in reg_ids:
                requests.delete(f"{API}/registrations/{rid}", headers=h)
            requests.delete(f"{API}/classes/{cls['id']}", headers=h)
            requests.delete(f"{API}/categories/{cat['id']}", headers=h)


# ===================== Placement and field length =====================
class TestRegistrationPlacement:
    def test_blank_category_and_class_still_register(self, demo_event):
        created = requests.post(f"{API}/public/registrations", json={
            "event_id": demo_event["id"],
            "category_id": "",
            "class_id": "",
            "contingent_name": "TEST_BlankIds",
            "name": f"TEST_BlankIds_{time.time_ns()}",
            "gender": "putra",
        })
        assert created.status_code == 400, created.text
        assert "kategori" in created.text.lower()

    def test_gender_must_match_category_except_campuran(self, admin_tok, demo_event):
        h = H(admin_tok)
        eid = demo_event["id"]
        putri = requests.post(f"{API}/categories", headers=h, json={
            "event_id": eid, "name": "TEST_Putri", "type": "tanding", "gender": "putri",
        }).json()
        campuran = requests.post(f"{API}/categories", headers=h, json={
            "event_id": eid, "name": "TEST_Campuran", "type": "ganda", "gender": "campuran",
        }).json()
        other = requests.post(f"{API}/events", headers=h, json={"name": "TEST_EventLain", "location": "Solo"}).json()
        other_cat = requests.post(f"{API}/categories", headers=h, json={
            "event_id": other["id"], "name": "TEST_EventLainCat", "type": "tanding", "gender": "putra",
        }).json()
        own_class = requests.post(f"{API}/classes", headers=h, json={
            "event_id": eid, "category_id": putri["id"], "name": "TEST_PutriClass",
        }).json()
        other_class = requests.post(f"{API}/classes", headers=h, json={
            "event_id": other["id"], "category_id": other_cat["id"], "name": "TEST_EventLainClass",
        }).json()
        created_ids = []
        try:
            mismatch = requests.post(f"{API}/public/registrations", json={
                "event_id": eid, "category_id": putri["id"], "contingent_name": "TEST_Gender",
                "name": f"TEST_Gender_{time.time_ns()}", "gender": "putra",
            })
            assert mismatch.status_code == 400
            assert "gender" in mismatch.text.lower()
            foreign_cat = requests.post(f"{API}/public/registrations", json={
                "event_id": eid, "category_id": other_cat["id"], "contingent_name": "TEST_Foreign",
                "name": f"TEST_ForeignCat_{time.time_ns()}", "gender": "putra",
            })
            assert foreign_cat.status_code == 400
            assert "kategori" in foreign_cat.text.lower()
            foreign_class = requests.post(f"{API}/public/registrations", json={
                "event_id": eid, "category_id": putri["id"], "class_id": other_class["id"],
                "contingent_name": "TEST_ForeignCls", "name": f"TEST_ForeignCls_{time.time_ns()}", "gender": "putri",
            })
            assert foreign_class.status_code == 400
            wrong_pair = requests.post(f"{API}/public/registrations", json={
                "event_id": eid, "category_id": campuran["id"], "class_id": own_class["id"],
                "contingent_name": "TEST_WrongPair", "name": f"TEST_WrongPair_{time.time_ns()}", "gender": "putra",
            })
            assert wrong_pair.status_code == 400
            assert "kelas" in wrong_pair.text.lower()
            for gender in ("putra", "putri"):
                ok = requests.post(f"{API}/public/registrations", json={
                    "event_id": eid, "category_id": campuran["id"], "contingent_name": "TEST_Mix",
                    "name": f"TEST_Mix_{gender}_{time.time_ns()}", "gender": gender,
                })
                assert ok.status_code == 200, ok.text
                created_ids.append(ok.json()["id"])
            matched = requests.post(f"{API}/public/registrations", json={
                "event_id": eid, "category_id": putri["id"], "class_id": own_class["id"],
                "contingent_name": "TEST_Match", "name": f"TEST_Match_{time.time_ns()}", "gender": "putri",
            })
            assert matched.status_code == 200, matched.text
            created_ids.append(matched.json()["id"])
        finally:
            for rid in created_ids:
                requests.delete(f"{API}/registrations/{rid}", headers=h)
            requests.delete(f"{API}/classes/{own_class['id']}", headers=h)
            requests.delete(f"{API}/categories/{putri['id']}", headers=h)
            requests.delete(f"{API}/categories/{campuran['id']}", headers=h)
            requests.delete(f"{API}/events/{other['id']}", headers=h)

    def test_field_length_limits(self, demo_event, seni_category):
        base = {
            "event_id": demo_event["id"],
            "category_id": seni_category["id"],
            "contingent_name": "TEST_Len",
            "gender": "putra",
        }
        too_long = requests.post(f"{API}/public/registrations", json={**base, "name": "A" * 121})
        assert too_long.status_code == 422
        assert "Nama" in too_long.text
        too_phone = requests.post(f"{API}/public/registrations", json={**base, "name": "TEST_Phone", "phone": "1" * 33})
        assert too_phone.status_code == 422
        assert "Telepon" in too_phone.text
        too_email = requests.post(f"{API}/public/registrations", json={**base, "name": "TEST_Email", "email": "a" * 255})
        assert too_email.status_code == 422
        assert "Email" in too_email.text
        too_address = requests.post(f"{API}/public/registrations", json={**base, "name": "TEST_Addr", "address": "J" * 501})
        assert too_address.status_code == 422
        assert "Alamat" in too_address.text
        ok = requests.post(f"{API}/public/registrations", json={
            **base,
            "name": "N" * 120,
            "phone": "8" * 32,
            "email": "e" * 254,
            "address": "A" * 500,
        })
        assert ok.status_code == 200, ok.text
        requests.delete(f"{API}/registrations/{ok.json()['id']}", headers=H(_login("admin@silat.id", "admin123")))


# ===================== Convert to athlete =====================
class TestConvert:
    def test_convert_accepted_creates_athlete_and_contingent(self, admin_tok, demo_event, seni_category):
        h = H(admin_tok)
        eid = demo_event["id"]
        cname = f"TEST_AutoCont_{int(time.time())}"
        # New reg with contingent_name only
        reg = requests.post(f"{API}/public/registrations", json={
            "event_id": eid,
            "category_id": seni_category["id"],
            "contingent_name": cname,
            "name": f"TEST_Convert_{int(time.time())}",
            "gender": "putra",
            "weight": 60,
        }).json()
        rid = reg["id"]
        # accept (no class so no quota check)
        requests.post(f"{API}/registrations/{rid}/status", headers=h, json={"status": "verified"})
        requests.post(f"{API}/registrations/{rid}/status", headers=h, json={"status": "accepted"})
        # convert
        r = requests.post(f"{API}/registrations/{rid}/convert-to-athlete", headers=h)
        assert r.status_code == 200, r.text
        data = r.json()
        ath = data["athlete"]
        assert ath["source"] == "self_registration"
        assert ath["registration_id"] == rid
        assert ath["participant_number"].startswith(f"PST-{_event_code(demo_event)}-")
        assert ath["status"] == "active"
        # Registration now active_participant
        reg_after = requests.get(f"{API}/registrations/{rid}", headers=h).json()
        assert reg_after["status"] == "active_participant"
        assert reg_after.get("athlete_id") == ath["id"]
        assert reg_after.get("participant_number") == ath["participant_number"]
        # Contingent auto-created
        conts = requests.get(f"{API}/contingents?event_id={eid}", headers=h).json()
        assert any(c["name"] == cname for c in conts)
        # cleanup
        requests.delete(f"{API}/athletes/{ath['id']}", headers=h)
        requests.delete(f"{API}/registrations/{rid}", headers=h)
        cid = next((c["id"] for c in conts if c["name"] == cname), None)
        if cid:
            requests.delete(f"{API}/contingents/{cid}", headers=h)

    def test_convert_refuses_non_accepted(self, admin_tok, demo_event, seni_category):
        h = H(admin_tok)
        reg = requests.post(f"{API}/public/registrations", json={
            "event_id": demo_event["id"],
            "category_id": seni_category["id"],
            "contingent_name": "TEST_NopeCont",
            "name": f"TEST_Nope_{int(time.time())}",
            "gender": "putri",
        }).json()
        rid = reg["id"]
        r = requests.post(f"{API}/registrations/{rid}/convert-to-athlete", headers=h)
        assert r.status_code == 400, r.text
        requests.delete(f"{API}/registrations/{rid}", headers=h)


# ===================== Manual athlete creation still works =====================
class TestManualAthlete:
    def test_manual_create_auto_participant_number(self, admin_tok, demo_event):
        h = H(admin_tok)
        # Pick any contingent
        conts = requests.get(f"{API}/contingents?event_id={demo_event['id']}", headers=h).json()
        if not conts:
            con = requests.post(f"{API}/contingents", headers=h, json={"event_id": demo_event["id"], "name": "TEST_ManualCont"}).json()
            cid = con["id"]
            cleanup_cont = True
        else:
            cid = conts[0]["id"]
            cleanup_cont = False
        ath = requests.post(f"{API}/athletes", headers=h, json={
            "event_id": demo_event["id"], "contingent_id": cid,
            "name": f"TEST_ManualAth_{int(time.time())}", "gender": "putra",
        })
        assert ath.status_code == 200, ath.text
        body = ath.json()
        assert body.get("source", "manual") == "manual"
        assert body["participant_number"].startswith(f"PST-{_event_code(demo_event)}-")
        requests.delete(f"{API}/athletes/{body['id']}", headers=h)
        if cleanup_cont:
            requests.delete(f"{API}/contingents/{cid}", headers=h)


# ===================== WAHA =====================
class TestWAHA:
    def test_get_default_config(self, admin_tok):
        r = requests.get(f"{API}/waha/config", headers=H(admin_tok))
        assert r.status_code == 200
        cfg = r.json()
        assert "templates" in cfg and isinstance(cfg["templates"], dict)
        assert "verified" in cfg["templates"]

    def test_put_config_and_test_endpoints(self, admin_tok):
        h = H(admin_tok)
        # Save with empty base_url, enabled false
        save_empty = requests.put(f"{API}/waha/config", headers=h, json={
            "base_url": "", "api_key": "", "session": "default", "sender_phone": "", "enabled": False,
            "templates": {"verified": "Hi {name}", "need_revision": "", "verification_rejected": "",
                          "accepted": "", "reserve": "", "rejected": ""},
        })
        assert save_empty.status_code == 200
        # test-connection with no base_url -> 400
        r1 = requests.post(f"{API}/waha/test-connection", headers=h)
        assert r1.status_code == 400
        # test-send when not enabled -> 400
        r2 = requests.post(f"{API}/waha/test-send", headers=h, json={"phone": "08123", "message": "hi"})
        assert r2.status_code == 400
        # Save invalid base_url
        requests.put(f"{API}/waha/config", headers=h, json={
            "base_url": "http://127.0.0.1:9999", "api_key": "", "session": "default",
            "sender_phone": "", "enabled": False,
            "templates": {"verified": "Hi", "need_revision": "", "verification_rejected": "",
                          "accepted": "", "reserve": "", "rejected": ""},
        })
        r3 = requests.post(f"{API}/waha/test-connection", headers=h)
        assert r3.status_code == 200
        body = r3.json()
        assert body.get("ok") is False
        assert "error" in body or "status_code" in body
        # enabled=false → test-send still 400
        r4 = requests.post(f"{API}/waha/test-send", headers=h, json={"phone": "081234", "message": "hi"})
        assert r4.status_code == 400
        assert "diaktifkan" in r4.text or "aktif" in r4.text.lower()
