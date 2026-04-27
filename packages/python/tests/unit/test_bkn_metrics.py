"""Unit tests for BknMetricsResource."""

from __future__ import annotations

import httpx

from tests.conftest import RequestCapture, make_client


def test_list_metrics_default_limit_30(capture: RequestCapture) -> None:
    def handler(req: httpx.Request) -> httpx.Response:
        assert req.method == "GET"
        assert "/api/bkn-backend/v1/knowledge-networks/kn1/metrics" in str(req.url)
        assert "limit=30" in str(req.url)
        return httpx.Response(200, json={"entries": [], "total_count": 0})

    client = make_client(handler, capture)
    out = client.metrics.list("kn1")
    assert out["total_count"] == 0


def test_create_uses_method_override_post(capture: RequestCapture) -> None:
    def handler(req: httpx.Request) -> httpx.Response:
        assert req.method == "POST"
        h = req.headers
        assert h.get("x-http-method-override") == "POST"
        return httpx.Response(201, json=["id-1"])

    client = make_client(handler, capture)
    out = client.metrics.create("kn1", {"entries": []})
    assert out == ["id-1"]


def test_search_uses_method_override_get(capture: RequestCapture) -> None:
    def handler(req: httpx.Request) -> httpx.Response:
        assert req.headers.get("x-http-method-override") == "GET"
        return httpx.Response(200, json={"entries": []})

    client = make_client(handler, capture)
    client.metrics.search("kn1", {"limit": 20})


def test_delete_many_sends_delete(capture: RequestCapture) -> None:
    def handler(req: httpx.Request) -> httpx.Response:
        assert req.method == "DELETE"
        assert "metrics/a,b" in str(req.url)
        return httpx.Response(204)

    client = make_client(handler, capture)
    assert client.metrics.delete_many("kn1", "a,b") is None
