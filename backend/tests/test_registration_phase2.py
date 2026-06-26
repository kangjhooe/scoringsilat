"""
Phase 2 backend tests:
- Self-registration (public, no auth) → REG-DEMO-NNN
- Document upload validation (image/pdf accept, txt reject)
- Admin status transitions + history[]
- Quota enforcement on accepted
- Convert-to-athlete (source='self_registration', PST-DEMO-NNN, contingent auto-create)
- Manual athlete creation still works + auto participant_number
- WAHA config + test-connection / test-send error paths
"""
import io
import os
import time
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


@pytest.fixture(scope="module")
def demo_event(admin_tok):
    evs = requests.get(f"{API}/events", headers=H(admin_tok)).json()
    ev = next((e for e in evs if (e.get("code") or "").upper() == "DEMO"), None)
    assert ev, "DEMO event missing"
    return ev


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

    def test_create_increments_and_format(self, demo_event):
        # Two fresh registrations; numbers should be REG-DEMO-NNN and increment
        nums = []
        for i in range(2):
            payload = {
                "event_id": demo_event["id"],
                "contingent_name": f"TEST_PublicCont_{i}",
                "name": f"TEST_PublicAthlete_{int(time.time())}_{i}",
                "gender": "putra",
                "phone": "081234567890",
            }
            r = requests.post(f"{API}/public/registrations", json=payload)
            assert r.status_code == 200, r.text
            body = r.json()
            assert body["status"] == "pending_verification"
            n = body["registration_number"]
            assert n.startswith("REG-DEMO-"), n
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
            json={"registration_id": reg["id"], "label": "photo", "url": up["url"]},
        )
        assert att.status_code == 200, att.text
        # by-number returns files + no admin_notes
        by_num = requests.get(f"{API}/public/registrations/by-number/{reg['registration_number']}")
        assert by_num.status_code == 200
        data = by_num.json()
        assert "admin_notes" not in data
        assert any(f.get("label") == "photo" for f in data.get("files", []))
        # by id also redacts
        by_id = requests.get(f"{API}/public/registrations/{reg['id']}").json()
        assert "admin_notes" not in by_id


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

    def test_status_transitions_history(self, admin_tok, demo_event):
        # Create new reg
        payload = {
            "event_id": demo_event["id"],
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


# ===================== Convert to athlete =====================
class TestConvert:
    def test_convert_accepted_creates_athlete_and_contingent(self, admin_tok, demo_event):
        h = H(admin_tok)
        eid = demo_event["id"]
        cname = f"TEST_AutoCont_{int(time.time())}"
        # New reg with contingent_name only
        reg = requests.post(f"{API}/public/registrations", json={
            "event_id": eid,
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
        assert ath["participant_number"].startswith("PST-DEMO-")
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

    def test_convert_refuses_non_accepted(self, admin_tok, demo_event):
        h = H(admin_tok)
        reg = requests.post(f"{API}/public/registrations", json={
            "event_id": demo_event["id"],
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
        assert body["participant_number"].startswith("PST-DEMO-")
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
