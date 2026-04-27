"""Unit tests for skill resource support."""

from __future__ import annotations

import io
import zipfile

import httpx

from kweaver import KWeaverClient
from kweaver.resources.skills import install_skill_archive


def _transport(handler):
    return httpx.MockTransport(handler)


def test_skills_list_unwraps_data():
    def handler(request: httpx.Request) -> httpx.Response:
        assert request.url.path == "/api/agent-operator-integration/v1/skills"
        assert request.url.params["page_size"] == "30"
        return httpx.Response(
            200,
            json={
                "code": 0,
                "data": {
                    "total_count": 1,
                    "data": [{"skill_id": "skill-1", "name": "demo"}],
                },
            },
        )

    client = KWeaverClient(base_url="https://mock", token="tok", transport=_transport(handler))
    try:
        result = client.skills.list()
        assert result["data"][0]["skill_id"] == "skill-1"
    finally:
        client.close()


def test_skills_get_and_read_file():
    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path.endswith("/files/read"):
            return httpx.Response(
                200,
                json={
                    "code": 0,
                    "data": {
                        "skill_id": "skill-1",
                        "rel_path": "refs/guide.md",
                        "url": "https://download.example/guide.md",
                    },
                },
            )
        return httpx.Response(
            200,
            json={
                "code": 0,
                "data": {"skill_id": "skill-1", "name": "demo", "status": "published"},
            },
        )

    client = KWeaverClient(base_url="https://mock", token="tok", transport=_transport(handler))
    try:
        info = client.skills.get("skill-1")
        file_info = client.skills.read_file("skill-1", "refs/guide.md")
        assert info["skill_id"] == "skill-1"
        assert file_info["rel_path"] == "refs/guide.md"
    finally:
        client.close()


def test_skills_download_returns_filename():
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, content=b"PK")

    client = KWeaverClient(base_url="https://mock", token="tok", transport=_transport(handler))
    try:
        filename, data = client.skills.download("skill-1")
        assert filename == "skill-1.zip"
        assert data == b"PK"
    finally:
        client.close()


def test_skills_fetch_content_uses_shared_http_client():
    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path.endswith("/content"):
            return httpx.Response(
                200,
                json={
                    "code": 0,
                    "data": {
                        "skill_id": "skill-1",
                        "url": "https://download.example/skill.md",
                    },
                },
            )
        assert str(request.url) == "https://download.example/skill.md"
        assert "authorization" not in request.headers
        return httpx.Response(200, text="# demo")

    client = KWeaverClient(base_url="https://mock", token="tok", transport=_transport(handler))
    try:
        content = client.skills.fetch_content("skill-1")
        assert content == "# demo"
    finally:
        client.close()


def test_skills_fetch_file_uses_shared_http_client():
    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path.endswith("/files/read"):
            return httpx.Response(
                200,
                json={
                    "code": 0,
                    "data": {
                        "skill_id": "skill-1",
                        "rel_path": "refs/guide.md",
                        "url": "https://download.example/guide.md",
                    },
                },
            )
        assert str(request.url) == "https://download.example/guide.md"
        assert "authorization" not in request.headers
        return httpx.Response(200, content=b"guide")

    client = KWeaverClient(base_url="https://mock", token="tok", transport=_transport(handler))
    try:
        content = client.skills.fetch_file("skill-1", "refs/guide.md")
        assert content == b"guide"
    finally:
        client.close()


def test_register_content_uploads_as_multipart_zip():
    """register_content must NOT send file_type=content (server bug renders
    those skills unreadable, see kweaver-core#313). It bundles into a
    1-file SKILL.md zip and uses the zip multipart endpoint."""
    captured = {}

    def handler(request: httpx.Request) -> httpx.Response:
        ct = request.headers.get("content-type", "")
        body = request.content
        captured["content_type"] = ct
        captured["body"] = body
        # Reject anything that looks like the broken JSON content path.
        assert "application/json" not in ct, "must not POST JSON"
        assert "multipart/form-data" in ct
        # `file_type` form field must equal "zip", not "content".
        assert b"\r\n\r\nzip\r\n" in body, "expected file_type=zip part"
        # File part must be a real zip with SKILL.md at root.
        zip_marker_idx = body.find(b"PK\x03\x04")
        assert zip_marker_idx != -1, "expected zip bytes in multipart body"
        zip_blob = body[zip_marker_idx:]
        # Truncate at the first multipart boundary trailing the file part.
        end = zip_blob.find(b"\r\n--")
        if end != -1:
            zip_blob = zip_blob[:end]
        with zipfile.ZipFile(io.BytesIO(zip_blob)) as zf:
            assert zf.namelist() == ["SKILL.md"]
            assert zf.read("SKILL.md") == b"---\nname: x\n---\nbody"
        return httpx.Response(
            200,
            json={
                "code": 0,
                "data": {
                    "skill_id": "skill-new",
                    "name": "x",
                    "status": "unpublish",
                    "files": ["SKILL.md"],
                },
            },
        )

    client = KWeaverClient(base_url="https://mock", token="tok", transport=_transport(handler))
    try:
        result = client.skills.register_content("---\nname: x\n---\nbody")
        assert result["skill_id"] == "skill-new"
        assert result["files"] == ["SKILL.md"]
    finally:
        client.close()


def test_register_content_round_trips_source_and_extend_info():
    captured: dict[str, bytes] = {}

    def handler(request: httpx.Request) -> httpx.Response:
        captured["body"] = request.content
        return httpx.Response(
            200,
            json={"code": 0, "data": {"skill_id": "s", "name": "n", "status": "unpublish", "files": ["SKILL.md"]}},
        )

    client = KWeaverClient(base_url="https://mock", token="tok", transport=_transport(handler))
    try:
        client.skills.register_content(
            "---\nname: n\n---\nb",
            source="custom",
            extend_info={"k": 1},
        )
    finally:
        client.close()

    body = captured["body"]
    assert b'name="source"' in body and b"\r\n\r\ncustom\r\n" in body
    assert b'name="extend_info"' in body and b'\r\n\r\n{"k": 1}\r\n' in body


def test_install_skill_archive_extracts_zip(tmp_path):
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as zf:
        zf.writestr("SKILL.md", "# demo")
        zf.writestr("refs/guide.md", "guide")

    target = tmp_path / "demo-skill"
    install_skill_archive(buf.getvalue(), str(target))

    assert (target / "SKILL.md").read_text(encoding="utf-8") == "# demo"
    assert (target / "refs" / "guide.md").read_text(encoding="utf-8") == "guide"
