"""Unit tests for HttpClient retry and error handling."""
from __future__ import annotations

from unittest.mock import patch

import httpx
import pytest
from kweaver._http import HttpClient
from kweaver._auth import NoAuth, TokenAuth
from kweaver._errors import NetworkError, ServerError


def _make_client(handler):
    transport = httpx.MockTransport(handler)
    return HttpClient(
        base_url="https://mock",
        auth=TokenAuth("tok"),
        transport=transport,
    )


def test_retry_on_500_then_success():
    """GET should retry on 500 and succeed on 3rd attempt."""
    call_count = {"n": 0}
    def handler(req):
        call_count["n"] += 1
        if call_count["n"] < 3:
            return httpx.Response(500, json={"error": "server busy"})
        return httpx.Response(200, json={"ok": True})
    client = _make_client(handler)
    with patch("kweaver._http.time.sleep"):
        result = client.get("/api/test")
    assert result == {"ok": True}
    assert call_count["n"] == 3


def test_no_retry_on_post():
    """POST should not retry (retry=False by default)."""
    call_count = {"n": 0}
    def handler(req):
        call_count["n"] += 1
        return httpx.Response(500, json={"error": "fail"})
    client = _make_client(handler)
    with pytest.raises(ServerError):
        client.post("/api/test", json={"x": 1})
    assert call_count["n"] == 1


def test_network_error_raises_network_error():
    """httpx.HTTPError should be wrapped as NetworkError."""
    def handler(req):
        raise httpx.ConnectError("unreachable")
    client = _make_client(handler)
    with patch("kweaver._http.time.sleep"):
        with pytest.raises(NetworkError):
            client.get("/api/test")


def test_204_returns_none():
    """204 No Content should return None."""
    def handler(req):
        return httpx.Response(204)
    client = _make_client(handler)
    result = client.delete("/api/resource/1")
    assert result is None


def test_400_raises_validation_error():
    """400 should raise ValidationError."""
    from kweaver._errors import ValidationError
    def handler(req):
        return httpx.Response(400, json={"message": "bad param", "error_code": "E001"})
    client = _make_client(handler)
    with pytest.raises(ValidationError, match="bad param"):
        client.get("/api/test")


def test_custom_headers_injected():
    """Extra headers should be included in request."""
    captured = {}
    def handler(req):
        captured["headers"] = dict(req.headers)
        return httpx.Response(200, json={})
    client = _make_client(handler)
    client.get("/api/test", headers={"X-Custom": "value"})
    assert captured["headers"].get("x-custom") == "value"


def test_no_auth_omits_authorization():
    """NoAuth provider must not add Authorization header."""
    captured = {}

    def handler(req):
        captured["headers"] = dict(req.headers)
        return httpx.Response(200, json={})

    transport = httpx.MockTransport(handler)
    client = HttpClient(
        base_url="https://mock",
        auth=NoAuth(),
        transport=transport,
    )
    client.get("/api/test")
    assert "authorization" not in {k.lower() for k in captured["headers"]}


def test_post_multipart_returns_status_and_bytes():
    """post_multipart does not raise on 4xx; returns raw body."""
    def handler(req):
        assert req.method == "POST"
        return httpx.Response(201, content=b'{"kn_id":"x"}')

    client = _make_client(handler)
    status, body = client.post_multipart(
        "/api/bkn-backend/v1/bkns",
        files={"file": ("bkn.tar", b"tar", "application/octet-stream")},
        params={"branch": "main"},
        timeout=10.0,
    )
    assert status == 201
    assert body == b'{"kn_id":"x"}'


def test_post_multipart_accepts_form_fields():
    captured = {}

    def handler(req):
        captured["content_type"] = req.headers.get("content-type", "")
        return httpx.Response(200, content=b"{}")

    client = _make_client(handler)
    status, body = client.post_multipart(
        "/api/agent-factory/v3/agent-inout/import",
        files={"file": ("e.json", b"{}", "application/octet-stream")},
        data={"import_type": "create"},
    )
    assert status == 200
    assert body == b"{}"
    assert "multipart/form-data" in captured["content_type"]


def test_post_raw_returns_status_headers_bytes():
    def handler(req):
        assert req.method == "POST"
        assert req.url.path.endswith("/export")
        return httpx.Response(
            200,
            content=b'{"x":1}',
            headers={"Content-Disposition": 'attachment; filename="out.json"'},
        )

    client = _make_client(handler)
    status, headers, body = client.post_raw(
        "/api/agent-factory/v3/agent-inout/export",
        json={"agent_ids": ["a"]},
    )
    assert status == 200
    assert body == b'{"x":1}'
    assert headers.get("content-disposition") is not None


def test_get_bytes_returns_status_and_body():
    def handler(req):
        return httpx.Response(200, content=b"\x00\x01")

    client = _make_client(handler)
    status, body = client.get_bytes("/api/raw", params={"a": "1"})
    assert status == 200
    assert body == b"\x00\x01"
