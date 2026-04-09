"""Tests for Vega SDK resources."""
from __future__ import annotations
import httpx
import pytest
from kweaver._auth import TokenAuth
from kweaver._http import HttpClient
from kweaver.types import (
    VegaMetricModel, VegaEventModel, VegaTraceModel,
    VegaDataView, VegaDataDict, VegaObjectiveModel,
    VegaQueryResult, VegaDslResult, VegaPromqlResult,
    VegaCatalog, VegaResource, VegaConnectorType,
    VegaServerInfo, VegaInspectReport,
)

def _make_vega_http(handler):
    transport = httpx.MockTransport(handler)
    return HttpClient(base_url="http://vega-mock:13014", auth=TokenAuth("tok"), transport=transport)


# -- Parameterized model tests -----------------------------------------------

MODEL_RESOURCES = [
    ("metric_models",    "/api/mdl-data-model/v1/metric-models",    VegaMetricModel,    {"id": "mm-1", "name": "cpu"}),
    ("event_models",     "/api/mdl-data-model/v1/event-models",     VegaEventModel,     {"id": "em-1", "name": "alert"}),
    ("trace_models",     "/api/mdl-data-model/v1/trace-models",     VegaTraceModel,     {"id": "tm-1", "name": "traces"}),
    ("data_views",       "/api/mdl-data-model/v1/data-views",       VegaDataView,       {"id": "dv-1", "name": "view1"}),
    ("data_dicts",       "/api/mdl-data-model/v1/data-dicts",       VegaDataDict,       {"id": "dd-1", "name": "codes"}),
    ("objective_models", "/api/mdl-data-model/v1/objective-models",  VegaObjectiveModel, {"id": "om-1", "name": "sla"}),
]


@pytest.mark.parametrize("attr,path,model_cls,sample", MODEL_RESOURCES)
def test_model_list(attr, path, model_cls, sample):
    def handler(req):
        return httpx.Response(200, json={"entries": [sample]})
    from kweaver.resources.vega import VegaNamespace
    ns = VegaNamespace(_make_vega_http(handler))
    result = getattr(ns, attr).list()
    assert len(result) == 1
    assert isinstance(result[0], model_cls)


@pytest.mark.parametrize("attr,path,model_cls,sample", MODEL_RESOURCES)
def test_model_list_data_format(attr, path, model_cls, sample):
    """list() should also handle {"data": [...]} response format."""
    def handler(req):
        return httpx.Response(200, json={"data": [sample]})
    from kweaver.resources.vega import VegaNamespace
    ns = VegaNamespace(_make_vega_http(handler))
    result = getattr(ns, attr).list()
    assert len(result) == 1
    assert isinstance(result[0], model_cls)


@pytest.mark.parametrize("attr,path,model_cls,sample", MODEL_RESOURCES)
def test_model_get(attr, path, model_cls, sample):
    def handler(req):
        return httpx.Response(200, json=sample)
    from kweaver.resources.vega import VegaNamespace
    ns = VegaNamespace(_make_vega_http(handler))
    result = getattr(ns, attr).get(sample["id"])
    assert isinstance(result, model_cls)
    assert result.id == sample["id"]


@pytest.mark.parametrize("attr,path,model_cls,sample", MODEL_RESOURCES)
def test_model_get_entries_wrapper(attr, path, model_cls, sample):
    """get() should unwrap {"entries": [obj]} response format."""
    def handler(req):
        return httpx.Response(200, json={"entries": [sample]})
    from kweaver.resources.vega import VegaNamespace
    ns = VegaNamespace(_make_vega_http(handler))
    result = getattr(ns, attr).get(sample["id"])
    assert isinstance(result, model_cls)
    assert result.id == sample["id"]


# -- VegaQueryResource tests -------------------------------------------------


def test_query_execute_basic():
    """execute() posts to the correct endpoint and returns VegaQueryResult."""
    def handler(req):
        assert req.url.path == "/api/vega-backend/v1/query/execute"
        return httpx.Response(200, json={"entries": [{"id": "row1"}], "total_count": 1})

    from kweaver.resources.vega import VegaNamespace
    ns = VegaNamespace(_make_vega_http(handler))
    result = ns.query.execute(tables=["cpu"], limit=10)
    assert isinstance(result, VegaQueryResult)
    assert result.total_count == 1
    assert result.entries[0]["id"] == "row1"


def test_query_execute_empty_response():
    """execute() returns empty VegaQueryResult when API returns empty dict."""
    def handler(req):
        return httpx.Response(200, json={})

    from kweaver.resources.vega import VegaNamespace
    ns = VegaNamespace(_make_vega_http(handler))
    result = ns.query.execute()
    assert isinstance(result, VegaQueryResult)
    assert result.entries == []
    assert result.total_count == 0


def test_query_dsl_with_index():
    """dsl() posts to index-specific endpoint when index is provided."""
    def handler(req):
        assert req.url.path == "/api/mdl-uniquery/v1/dsl/my-index/_search"
        return httpx.Response(200, json={"hits": [{"_id": "doc1"}], "total": 1, "took_ms": 5})

    from kweaver.resources.vega import VegaNamespace
    ns = VegaNamespace(_make_vega_http(handler))
    result = ns.query.dsl(index="my-index", body={"query": {"match_all": {}}})
    assert isinstance(result, VegaDslResult)
    assert result.total == 1
    assert result.hits[0]["_id"] == "doc1"


def test_query_dsl_without_index():
    """dsl() posts to generic endpoint when index is not provided."""
    def handler(req):
        assert req.url.path == "/api/mdl-uniquery/v1/dsl/_search"
        return httpx.Response(200, json={"hits": [], "total": 0, "took_ms": 2})

    from kweaver.resources.vega import VegaNamespace
    ns = VegaNamespace(_make_vega_http(handler))
    result = ns.query.dsl(body={"query": {"match_all": {}}})
    assert isinstance(result, VegaDslResult)
    assert result.total == 0


def test_query_dsl_count_with_index():
    """dsl_count() posts to index-specific count endpoint."""
    def handler(req):
        assert req.url.path == "/api/mdl-uniquery/v1/dsl/events/_count"
        return httpx.Response(200, json={"count": 42})

    from kweaver.resources.vega import VegaNamespace
    ns = VegaNamespace(_make_vega_http(handler))
    count = ns.query.dsl_count(index="events", body={"query": {"match_all": {}}})
    assert count == 42


def test_query_dsl_count_without_index():
    """dsl_count() posts to generic count endpoint when index is not provided."""
    def handler(req):
        assert req.url.path == "/api/mdl-uniquery/v1/dsl/_count"
        return httpx.Response(200, json={"count": 7})

    from kweaver.resources.vega import VegaNamespace
    ns = VegaNamespace(_make_vega_http(handler))
    count = ns.query.dsl_count(body={})
    assert count == 7


def test_query_promql():
    """promql() posts to query_range endpoint and returns VegaPromqlResult."""
    def handler(req):
        assert req.url.path == "/api/mdl-uniquery/v1/promql/query_range"
        return httpx.Response(200, json={
            "data": {"status": "success", "result_type": "matrix", "result": []}
        })

    from kweaver.resources.vega import VegaNamespace
    ns = VegaNamespace(_make_vega_http(handler))
    result = ns.query.promql(
        query="up",
        start="2026-01-01T00:00:00Z",
        end="2026-01-01T01:00:00Z",
        step="60s",
    )
    assert isinstance(result, VegaPromqlResult)
    assert result.status == "success"
    assert result.result_type == "matrix"


def test_query_promql_instant():
    """promql_instant() posts to instant query endpoint and returns VegaPromqlResult."""
    def handler(req):
        assert req.url.path == "/api/mdl-uniquery/v1/promql/query"
        return httpx.Response(200, json={
            "data": {
                "status": "success",
                "result_type": "vector",
                "result": [{"metric": {}, "value": [1, "1"]}],
            }
        })

    from kweaver.resources.vega import VegaNamespace
    ns = VegaNamespace(_make_vega_http(handler))
    result = ns.query.promql_instant(query="up")
    assert isinstance(result, VegaPromqlResult)
    assert result.status == "success"
    assert result.result_type == "vector"


def test_query_events():
    """events() posts to events endpoint and returns VegaDslResult."""
    def handler(req):
        assert req.url.path == "/api/mdl-uniquery/v1/events"
        return httpx.Response(200, json={"hits": [{"event": "login"}], "total": 1, "took_ms": 3})

    from kweaver.resources.vega import VegaNamespace
    ns = VegaNamespace(_make_vega_http(handler))
    result = ns.query.events(body={"filter": {"type": "login"}})
    assert isinstance(result, VegaDslResult)
    assert result.total == 1
    assert result.hits[0]["event"] == "login"


# -- health() tests ----------------------------------------------------------

_SERVER_INFO = {
    "server_name": "vega-backend",
    "server_version": "1.0.0",
    "language": "go",
    "go_version": "go1.21",
    "go_arch": "amd64",
}


def test_health_returns_server_info():
    """health() GETs /health and returns a VegaServerInfo."""
    def handler(req):
        assert req.url.path == "/api/vega-backend/v1/health"
        return httpx.Response(200, json=_SERVER_INFO)

    from kweaver.resources.vega import VegaNamespace
    ns = VegaNamespace(_make_vega_http(handler))
    info = ns.health()
    assert isinstance(info, VegaServerInfo)
    assert info.server_name == "vega-backend"
    assert info.server_version == "1.0.0"
    assert info.go_arch == "amd64"


# -- inspect() tests ---------------------------------------------------------


def test_inspect_returns_report():
    """inspect() assembles VegaInspectReport from health + catalogs."""
    _catalog = {
        "id": "cat-1", "name": "Prometheus", "type": "metrics",
        "connector_type": "prometheus", "status": "active", "health_status": "healthy",
    }

    def handler(req):
        path = req.url.path
        if path == "/api/vega-backend/v1/health":
            return httpx.Response(200, json=_SERVER_INFO)
        if path == "/api/vega-backend/v1/catalogs":
            return httpx.Response(200, json={"entries": [_catalog]})
        return httpx.Response(404, json={})

    from kweaver.resources.vega import VegaNamespace
    ns = VegaNamespace(_make_vega_http(handler))
    report = ns.inspect()
    assert isinstance(report, VegaInspectReport)
    assert isinstance(report.server_info, VegaServerInfo)
    assert report.server_info.server_name == "vega-backend"
    assert report.catalog_health.healthy_count == 1


def test_inspect_partial_failure_still_returns_report():
    """inspect() returns a partial report when health endpoint fails."""
    def handler(req):
        path = req.url.path
        if path == "/api/vega-backend/v1/health":
            return httpx.Response(500, json={"error": "internal server error"})
        if path == "/api/vega-backend/v1/catalogs":
            return httpx.Response(200, json={"entries": []})
        return httpx.Response(404, json={})

    from kweaver.resources.vega import VegaNamespace
    ns = VegaNamespace(_make_vega_http(handler))
    report = ns.inspect()
    assert isinstance(report, VegaInspectReport)
    # server_info is None because /health failed
    assert report.server_info is None
    # catalog_health is still populated
    assert report.catalog_health is not None


# -- Catalogs tests ----------------------------------------------------------

_CATALOG_SAMPLE = {
    "id": "cat-1",
    "name": "My Catalog",
    "type": "jdbc",
    "connector_type": "mysql",
    "status": "active",
}


def test_catalog_list():
    def handler(req):
        return httpx.Response(200, json={"entries": [_CATALOG_SAMPLE]})
    from kweaver.resources.vega import VegaNamespace
    ns = VegaNamespace(_make_vega_http(handler))
    result = ns.catalogs.list()
    assert len(result) == 1
    assert isinstance(result[0], VegaCatalog)
    assert result[0].id == "cat-1"


def test_catalog_list_data_format():
    """list() also handles {"data": [...]} response format."""
    def handler(req):
        return httpx.Response(200, json={"data": [_CATALOG_SAMPLE]})
    from kweaver.resources.vega import VegaNamespace
    ns = VegaNamespace(_make_vega_http(handler))
    result = ns.catalogs.list()
    assert len(result) == 1
    assert isinstance(result[0], VegaCatalog)


def test_catalog_list_with_status_filter():
    def handler(req):
        assert req.url.params.get("status") == "active"
        return httpx.Response(200, json={"entries": [_CATALOG_SAMPLE]})
    from kweaver.resources.vega import VegaNamespace
    ns = VegaNamespace(_make_vega_http(handler))
    result = ns.catalogs.list(status="active")
    assert len(result) == 1
    assert isinstance(result[0], VegaCatalog)


def test_catalog_get():
    def handler(req):
        return httpx.Response(200, json=_CATALOG_SAMPLE)
    from kweaver.resources.vega import VegaNamespace
    ns = VegaNamespace(_make_vega_http(handler))
    result = ns.catalogs.get("cat-1")
    assert isinstance(result, VegaCatalog)
    assert result.id == "cat-1"
    assert result.connector_type == "mysql"


def test_catalog_get_entries_wrapper():
    """get() should unwrap {"entries": [obj]} response format."""
    def handler(req):
        return httpx.Response(200, json={"entries": [_CATALOG_SAMPLE]})
    from kweaver.resources.vega import VegaNamespace
    ns = VegaNamespace(_make_vega_http(handler))
    result = ns.catalogs.get("cat-1")
    assert isinstance(result, VegaCatalog)
    assert result.id == "cat-1"


# -- Resources tests ---------------------------------------------------------

_RESOURCE_SAMPLE = {
    "id": "res-1",
    "name": "orders",
    "catalog_id": "cat-1",
    "category": "table",
    "status": "active",
}


def test_resource_list():
    def handler(req):
        return httpx.Response(200, json={"entries": [_RESOURCE_SAMPLE]})
    from kweaver.resources.vega import VegaNamespace
    ns = VegaNamespace(_make_vega_http(handler))
    result = ns.resources.list()
    assert len(result) == 1
    assert isinstance(result[0], VegaResource)
    assert result[0].id == "res-1"


def test_resource_list_with_catalog_filter():
    def handler(req):
        assert req.url.params.get("catalog_id") == "cat-1"
        return httpx.Response(200, json={"data": [_RESOURCE_SAMPLE]})
    from kweaver.resources.vega import VegaNamespace
    ns = VegaNamespace(_make_vega_http(handler))
    result = ns.resources.list(catalog_id="cat-1")
    assert len(result) == 1
    assert isinstance(result[0], VegaResource)


def test_resource_get():
    def handler(req):
        return httpx.Response(200, json=_RESOURCE_SAMPLE)
    from kweaver.resources.vega import VegaNamespace
    ns = VegaNamespace(_make_vega_http(handler))
    result = ns.resources.get("res-1")
    assert isinstance(result, VegaResource)
    assert result.catalog_id == "cat-1"
    assert result.category == "table"


# -- ConnectorTypes tests ----------------------------------------------------

_CONNECTOR_TYPE_SAMPLE = {
    "type": "mysql",
    "name": "MySQL",
    "enabled": True,
}


def test_connector_type_list():
    def handler(req):
        return httpx.Response(200, json={"entries": [_CONNECTOR_TYPE_SAMPLE]})
    from kweaver.resources.vega import VegaNamespace
    ns = VegaNamespace(_make_vega_http(handler))
    result = ns.connector_types.list()
    assert len(result) == 1
    assert isinstance(result[0], VegaConnectorType)
    assert result[0].type == "mysql"


def test_connector_type_list_data_format():
    """list() also handles {"data": [...]} response format."""
    def handler(req):
        return httpx.Response(200, json={"data": [_CONNECTOR_TYPE_SAMPLE]})
    from kweaver.resources.vega import VegaNamespace
    ns = VegaNamespace(_make_vega_http(handler))
    result = ns.connector_types.list()
    assert len(result) == 1
    assert isinstance(result[0], VegaConnectorType)


def test_connector_type_get():
    def handler(req):
        return httpx.Response(200, json=_CONNECTOR_TYPE_SAMPLE)
    from kweaver.resources.vega import VegaNamespace
    ns = VegaNamespace(_make_vega_http(handler))
    result = ns.connector_types.get("mysql")
    assert isinstance(result, VegaConnectorType)
    assert result.name == "MySQL"
    assert result.enabled is True


# -- KWeaverClient.vega property tests ---------------------------------------

from kweaver import KWeaverClient

def test_client_vega_property():
    """client.vega should return VegaNamespace when vega_url is set."""
    def handler(req):
        return httpx.Response(200, json={"entries": []})
    transport = httpx.MockTransport(handler)
    client = KWeaverClient(base_url="https://mock", token="tok", transport=transport, vega_url="http://vega:13014")
    from kweaver.resources.vega import VegaNamespace
    assert isinstance(client.vega, VegaNamespace)

def test_client_vega_falls_back_to_base_url():
    """client.vega should fall back to base_url when vega_url not configured."""
    def handler(req):
        return httpx.Response(200, json={})
    transport = httpx.MockTransport(handler)
    client = KWeaverClient(base_url="https://mock", token="tok", transport=transport)
    from kweaver.resources.vega import VegaNamespace
    assert isinstance(client.vega, VegaNamespace)


# ── Missing Vega resource method tests ──

def test_catalog_health_status():
    """health_status() must use GET /catalogs/{ids}/health-status (ids in path, not query)."""
    def handler(req):
        # ids must be in the path segment, not as a query parameter
        assert req.url.path == "/api/vega-backend/v1/catalogs/c-1/health-status"
        return httpx.Response(200, json={"entries": [
            {"id": "c-1", "name": "prod", "type": "physical", "connector_type": "mysql",
             "status": "active", "health_status": "healthy"}
        ]})
    from kweaver.resources.vega import VegaNamespace
    ns = VegaNamespace(_make_vega_http(handler))
    cats = ns.catalogs.health_status(["c-1"])
    assert len(cats) == 1
    assert cats[0].health_status == "healthy"


def test_catalog_health_status_multiple_ids():
    """health_status() with multiple ids joins them comma-separated in the path."""
    def handler(req):
        assert req.url.path == "/api/vega-backend/v1/catalogs/c-1,c-2/health-status"
        return httpx.Response(200, json={"entries": [
            {"id": "c-1", "name": "a", "type": "physical", "connector_type": "mysql",
             "status": "active", "health_status": "healthy"},
            {"id": "c-2", "name": "b", "type": "physical", "connector_type": "pg",
             "status": "active", "health_status": "unhealthy"},
        ]})
    from kweaver.resources.vega import VegaNamespace
    ns = VegaNamespace(_make_vega_http(handler))
    cats = ns.catalogs.health_status(["c-1", "c-2"])
    assert len(cats) == 2

def test_catalog_test_connection():
    def handler(req):
        return httpx.Response(200, json={"status": "ok"})
    from kweaver.resources.vega import VegaNamespace
    ns = VegaNamespace(_make_vega_http(handler))
    result = ns.catalogs.test_connection("c-1")
    assert result is not None

def test_catalog_discover():
    def handler(req):
        return httpx.Response(200, json={"id": "dt-1", "catalog_id": "c-1", "status": "pending"})
    from kweaver.resources.vega import VegaNamespace
    ns = VegaNamespace(_make_vega_http(handler))
    task = ns.catalogs.discover("c-1")
    assert task["status"] == "pending"

def test_catalog_resources():
    def handler(req):
        return httpx.Response(200, json={"entries": [
            {"id": "r-1", "name": "users", "catalog_id": "c-1", "category": "table", "status": "active"}
        ]})
    from kweaver.resources.vega import VegaNamespace
    ns = VegaNamespace(_make_vega_http(handler))
    resources = ns.catalogs.resources("c-1")
    assert len(resources) == 1

def test_resource_data():
    def handler(req):
        return httpx.Response(200, json={"entries": [{"a": 1}], "total_count": 1})
    from kweaver.resources.vega import VegaNamespace
    ns = VegaNamespace(_make_vega_http(handler))
    result = ns.resources.data("r-1", body={"query": {}})
    assert result.total_count == 1

def test_resource_has_no_preview_method():
    """preview() was removed — the backend has no /resources/{id}/preview endpoint."""
    from kweaver.resources.vega.resources import VegaResourcesResource
    assert not hasattr(VegaResourcesResource, "preview")

def test_task_get_metric():
    def handler(req):
        return httpx.Response(200, json={"id": "mt-1", "status": "completed"})
    from kweaver.resources.vega import VegaNamespace
    ns = VegaNamespace(_make_vega_http(handler))
    task = ns.tasks.get_metric("mt-1")
    assert task.id == "mt-1"

def test_stats():
    def handler(req):
        url = str(req.url)
        if "/catalogs" in url:
            return httpx.Response(200, json={"entries": [
                {"id": "c-1", "name": "prod", "type": "physical", "connector_type": "mysql", "status": "active"}
            ]})
        return httpx.Response(200, json={"entries": []})
    from kweaver.resources.vega import VegaNamespace
    from kweaver.types import VegaPlatformStats
    ns = VegaNamespace(_make_vega_http(handler))
    stats = ns.stats()
    assert isinstance(stats, VegaPlatformStats)
    assert stats.catalog_count >= 0
