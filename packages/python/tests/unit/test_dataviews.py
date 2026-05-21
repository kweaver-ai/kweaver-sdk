"""Tests for resources resource (vega-backend)."""

import json
from unittest.mock import patch

import httpx
import inspect
import pytest

from tests.conftest import RequestCapture, make_client

_RESOURCE = {
    "id": "dv_01",
    "name": "products",
    "catalog_id": "ds_01",
    "category": "table",
    "source_identifier": "products",
    "status": "active",
    "schema_definition": [],
}


def test_create_posts_to_vega_backend(capture: RequestCapture):
    """create() should POST to vega-backend /resources."""
    def handler(req: httpx.Request) -> httpx.Response:
        if req.method == "POST":
            return httpx.Response(201, json={"id": "dv_01", **_RESOURCE})
        # GET for the follow-up get()
        return httpx.Response(200, json={"entries": [_RESOURCE]})

    client = make_client(handler, capture)
    res = client.resources.create(name="products", datasource_id="ds_01", table="products")

    post_req = next(r for r in capture.requests if r.method == "POST")
    assert "/api/vega-backend/v1/resources" in str(post_req.url)
    body = json.loads(post_req.content)
    assert body["catalog_id"] == "ds_01"
    assert body["category"] == "table"
    assert body["source_identifier"] == "products"
    assert res.id == "dv_01"


def test_find_by_table_uses_name_param(capture: RequestCapture):
    """find_by_table must send name=<table_name> (not keyword=)."""
    def handler(req: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json={"entries": [_RESOURCE]})

    client = make_client(handler, capture)
    client.resources.find_by_table("ds_01", "products", wait=False)

    url = str(capture.requests[-1].url)
    assert "name=products" in url
    assert "keyword=" not in url


def test_find_by_table_default_timeout_is_30s():
    """Default timeout should be 30 seconds."""
    from kweaver.resources.resources import ResourcesResource
    sig = inspect.signature(ResourcesResource.find_by_table)
    assert sig.parameters["timeout"].default == 30


def test_list_uses_catalog_id_param(capture: RequestCapture):
    """list() should send catalog_id= (not data_source_id=)."""
    def handler(req: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json={"entries": [_RESOURCE]})

    client = make_client(handler, capture)
    result = client.resources.list(datasource_id="ds_01")

    url = str(capture.requests[-1].url)
    assert "catalog_id=ds_01" in url
    assert "data_source_id" not in url
    assert len(result) == 1
    assert result[0].catalog_id == "ds_01"


def test_get_parses_entries_wrapper(capture: RequestCapture):
    """get() should unwrap the entries array returned by vega-backend."""
    def handler(req: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json={"entries": [_RESOURCE]})

    client = make_client(handler, capture)
    res = client.resources.get("dv_01")

    assert res.id == "dv_01"
    assert res.catalog_id == "ds_01"
    assert "/api/vega-backend/v1/resources/dv_01" in str(capture.requests[-1].url)


def test_get_populates_schema_definition(capture: RequestCapture):
    """get() should parse schema_definition when present."""
    resource_with_schema = {
        **_RESOURCE,
        "schema_definition": [{"name": "col1", "type": "integer"}],
    }

    def handler(req: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json={"entries": [resource_with_schema]})

    client = make_client(handler, capture)
    res = client.resources.get("dv_01")

    assert res.schema_definition is not None
    assert len(res.schema_definition) == 1
    assert res.schema_definition[0].name == "col1"


def test_list_schema_definition_none_when_empty(capture: RequestCapture):
    """List results should have schema_definition=None when backend returns empty array."""
    def handler(req: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json={"entries": [_RESOURCE]})

    client = make_client(handler, capture)
    result = client.resources.list(datasource_id="ds_01")

    assert result[0].schema_definition is None


def test_delete_sends_to_vega_backend(capture: RequestCapture):
    """delete() should DELETE to /api/vega-backend/v1/resources/{id}."""
    def handler(req: httpx.Request) -> httpx.Response:
        return httpx.Response(204)

    client = make_client(handler, capture)
    client.resources.delete("dv_01")

    req = capture.requests[-1]
    assert req.method == "DELETE"
    assert "/api/vega-backend/v1/resources/dv_01" in str(req.url)


def test_query_posts_to_vega_backend_data_path(capture: RequestCapture):
    """query() should POST to /resources/{id}/data."""
    def handler(req: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json={"entries": [], "total_count": 0})

    client = make_client(handler, capture)
    out = client.resources.query("dv-99", limit=10, offset=0)

    assert out.get("total_count") == 0
    req = capture.requests[-1]
    assert req.method == "POST"
    assert "/api/vega-backend/v1/resources/dv-99/data" in str(req.url)


def test_query_default_params(capture: RequestCapture):
    """query() should send offset, limit, need_total in body."""
    def handler(req: httpx.Request) -> httpx.Response:
        body = json.loads(req.content.decode())
        assert body["offset"] == 0
        assert body["limit"] == 50
        assert body["need_total"] is False
        return httpx.Response(200, json={})

    client = make_client(handler, capture)
    client.resources.query("vid")


def test_find_by_table_uses_exponential_backoff(capture: RequestCapture):
    """Polling should use exponential backoff (1s, 2s, 4s, ...) capped at 5s."""
    call_count = 0

    def handler(req: httpx.Request) -> httpx.Response:
        nonlocal call_count
        call_count += 1
        if call_count < 4:
            return httpx.Response(200, json={"entries": []})
        return httpx.Response(200, json={"entries": [_RESOURCE]})

    client = make_client(handler, capture)
    sleep_calls = []
    with patch("kweaver.resources.resources.time.sleep", side_effect=lambda s: sleep_calls.append(s)):
        with patch("kweaver.resources.resources.time.monotonic") as mock_mono:
            mock_mono.return_value = 0.0
            client.resources.find_by_table("ds_01", "products", wait=True)

    assert call_count == 4
    assert sleep_calls == [1.0, 2.0, 4.0]
