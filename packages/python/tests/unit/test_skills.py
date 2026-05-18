"""Unit tests for skill resource support."""

from __future__ import annotations

import io
import os
import zipfile

import httpx
import pytest

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


def test_skills_get_market_and_history():
    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path.endswith("/history"):
            return httpx.Response(
                200,
                json={
                    "code": 0,
                    "data": [{"skill_id": "skill-1", "version": "v1", "status": "published"}],
                },
            )
        assert request.url.path.endswith("/skills/market/skill-1")
        return httpx.Response(
            200,
            json={
                "code": 0,
                "data": {"skill_id": "skill-1", "name": "demo-market"},
            },
        )

    client = KWeaverClient(base_url="https://mock", token="tok", transport=_transport(handler))
    try:
        market = client.skills.get_market("skill-1")
        history = client.skills.history("skill-1")
        assert market["skill_id"] == "skill-1"
        assert history[0]["version"] == "v1"
    finally:
        client.close()


def test_skills_update_metadata_and_publish_history():
    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path.endswith("/metadata"):
            assert request.method == "PUT"
            assert request.read() == b'{"name":"Demo","description":"Demo skill","category":"system","source":"internal","extend_info":{"owner":"sdk"}}'
            return httpx.Response(
                200,
                json={
                    "code": 0,
                    "data": {"skill_id": "skill-1", "version": "v2", "status": "editing"},
                },
            )
        assert request.url.path.endswith("/history/publish")
        assert request.method == "POST"
        assert request.read() == b'{"version":"v1"}'
        return httpx.Response(
            200,
            json={
                "code": 0,
                "data": {"skill_id": "skill-1", "version": "v1", "status": "published"},
            },
        )

    client = KWeaverClient(base_url="https://mock", token="tok", transport=_transport(handler))
    try:
        metadata = client.skills.update_metadata(
            "skill-1",
            name="Demo",
            description="Demo skill",
            category="system",
            source="internal",
            extend_info={"owner": "sdk"},
        )
        publish = client.skills.publish_history("skill-1", "v1")
        assert metadata["status"] == "editing"
        assert publish["version"] == "v1"
    finally:
        client.close()


def test_skills_update_package_content_and_republish_history():
    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path.endswith("/package"):
            assert request.method == "PUT"
            assert request.headers["content-type"].startswith("multipart/form-data; boundary=")
            body = request.content
            assert b'name="file_type"' in body and b"\r\n\r\ncontent\r\n" in body
            assert b'name="file"' in body and b'filename="SKILL.md"' in body
            assert b"# demo\n" in body
            return httpx.Response(
                200,
                json={
                    "code": 0,
                    "data": {"skill_id": "skill-1", "version": "v3", "status": "editing"},
                },
            )
        assert request.url.path.endswith("/history/republish")
        assert request.method == "POST"
        assert request.read() == b'{"version":"v2"}'
        return httpx.Response(
            200,
            json={
                "code": 0,
                "data": {"skill_id": "skill-1", "version": "v2", "status": "editing"},
            },
        )

    client = KWeaverClient(base_url="https://mock", token="tok", transport=_transport(handler))
    try:
        package_result = client.skills.update_package_content("skill-1", "# demo\n")
        republish = client.skills.republish_history("skill-1", "v2")
        assert package_result["version"] == "v3"
        assert republish["status"] == "editing"
    finally:
        client.close()


def test_skills_update_package_zip_uses_put_multipart():
    def handler(request: httpx.Request) -> httpx.Response:
        assert request.method == "PUT"
        assert request.url.path.endswith("/skills/skill-1/package")
        assert request.headers["content-type"].startswith("multipart/form-data; boundary=")
        return httpx.Response(
            200,
            json={
                "code": 0,
                "data": {"skill_id": "skill-1", "version": "v3", "status": "editing"},
            },
        )

    client = KWeaverClient(base_url="https://mock", token="tok", transport=_transport(handler))
    try:
        result = client.skills.update_package_zip("skill-1", "demo.zip", b"PK")
        assert result["version"] == "v3"
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


# ── Management Content ─────────────────────────────────────────────────────────


def test_get_management_content():
    def handler(request: httpx.Request) -> httpx.Response:
        assert request.url.path.endswith("/management/content")
        return httpx.Response(
            200,
            json={
                "code": 0,
                "data": {
                    "skill_id": "skill-1",
                    "name": "demo",
                    "description": "Demo skill",
                    "version": "v1",
                    "status": "editing",
                    "source": "custom",
                    "file_type": "zip",
                    "url": "https://download.example/SKILL.md",
                    "files": [{"rel_path": "SKILL.md", "file_type": "md"}],
                },
            },
        )

    client = KWeaverClient(base_url="https://mock", token="tok", transport=_transport(handler))
    try:
        result = client.skills.get_management_content("skill-1")
        assert result["skill_id"] == "skill-1"
        assert result["status"] == "editing"
    finally:
        client.close()


def test_read_management_file():
    def handler(request: httpx.Request) -> httpx.Response:
        assert request.method == "POST"
        assert request.url.path.endswith("/management/files/read")
        assert request.read() == b'{"rel_path":"refs/guide.md"}'
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

    client = KWeaverClient(base_url="https://mock", token="tok", transport=_transport(handler))
    try:
        result = client.skills.read_management_file("skill-1", "refs/guide.md")
        assert result["rel_path"] == "refs/guide.md"
    finally:
        client.close()


def test_download_management_archive():
    def handler(request: httpx.Request) -> httpx.Response:
        assert request.url.path.endswith("/management/download")
        return httpx.Response(200, content=b"PK")

    client = KWeaverClient(base_url="https://mock", token="tok", transport=_transport(handler))
    try:
        filename, data = client.skills.download_management_archive("skill-1")
        assert filename == "skill-1.zip"
        assert data == b"PK"
    finally:
        client.close()


# ── Real-server integration tests ──────────────────────────────────────────────


def _real_server_skill_items(result):
    """Return skill items from live servers that vary in list envelope shape."""
    if isinstance(result, list):
        return result
    if isinstance(result, dict):
        data = result.get("data")
        if isinstance(data, list):
            return data
    pytest.fail(f"unexpected skills list shape: {type(result).__name__}")


@pytest.mark.skipif(
    not os.environ.get("KWEAVER_BASE_URL") or not os.environ.get("KWEAVER_TOKEN"),
    reason="set KWEAVER_BASE_URL and KWEAVER_TOKEN to run against a real server",
)
class TestRealServer:
    """Smoke tests that exercise the live API via the ``client`` fixture
    from conftest.py.

    These tests do NOT use mock transports. They assert response *structure*
    rather than specific values, so they work against any server.
    """

    def test_list_skills(self, client: KWeaverClient):
        result = client.skills.list(page_size=5)
        assert isinstance(_real_server_skill_items(result), list)

    def test_market_skills(self, client: KWeaverClient):
        result = client.skills.market(page_size=5)
        assert isinstance(_real_server_skill_items(result), list)

    def test_get_and_content(self, client: KWeaverClient):
        listing = client.skills.list(page_size=1)
        items = _real_server_skill_items(listing)
        if not items:
            pytest.skip("no skills available")
        skill_id = items[0]["skill_id"]

        info = client.skills.get(skill_id)
        assert info["skill_id"] == skill_id

        content = client.skills.content(skill_id)
        assert "url" in content

    def test_management_content(self, client: KWeaverClient):
        listing = client.skills.list(page_size=1)
        items = _real_server_skill_items(listing)
        if not items:
            pytest.skip("no skills available")
        skill_id = items[0]["skill_id"]

        mgmt = client.skills.get_management_content(skill_id)
        assert "skill_id" in mgmt
