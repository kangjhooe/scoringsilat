"""Guards for public uploads: bounded read, content sniff, local file URLs, and per-IP limits."""
import asyncio
import sys
from pathlib import Path

import pytest
from fastapi import HTTPException

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import server

PNG_BYTES = (
    b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01\x08\x06\x00\x00\x00\x1f\x15\xc4\x89"
    b"\x00\x00\x00\rIDATx\x9cc\xf8\xcf\xc0\x00\x00\x00\x03\x00\x01\x18\xdd\x8d\xb4\x00\x00\x00\x00IEND\xaeB`\x82"
)


class _Upload:
    def __init__(self, chunks):
        self._chunks = list(chunks)
        self.reads = 0
        self.closed = False

    async def read(self, n=-1):
        self.reads += 1
        if not self._chunks:
            return b""
        return self._chunks.pop(0)

    async def close(self):
        self.closed = True


class _Req:
    def __init__(self, host, headers=None):
        self.client = type("Client", (), {"host": host})()
        self.headers = headers or {}


def _run(coro):
    return asyncio.run(coro)


def test_sniff_known_types_and_reject_html():
    assert server._sniff_upload_ext(b"\xff\xd8\xff\xe0" + b"\x00" * 8) == ".jpg"
    assert server._sniff_upload_ext(PNG_BYTES) == ".png"
    assert server._sniff_upload_ext(b"GIF89a" + b"\x00" * 8) == ".gif"
    assert server._sniff_upload_ext(b"RIFF\x00\x00\x00\x00WEBP") == ".webp"
    assert server._sniff_upload_ext(b"%PDF-1.4\n%EOF") == ".pdf"
    assert server._sniff_upload_ext(b"<html><script>alert(1)</script></html>") is None
    assert server._sniff_upload_ext(b"hello") is None


def test_read_stops_when_size_exceeds_cap(monkeypatch):
    monkeypatch.setattr(server, "MAX_UPLOAD_BYTES", 100_000)
    upload = _Upload([b"x" * 65536, b"y" * 65536, b"z" * 65536])

    with pytest.raises(HTTPException) as exc:
        _run(server._read_upload_bounded(upload))

    assert exc.value.status_code == 400
    assert upload.reads == 2
    assert upload.closed is True
    assert "Ukuran" in str(exc.value.detail)


def test_read_rejects_empty():
    upload = _Upload([b""])
    with pytest.raises(HTTPException) as exc:
        _run(server._read_upload_bounded(upload))
    assert exc.value.status_code == 400
    assert exc.value.detail == "File kosong"


def test_save_uses_content_type_not_filename():
    upload = _Upload([PNG_BYTES])
    saved = _run(server._save_checked_upload(upload, server.ALLOWED_DOC_EXT))
    try:
        assert saved["url"].endswith(".png")
        assert saved["size"] == len(PNG_BYTES)
        assert (server.UPLOAD_DIR / saved["filename"]).is_file()
    finally:
        (server.UPLOAD_DIR / saved["filename"]).unlink(missing_ok=True)


def test_save_rejects_html_even_with_png_name():
    upload = _Upload([b"<html>not a png</html>"])
    with pytest.raises(HTTPException) as exc:
        _run(server._save_checked_upload(upload, server.ALLOWED_DOC_EXT))
    assert exc.value.status_code == 400
    assert "Format" in str(exc.value.detail)


def test_photo_allows_jpeg_marker_and_rejects_pdf():
    jpeg = _Upload([b"\xff\xd8\xff\xe0" + b"\x00" * 20])
    saved = _run(server._save_checked_upload(jpeg, server.ALLOWED_IMAGE_EXT))
    try:
        assert saved["filename"].endswith(".jpg")
    finally:
        (server.UPLOAD_DIR / saved["filename"]).unlink(missing_ok=True)

    pdf = _Upload([b"%PDF-1.4\n"])
    with pytest.raises(HTTPException) as exc:
        _run(server._save_checked_upload(pdf, server.ALLOWED_IMAGE_EXT))
    assert exc.value.status_code == 400


def test_local_upload_path_requires_file_on_disk():
    name = "guard-test-file.png"
    path = server.UPLOAD_DIR / name
    path.write_bytes(PNG_BYTES)
    try:
        found = server._local_upload_path(f"/api/uploads/{name}")
        assert found.is_file()
        assert found.name == name
    finally:
        path.unlink(missing_ok=True)

    for bad in (
        "@evil.example/phish",
        "http://localhost:8000@evil.example/phish",
        "/api/uploads/../../server.py",
        "/api/uploads/missing-guard-file.png",
        "https://evil.example/api/uploads/a.png",
        "/api/uploads/a.png?x=1",
    ):
        with pytest.raises(HTTPException) as exc:
            server._local_upload_path(bad)
        assert exc.value.status_code == 400


def test_client_ip_trusts_x_real_ip_only_from_docker_network():
    assert server.client_ip(_Req("127.0.0.1", {"x-real-ip": "8.8.8.8"})) == "127.0.0.1"
    assert server.client_ip(_Req("203.0.113.4", {"x-real-ip": "8.8.8.8"})) == "203.0.113.4"
    assert server.client_ip(_Req("10.1.2.3", {"x-real-ip": "8.8.8.8"})) == "10.1.2.3"
    assert server.client_ip(_Req("192.168.1.9", {"x-real-ip": "8.8.8.8"})) == "192.168.1.9"
    assert server.client_ip(_Req("172.32.0.4", {"x-real-ip": "8.8.8.8"})) == "172.32.0.4"
    assert server.client_ip(_Req("172.18.0.5", {"x-real-ip": "203.0.113.50"})) == "203.0.113.50"
    assert server.client_ip(_Req("::ffff:172.18.0.5", {"x-real-ip": "203.0.113.51"})) == "203.0.113.51"
    assert server.client_ip(_Req("172.18.0.5", {"x-real-ip": "not-an-ip"})) == "172.18.0.5"
    assert server.client_ip(_Req("172.18.0.5", {"x-real-ip": "1.2.3.4, 5.6.7.8"})) == "172.18.0.5"
    assert server.client_ip(_Req("2001:db8::1", {"x-real-ip": "8.8.8.8"})) == "2001:db8::1"


def test_rate_limit_is_per_ip_and_bucket(monkeypatch):
    now = {"t": 1_000.0}
    monkeypatch.setattr(server.time, "monotonic", lambda: now["t"])
    first = _Req("198.51.100.10")
    other = _Req("198.51.100.11")
    server.enforce_rate_limit(first, "guard-upload", 2, 60)
    server.enforce_rate_limit(first, "guard-upload", 2, 60)
    with pytest.raises(HTTPException) as exc:
        server.enforce_rate_limit(first, "guard-upload", 2, 60)
    assert exc.value.status_code == 429
    server.enforce_rate_limit(other, "guard-upload", 2, 60)
    server.enforce_rate_limit(first, "guard-lookup", 2, 60)
    now["t"] = 1_061.0
    server.enforce_rate_limit(first, "guard-upload", 2, 60)
