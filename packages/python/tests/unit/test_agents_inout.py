"""Unit tests: agent-inout export/import."""

from __future__ import annotations

import json
from pathlib import Path

import httpx

from kweaver._errors import EndpointUnavailableError, ValidationError
from tests.conftest import RequestCapture, make_client


def test_export_posts_agent_ids_and_parses_filename():
    payload = b'{"agents":[]}'

    def handler(req: httpx.Request) -> httpx.Response:
        assert req.method == "POST"
        body = json.loads(req.content.decode("utf-8"))
        assert body["agent_ids"] == ["x", "y"]
        return httpx.Response(
            200,
            content=payload,
            headers={"Content-Disposition": 'attachment; filename="mine.json"'},
        )

    client = make_client(handler)
    fn, data = client.agents.export(["x", "y"])
    assert fn == "mine.json"
    assert data == payload


def test_export_404_is_endpoint_unavailable():
    def handler(req: httpx.Request) -> httpx.Response:
        return httpx.Response(404, content=b"nope")

    client = make_client(handler)
    try:
        client.agents.export(["a"])
    except EndpointUnavailableError as exc:
        assert "/agent-inout/export" in exc.endpoint_path
    else:
        raise AssertionError("expected EndpointUnavailableError")


def test_import_posts_multipart_file_and_import_type(tmp_path: Path, capture: RequestCapture):
    f = tmp_path / "exp.json"
    f.write_text('{"k":"v"}', encoding="utf-8")

    def handler(req: httpx.Request) -> httpx.Response:
        assert "multipart/form-data" in req.headers.get("content-type", "")
        return httpx.Response(200, json={"created": 1})

    client = make_client(handler, capture)
    out = client.agents.import_(str(f), import_type="upsert")
    assert out["created"] == 1
    raw = capture.requests[-1].content.decode("utf-8", errors="replace")
    assert "import_type" in raw
    assert "upsert" in raw
    assert "Content-Type: application/json" in raw


def test_import_defaults_import_type_create(tmp_path: Path, capture: RequestCapture):
    f = tmp_path / "e.json"
    f.write_text("{}", encoding="utf-8")

    def handler(req: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json={})

    client = make_client(handler, capture)
    client.agents.import_(str(f))
    raw = capture.requests[-1].content.decode("utf-8", errors="replace")
    assert "create" in raw


def test_import_405_endpoint_unavailable(tmp_path: Path):
    f = tmp_path / "e.json"
    f.write_text("{}", encoding="utf-8")

    def handler(req: httpx.Request) -> httpx.Response:
        return httpx.Response(405, content=b"no")

    client = make_client(handler)
    try:
        client.agents.import_(str(f))
    except EndpointUnavailableError as exc:
        assert exc.status_code == 405
        assert "agent-inout/import" in exc.endpoint_path
    else:
        raise AssertionError("expected EndpointUnavailableError")


def test_import_other_4xx_not_endpoint_wrapper(tmp_path: Path):
    f = tmp_path / "e.json"
    f.write_text("{}", encoding="utf-8")

    def handler(req: httpx.Request) -> httpx.Response:
        return httpx.Response(400, json={"message": "bad"})

    client = make_client(handler)
    try:
        client.agents.import_(str(f))
    except ValidationError:
        pass
    else:
        raise AssertionError("expected ValidationError")
