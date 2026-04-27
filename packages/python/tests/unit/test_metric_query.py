"""Unit tests for MetricQueryResource."""

from __future__ import annotations

import httpx

from tests.conftest import RequestCapture, make_client


def test_metric_data_post_no_method_override(capture: RequestCapture) -> None:
    def handler(req: httpx.Request) -> httpx.Response:
        assert req.method == "POST"
        assert "metrics/m1/data" in str(req.url)
        assert "fill_null=true" in str(req.url)
        assert req.headers.get("x-http-method-override") is None
        return httpx.Response(200, json={"datas": []})

    client = make_client(handler, capture)
    client.metric_query.data("kn1", "m1", {"limit": 10}, fill_null=True)


def test_dry_run_post(capture: RequestCapture) -> None:
    def handler(req: httpx.Request) -> httpx.Response:
        assert "metrics/dry-run" in str(req.url)
        return httpx.Response(200, json={"datas": []})

    client = make_client(handler, capture)
    client.metric_query.dry_run("kn1", {"metric_config": {"id": "x"}})
