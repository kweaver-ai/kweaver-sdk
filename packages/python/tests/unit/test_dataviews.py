"""Tests for dataviews resource."""

import json
from unittest.mock import patch

import httpx
import pytest

from tests.conftest import RequestCapture, make_client


def test_create_table_mode_finds_atomic_view(capture: RequestCapture):
    """Table-based create should find the auto-created atomic view."""
    def handler(req: httpx.Request) -> httpx.Response:
        if req.method == "GET":
            return httpx.Response(200, json={
                "entries": [{
                    "id": "dv_01", "name": "products", "type": "atomic",
                    "query_type": "SQL", "fields": [],
                    "data_source_id": "ds_01",
                }],
            })
        return httpx.Response(200, json=[])

    client = make_client(handler, capture)
    dv = client.dataviews.create(name="products", datasource_id="ds_01", table="products")

    assert dv.id == "dv_01"
    assert dv.name == "products"
    assert capture.requests[-1].method == "GET"


def test_create_table_mode_creates_if_not_found(capture: RequestCapture):
    """When no atomic view exists, should create one directly."""
    def handler(req: httpx.Request) -> httpx.Response:
        if req.method == "GET":
            url = str(req.url)
            if "data-views?" in url:
                return httpx.Response(200, json={"entries": []})
            elif "data-views/" in url:
                return httpx.Response(200, json={
                    "id": "created_01", "name": "missing",
                    "query_type": "SQL", "type": "atomic",
                    "data_source_id": "ds_01", "fields": [],
                })
        if req.method == "POST":
            return httpx.Response(201, json=[{"id": "created_01"}])
        return httpx.Response(200, json=[])

    client = make_client(handler, capture)
    original = client.dataviews.find_by_table
    client.dataviews.find_by_table = lambda ds_id, name, **kw: original(ds_id, name, wait=False)

    dv = client.dataviews.create(name="missing", datasource_id="ds_01", table="missing")

    assert dv.id == "created_01"
    methods = [r.method for r in capture.requests]
    assert "POST" in methods


def test_create_sql_mode(capture: RequestCapture):
    def handler(req: httpx.Request) -> httpx.Response:
        if req.method == "POST":
            return httpx.Response(201, json=[{"id": "dv_02"}])
        return httpx.Response(200, json={
            "id": "dv_02", "name": "custom", "query_type": "SQL",
            "data_source_id": "ds_01", "fields": [],
        })

    client = make_client(handler, capture)
    client.dataviews.create(
        name="custom", datasource_id="ds_01",
        sql="SELECT id FROM products WHERE status = 'active'",
    )

    # Find the POST request
    post_reqs = [r for r in capture.requests if r.method == "POST"]
    assert post_reqs
    body = json.loads(post_reqs[-1].content)
    assert body[0]["type"] == "custom"
    assert body[0]["data_scope"][0]["type"] == "sql"
    assert "SELECT" in body[0]["data_scope"][0]["config"]["sql_expression"]


def test_create_requires_table_or_sql():
    def handler(req: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json=[])

    client = make_client(handler)
    with pytest.raises(ValueError, match="Either"):
        client.dataviews.create(name="bad", datasource_id="ds_01")


def test_find_by_table_passes_keyword_param(capture: RequestCapture):
    """find_by_table must send keyword=<table_name> to narrow server results."""
    def handler(req: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json={
            "entries": [{"id": "dv_01", "name": "products", "type": "atomic",
                         "query_type": "SQL", "fields": [], "data_source_id": "ds_01"}],
        })

    client = make_client(handler, capture)
    client.dataviews.find_by_table("ds_01", "products", wait=False)

    url = str(capture.requests[-1].url)
    assert "keyword=products" in url


def test_find_by_table_default_timeout_is_30s():
    """Default timeout should be 30 seconds, not 10."""
    import inspect
    from kweaver.resources.dataviews import DataViewsResource
    sig = inspect.signature(DataViewsResource.find_by_table)
    assert sig.parameters["timeout"].default == 30


def test_query_posts_to_uniquery_path(capture: RequestCapture):
    """query() POSTs to mdl-uniquery data-views endpoint."""
    def handler(req: httpx.Request) -> httpx.Response:
        if req.method == "POST" and "/api/mdl-uniquery/v1/data-views/dv-99" in str(req.url):
            return httpx.Response(200, json={"columns": [], "entries": [], "total_count": 0})
        return httpx.Response(404)

    client = make_client(handler, capture)
    out = client.dataviews.query("dv-99", limit=10, offset=0)
    assert out.get("total_count") == 0
    assert any(
        r.method == "POST" and "/api/mdl-uniquery/v1/data-views/dv-99" in str(r.url)
        for r in capture.requests
    )


def test_query_with_sql_override(capture: RequestCapture):
    def handler(req: httpx.Request) -> httpx.Response:
        if req.method == "POST":
            body = json.loads(req.content.decode())
            assert body["sql"] == "SELECT 1"
            assert body["need_total"] is True
            return httpx.Response(200, json={"entries": []})
        return httpx.Response(404)

    client = make_client(handler, capture)
    client.dataviews.query("x", sql="SELECT 1", need_total=True)


def test_query_default_params(capture: RequestCapture):
    def handler(req: httpx.Request) -> httpx.Response:
        body = json.loads(req.content.decode())
        assert body["offset"] == 0
        assert body["limit"] == 50
        assert body["need_total"] is False
        assert "sql" not in body
        return httpx.Response(200, json={})

    client = make_client(handler, capture)
    client.dataviews.query("vid")


def test_list_omits_fields_when_backend_returns_empty(capture: RequestCapture):
    """List results should have fields=None when backend returns empty array."""
    def handler(req: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json={
            "entries": [{"id": "dv-1", "name": "v", "query_type": "SQL",
                         "data_source_id": "ds-1", "fields": []}],
        })

    client = make_client(handler, capture)
    views = client.dataviews.list(datasource_id="ds-1")
    assert len(views) == 1
    assert views[0].fields is None


def test_get_populates_fields_when_present(capture: RequestCapture):
    """get() should parse fields when backend returns non-empty array."""
    def handler(req: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json={
            "id": "dv-2", "name": "v2", "query_type": "SQL",
            "data_source_id": "ds-1",
            "fields": [{"name": "col1", "type": "integer"}],
        })

    client = make_client(handler, capture)
    dv = client.dataviews.get("dv-2")
    assert dv.fields is not None
    assert len(dv.fields) == 1
    assert dv.fields[0].name == "col1"


def test_find_by_table_uses_exponential_backoff(capture: RequestCapture):
    """Polling should use exponential backoff (1s, 2s, 4s, ...) capped at 5s."""
    call_count = 0

    def handler(req: httpx.Request) -> httpx.Response:
        nonlocal call_count
        call_count += 1
        if call_count < 4:
            return httpx.Response(200, json={"entries": []})
        return httpx.Response(200, json={
            "entries": [{"id": "dv_01", "name": "tbl", "type": "atomic",
                         "query_type": "SQL", "fields": [], "data_source_id": "ds_01"}],
        })

    client = make_client(handler, capture)
    sleep_calls = []
    with patch("kweaver.resources.dataviews.time.sleep", side_effect=lambda s: sleep_calls.append(s)):
        with patch("kweaver.resources.dataviews.time.monotonic") as mock_mono:
            mock_mono.return_value = 0.0
            client.dataviews.find_by_table("ds_01", "tbl", wait=True)

    assert call_count == 4
    assert sleep_calls == [1.0, 2.0, 4.0]
