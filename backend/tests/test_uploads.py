"""
Backend tests for photo upload feature.
Endpoints under test:
- POST /api/uploads/photo  (admin/operator only, image-only, <=5MB)
- GET  /api/uploads/<filename>  (static)
"""
import io
import os
import struct
import zlib
import requests
import pytest

BASE_URL = (os.environ.get("REACT_APP_BACKEND_URL") or os.environ["BASE_URL"]).rstrip("/")
API = f"{BASE_URL}/api"


def _login(email, password):
    r = requests.post(f"{API}/auth/login", json={"email": email, "password": password}, timeout=20)
    assert r.status_code == 200, r.text
    return r.json()["token"]


@pytest.fixture(scope="module")
def admin_token():
    return _login("admin@silat.id", "admin123")


@pytest.fixture(scope="module")
def operator_token():
    return _login("operator@silat.id", "password123")


@pytest.fixture(scope="module")
def jury_token():
    return _login("juri1@silat.id", "password123")


def _png_bytes(w=2, h=2):
    """Build a tiny valid PNG in-memory."""
    def chunk(tag, data):
        return (struct.pack(">I", len(data)) + tag + data +
                struct.pack(">I", zlib.crc32(tag + data) & 0xffffffff))
    sig = b"\x89PNG\r\n\x1a\n"
    ihdr = struct.pack(">IIBBBBB", w, h, 8, 2, 0, 0, 0)
    # raw rows: filter byte 0 + RGB pixel * w
    raw = b"".join(b"\x00" + b"\xff\x00\x00" * w for _ in range(h))
    idat = zlib.compress(raw)
    return sig + chunk(b"IHDR", ihdr) + chunk(b"IDAT", idat) + chunk(b"IEND", b"")


# ----- upload OK (admin) -----
def test_upload_photo_admin_png(admin_token):
    png = _png_bytes()
    files = {"file": ("test.png", io.BytesIO(png), "image/png")}
    r = requests.post(f"{API}/uploads/photo", headers={"Authorization": f"Bearer {admin_token}"}, files=files)
    assert r.status_code == 200, r.text
    body = r.json()
    assert "url" in body and body["url"].startswith("/api/uploads/")
    assert body["filename"].endswith(".png")
    assert body["size"] == len(png)
    # Fetch via static mount
    g = requests.get(f"{BASE_URL}{body['url']}")
    assert g.status_code == 200
    assert g.content == png


# ----- upload OK (operator) -----
def test_upload_photo_operator_jpg(operator_token):
    payload = b"\xff\xd8\xff\xe0" + b"\x00" * 100  # JPEG start-of-image marker; content sniff accepts it
    files = {"file": ("photo.jpg", io.BytesIO(payload), "image/jpeg")}
    r = requests.post(f"{API}/uploads/photo", headers={"Authorization": f"Bearer {operator_token}"}, files=files)
    assert r.status_code == 200, r.text
    assert r.json()["filename"].endswith(".jpg")


# ----- invalid extension -----
def test_upload_rejects_txt(admin_token):
    files = {"file": ("notes.txt", io.BytesIO(b"hello"), "text/plain")}
    r = requests.post(f"{API}/uploads/photo", headers={"Authorization": f"Bearer {admin_token}"}, files=files)
    assert r.status_code == 400, r.text
    assert "Format" in r.text or "format" in r.text


# ----- empty file -----
def test_upload_rejects_empty(admin_token):
    files = {"file": ("empty.png", io.BytesIO(b""), "image/png")}
    r = requests.post(f"{API}/uploads/photo", headers={"Authorization": f"Bearer {admin_token}"}, files=files)
    assert r.status_code == 400


# ----- role restriction -----
def test_upload_forbidden_for_jury(jury_token):
    files = {"file": ("test.png", io.BytesIO(_png_bytes()), "image/png")}
    r = requests.post(f"{API}/uploads/photo", headers={"Authorization": f"Bearer {jury_token}"}, files=files)
    assert r.status_code == 403


def test_upload_requires_auth():
    files = {"file": ("test.png", io.BytesIO(_png_bytes()), "image/png")}
    r = requests.post(f"{API}/uploads/photo", files=files)
    assert r.status_code == 401


# ----- athlete CRUD with photo_url end-to-end -----
def test_create_athlete_with_uploaded_photo(admin_token):
    h = {"Authorization": f"Bearer {admin_token}", "Content-Type": "application/json"}
    # Upload a photo
    png = _png_bytes()
    up = requests.post(f"{API}/uploads/photo",
                       headers={"Authorization": f"Bearer {admin_token}"},
                       files={"file": ("a.png", io.BytesIO(png), "image/png")})
    assert up.status_code == 200
    photo_url = up.json()["url"]

    # Get the seeded demo event
    events = requests.get(f"{API}/events", headers=h).json()
    ev = next((e for e in events if "Demo" in e.get("name", "")), events[0])
    cons = requests.get(f"{API}/contingents?event_id={ev['id']}", headers=h).json()
    if not cons:
        pytest.skip("no contingent available")

    payload = {
        "event_id": ev["id"],
        "contingent_id": cons[0]["id"],
        "name": "TEST_PhotoAthlete",
        "gender": "putra",
        "weight": 50,
        "photo_url": photo_url,
    }
    r = requests.post(f"{API}/athletes", headers=h, json=payload)
    assert r.status_code == 200, r.text
    aid = r.json()["id"]
    assert r.json()["photo_url"] == photo_url

    # Verify persisted via GET list
    lst = requests.get(f"{API}/athletes?event_id={ev['id']}", headers=h).json()
    found = next((a for a in lst if a["id"] == aid), None)
    assert found is not None
    assert found["photo_url"] == photo_url

    # Cleanup
    requests.delete(f"{API}/athletes/{aid}", headers=h)
