"""Tests for ActionTypesResource."""

import json

import httpx
import pytest

from kweaver.resources.action_types import _collect_input_parameters
from tests.conftest import RequestCapture, make_client


def test_query_action_type(capture: RequestCapture):
    """query() POSTs with X-HTTP-Method-Override: GET."""
    def handler(req: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json={"id": "at_01", "name": "MyAction"})

    client = make_client(handler, capture)
    result = client.action_types.query("kn_001", "at_01", body={"include": "params"})

    assert result["id"] == "at_01"
    assert result["name"] == "MyAction"
    assert capture.last_headers()["x-http-method-override"] == "GET"
    assert "/kn_001/action-types/at_01/" in capture.last_url()
    assert capture.requests[-1].method == "POST"


def test_execute_returns_action_execution(capture: RequestCapture):
    """execute() POSTs to .../execute and returns ActionExecution with poll_fn."""
    def handler(req: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json={
            "execution_id": "exec_42",
            "status": "running",
            "result": None,
        })

    client = make_client(handler, capture)
    execution = client.action_types.execute("kn_001", "at_01", params={"x": 1})

    assert execution.execution_id == "exec_42"
    assert execution.kn_id == "kn_001"
    assert execution.action_type_id == "at_01"
    assert execution.status == "running"
    assert "/kn_001/action-types/at_01/execute" in capture.last_url()
    # poll_fn should be set (callable)
    assert execution._poll_fn is not None


def test_list_logs(capture: RequestCapture):
    """list_logs() GETs logs with query params."""
    def handler(req: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json={
            "entries": [
                {"id": "log_01", "status": "completed"},
                {"id": "log_02", "status": "failed"},
            ]
        })

    client = make_client(handler, capture)
    logs = client.action_types.list_logs("kn_001", offset=10, limit=5)

    assert len(logs) == 2
    assert logs[0]["id"] == "log_01"
    url = capture.last_url()
    assert "/kn_001/action-logs" in url
    assert "offset=10" in url
    assert "limit=5" in url
    assert capture.requests[-1].method == "GET"


def test_execute_assembles_envelope_from_kwargs(capture: RequestCapture):
    """execute(dynamic_params=..., instances=...) wraps into the envelope shape."""
    def handler(req: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json={"execution_id": "exec_1", "status": "running"})

    client = make_client(handler, capture)
    client.action_types.execute(
        "kn_1", "at_1",
        dynamic_params={"task_id": "x", "qty": 3},
        instances=[{"task_id": "x"}],
    )
    sent = json.loads(capture.requests[-1].content)
    assert sent == {
        "trigger_type": "manual",
        "_instance_identities": [{"task_id": "x"}],
        "dynamic_params": {"task_id": "x", "qty": 3},
    }


def test_execute_kwargs_default_to_empty_lists(capture: RequestCapture):
    def handler(req: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json={"execution_id": "exec_1", "status": "running"})

    client = make_client(handler, capture)
    client.action_types.execute("kn_1", "at_1", dynamic_params={"a": 1})
    sent = json.loads(capture.requests[-1].content)
    assert sent["_instance_identities"] == []
    assert sent["trigger_type"] == "manual"


def test_execute_rejects_params_and_kwargs_together(capture: RequestCapture):
    def handler(req: httpx.Request) -> httpx.Response:  # not reached
        return httpx.Response(200, json={})

    client = make_client(handler, capture)
    with pytest.raises(ValueError, match="mutually exclusive"):
        client.action_types.execute(
            "kn_1", "at_1",
            params={"trigger_type": "manual"},
            dynamic_params={"a": 1},
        )


def test_inputs_filters_value_from_input(capture: RequestCapture):
    def handler(req: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json={
            "id": "at_1",
            "parameters": [
                {"name": "task_id", "value_from": "input", "type": "string", "required": True},
                {"name": "Authorization", "value_from": "input", "type": "string", "source": "header"},
                {"name": "tenant", "value_from": "const"},
                {"name": "name", "value_from": "property"},
            ],
        })

    client = make_client(handler, capture)
    inputs = client.action_types.inputs("kn_1", "at_1")
    names = sorted(p["name"] for p in inputs)
    assert names == ["Authorization", "task_id"]
    assert capture.requests[-1].method == "GET"
    assert "/kn_1/action-types/at_1" in capture.last_url()


def test_collect_input_parameters_walks_nested_response():
    raw = {"data": {"action_type": {"parameters": [
        {"name": "x", "value_from": "input"},
        {"name": "y", "value_from": "const"},
    ]}}}
    out = _collect_input_parameters(raw)
    assert [p["name"] for p in out] == ["x"]


def test_cancel(capture: RequestCapture):
    """cancel() POSTs to .../cancel."""
    def handler(req: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json={})

    client = make_client(handler, capture)
    client.action_types.cancel("kn_001", "log_99")

    assert "/kn_001/action-logs/log_99/cancel" in capture.last_url()
    assert capture.requests[-1].method == "POST"
