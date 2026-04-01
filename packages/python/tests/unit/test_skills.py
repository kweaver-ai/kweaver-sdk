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


def test_install_skill_archive_extracts_zip(tmp_path):
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as zf:
        zf.writestr("SKILL.md", "# demo")
        zf.writestr("refs/guide.md", "guide")

    target = tmp_path / "demo-skill"
    install_skill_archive(buf.getvalue(), str(target))

    assert (target / "SKILL.md").read_text(encoding="utf-8") == "# demo"
    assert (target / "refs" / "guide.md").read_text(encoding="utf-8") == "guide"
