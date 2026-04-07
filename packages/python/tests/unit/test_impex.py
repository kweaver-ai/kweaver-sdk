"""Tests for ImpexResource."""
import httpx
import pytest
from tests.conftest import RequestCapture, make_client


def test_export_data(capture: RequestCapture):
    def handler(req):
        return httpx.Response(200, json={"operator": [], "toolbox": [], "mcp": []})
    client = make_client(handler, capture)
    result = client.impex.export_data(type="operator", id="op-1")
    assert capture.requests[-1].method == "GET"
    assert "/impex/export/operator/op-1" in capture.last_url()


def test_import_data(capture: RequestCapture):
    def handler(req):
        return httpx.Response(200, json=[{"type": "operator", "id": "op-1"}])
    client = make_client(handler, capture)
    result = client.impex.import_data(type="operator", body={"data": "{}", "mode": "create"})
    assert capture.requests[-1].method == "POST"
    assert "/impex/import/operator" in capture.last_url()
