"""Unit tests for HttpClient retry and error handling."""
from __future__ import annotations

from unittest.mock import patch

import httpx
import pytest
from kweaver._http import HttpClient
from kweaver._auth import TokenAuth
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
