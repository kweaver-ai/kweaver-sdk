"""Tests for OperatorsResource."""
import httpx
import pytest
from tests.conftest import RequestCapture, make_client


def test_list_operators(capture: RequestCapture):
    def handler(req):
        return httpx.Response(200, json={"data": [], "total": 0})
    client = make_client(handler, capture)
    result = client.operators.list(name="test-op")
    assert capture.requests[-1].method == "GET"
    assert "/operator/info/list" in capture.last_url()
    assert "name=test-op" in capture.last_url()


def test_get_operator(capture: RequestCapture):
    def handler(req):
        return httpx.Response(200, json={"operator_id": "op-1", "version": "v1"})
    client = make_client(handler, capture)
    result = client.operators.get("op-1", version="v1")
    assert result["operator_id"] == "op-1"
    assert "/operator/op-1" in capture.last_url()
    assert "version=v1" in capture.last_url()


def test_register_operator(capture: RequestCapture):
    def handler(req):
        return httpx.Response(200, json=[{"status": "success", "operator_id": "op-1"}])
    client = make_client(handler, capture)
    body = {"operator_metadata_type": "openapi", "data": "openapi: '3.0.1'"}
    result = client.operators.register(body)
    assert capture.requests[-1].method == "POST"
    assert "/operator/register" in capture.last_url()
    assert capture.last_body()["operator_metadata_type"] == "openapi"


def test_edit_operator(capture: RequestCapture):
    def handler(req):
        return httpx.Response(200, json={"operator_id": "op-1"})
    client = make_client(handler, capture)
    result = client.operators.edit("op-1", "v1", body={"name": "updated"})
    assert capture.requests[-1].method == "PUT"
    assert "/operator/op-1/versions/v1" in capture.last_url()


def test_delete_operator(capture: RequestCapture):
    def handler(req):
        return httpx.Response(200, json={})
    client = make_client(handler, capture)
    result = client.operators.delete([{"operator_id": "op-1", "version": "v1"}])
    assert capture.requests[-1].method == "POST"
    assert "/operator/delete" in capture.last_url()


def test_update_operator_status(capture: RequestCapture):
    def handler(req):
        return httpx.Response(200, json={})
    client = make_client(handler, capture)
    result = client.operators.update_status([{"operator_id": "op-1", "status": "published"}])
    assert capture.requests[-1].method == "PUT"
    assert "/operator/status" in capture.last_url()


def test_debug_operator(capture: RequestCapture):
    def handler(req):
        return httpx.Response(200, json={"status_code": 200, "body": {}})
    client = make_client(handler, capture)
    result = client.operators.debug({"operator_id": "op-1", "version": "v1"})
    assert capture.requests[-1].method == "POST"
    assert "/operator/debug" in capture.last_url()


def test_list_operator_history(capture: RequestCapture):
    def handler(req):
        return httpx.Response(200, json={"data": []})
    client = make_client(handler, capture)
    result = client.operators.list_history("op-1")
    assert "/operator/op-1/history" in capture.last_url()


def test_list_operator_market(capture: RequestCapture):
    def handler(req):
        return httpx.Response(200, json={"data": []})
    client = make_client(handler, capture)
    result = client.operators.list_market()
    assert "/operator/market" in capture.last_url()


def test_get_operator_market(capture: RequestCapture):
    def handler(req):
        return httpx.Response(200, json={"operator_id": "op-1"})
    client = make_client(handler, capture)
    result = client.operators.get_market("op-1")
    assert "/operator/market/op-1" in capture.last_url()


def test_list_operator_categories(capture: RequestCapture):
    def handler(req):
        return httpx.Response(200, json=[{"category": "data_process"}])
    client = make_client(handler, capture)
    result = client.operators.list_categories()
    assert "/operator/categories" in capture.last_url()


def test_register_internal_operator(capture: RequestCapture):
    def handler(req):
        return httpx.Response(200, json={"status": "success", "operator_id": "op-1"})
    client = make_client(handler, capture)
    body = {
        "operator_id": "op-1",
        "name": "test",
        "metadata_type": "function",
        "operator_type": "basic",
        "execution_mode": "sync",
        "config_source": "auto",
        "config_version": "v1",
    }
    result = client.operators.register_internal(body)
    assert capture.requests[-1].method == "POST"
    assert "/operator/internal/register" in capture.last_url()
