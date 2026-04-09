"""Tests for Vega type definitions."""
from kweaver.types import (
    VegaServerInfo, VegaCatalog, VegaResource, VegaResourceProperty,
    VegaConnectorType, VegaMetricModel, VegaEventModel, VegaTraceModel,
    VegaDataView, VegaDataDict, VegaDataDictItem, VegaObjectiveModel,
    VegaMetricTask, VegaSpan,
    VegaQueryResult, VegaDslResult, VegaPromqlResult,
    VegaHealthReport, VegaPlatformStats, VegaInspectReport,
)
from kweaver._errors import VegaError, VegaQueryError, VegaConnectionError, VegaDiscoverError, KWeaverError


def test_vega_server_info():
    info = VegaServerInfo(server_name="VEGA", server_version="1.0", language="Go", go_version="1.22", go_arch="amd64")
    assert info.server_name == "VEGA"

def test_vega_catalog_defaults():
    c = VegaCatalog(id="c-1", name="prod", type="physical", connector_type="mysql", status="active")
    assert c.health_status is None

def test_vega_resource_with_properties():
    r = VegaResource(id="r-1", name="users", catalog_id="c-1", category="table", status="active",
                     properties=[VegaResourceProperty(name="id", type="integer")])
    assert len(r.properties) == 1

def test_vega_model_types():
    """All 6 model types should instantiate."""
    VegaMetricModel(id="mm-1", name="cpu")
    VegaEventModel(id="em-1", name="alert")
    VegaTraceModel(id="tm-1", name="traces")
    VegaDataView(id="dv-1", name="view1")
    VegaDataDict(id="dd-1", name="status_codes")
    VegaObjectiveModel(id="om-1", name="sla")

def test_vega_query_results():
    VegaQueryResult(entries=[{"a": 1}], total_count=1)
    VegaDslResult(hits=[{"a": 1}], total=1, took_ms=5)
    VegaPromqlResult(status="success", result_type="vector")

def test_vega_inspect_report():
    info = VegaServerInfo(server_name="V", server_version="1", language="Go", go_version="1.22", go_arch="amd64")
    report = VegaInspectReport(server_info=info, catalog_health=VegaHealthReport())
    assert report.active_tasks == []

def test_vega_error_hierarchy():
    assert issubclass(VegaError, KWeaverError)
    assert issubclass(VegaQueryError, VegaError)
    assert issubclass(VegaConnectionError, VegaError)
    assert issubclass(VegaDiscoverError, VegaError)

def test_vega_query_error_attrs():
    e = VegaQueryError("fail", query_type="dsl")
    assert e.query_type == "dsl"


def test_vega_model_ignores_extra_fields():
    """Vega models should tolerate extra fields from API."""
    m = VegaMetricModel(id="mm-1", name="cpu", unknown_field="should_not_crash", another=123)
    assert m.id == "mm-1"
    # extra fields should be silently ignored
    assert not hasattr(m, "unknown_field")
    assert not hasattr(m, "another")
