"""Tests for Vega SDK resources."""
from __future__ import annotations
import httpx
import pytest
from kweaver._auth import TokenAuth
from kweaver._http import HttpClient
from kweaver.types import (
    VegaMetricModel, VegaEventModel, VegaTraceModel,
    VegaDataView, VegaDataDict, VegaObjectiveModel,
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
