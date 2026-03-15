"""Unit tests for ContextLoaderResource (MCP JSON-RPC 2.0 client).

All HTTP calls are intercepted via httpx.MockTransport so no real network
is required.  These tests mirror the TypeScript context-loader test scenarios
to ensure functional equivalence.
"""

from __future__ import annotations

import json

import httpx
import pytest

from kweaver.resources.context_loader import ContextLoaderResource

_BASE_URL = "https://mock-kweaver"
_KN_ID = "kn_test_01"
_TOKEN = "test-access-token"
_SESSION_ID = "sess-abc123"
_MCP_URL = f"{_BASE_URL}/api/agent-retrieval/v1/mcp"


# ── Helpers ──────────────────────────────────────────────────────────────────


def _tool_response(content: dict) -> dict:
    """Wrap a tool result in the expected JSON-RPC + MCP content envelope."""
    return {
        "jsonrpc": "2.0",
        "id": 1,
        "result": {
            "content": [{"type": "text", "text": json.dumps(content)}]
        },
    }


def _method_response(result: dict) -> dict:
    return {"jsonrpc": "2.0", "id": 1, "result": result}


def _error_response(message: str, code: int = -32000) -> dict:
    return {"jsonrpc": "2.0", "id": 1, "error": {"code": code, "message": message}}


def _missing_params_response() -> dict:
    return {
        "jsonrpc": "2.0",
        "id": 1,
        "error": {
            "code": -32000,
            "message": "missing params",
            "data": {
                "error_code": "MISSING_INPUT_PARAMS",
                "message": "Need more context",
                "missing": [
                    {
                        "property": "diagnosis",
                        "params": [
                            {"name": "treatment_year", "type": "int", "hint": "e.g. 2023"},
                        ],
                    }
                ],
            },
        },
    }


class _MockTransport(httpx.BaseTransport):
    """Stateful mock transport: serves initialize+notifications, then queued responses."""

    def __init__(self, queued_responses: list[dict]) -> None:
        self._call_count = 0
        self._queued = queued_responses

    def handle_request(self, request: httpx.Request) -> httpx.Response:
        self._call_count += 1
        body_text = request.content.decode()
        body = json.loads(body_text) if body_text else {}

        if body.get("method") == "initialize":
            return httpx.Response(
                200,
                json={"jsonrpc": "2.0", "id": 1, "result": {"protocolVersion": "2024-11-05"}},
                headers={"MCP-Session-Id": _SESSION_ID},
            )
        if body.get("method") == "notifications/initialized":
            return httpx.Response(200, json={})

        if self._queued:
            return httpx.Response(200, json=self._queued.pop(0))

        return httpx.Response(500, json={"error": "no more queued responses"})


@pytest.fixture(autouse=True)
def clear_session_cache():
    """Ensure the global session cache is clean before each test."""
    ContextLoaderResource.clear_session_cache()
    yield
    ContextLoaderResource.clear_session_cache()


def _make_cl(queued: list[dict]) -> tuple[ContextLoaderResource, _MockTransport]:
    transport = _MockTransport(queued)
    cl = ContextLoaderResource.__new__(ContextLoaderResource)
    cl._base_url = _BASE_URL
    cl._mcp_url = _MCP_URL
    cl._access_token = _TOKEN
    cl._kn_id = _KN_ID
    cl._cache_key = f"{_MCP_URL}:{_KN_ID}"
    cl._transport = transport

    import httpx as _httpx

    original_client_init = _httpx.Client.__init__

    import unittest.mock as _mock

    ctx = _mock.patch("httpx.Client")
    MockClient = ctx.start()
    instance = _mock.MagicMock()

    def fake_post(url, **kwargs):
        req = _httpx.Request("POST", url, content=kwargs.get("content", b""), headers=kwargs.get("headers", {}))
        return transport.handle_request(req)

    instance.post.side_effect = fake_post
    instance.__enter__ = _mock.MagicMock(return_value=instance)
    instance.__exit__ = _mock.MagicMock(return_value=False)
    instance.raise_for_status = _mock.MagicMock()
    MockClient.return_value = instance

    cl._mock_ctx = ctx
    cl._mock_instance = instance
    return cl, transport


# ── Session initialization ────────────────────────────────────────────────────


def test_session_initialization():
    """ContextLoaderResource caches session ID after initialize + notifications/initialized."""
    cl, transport = _make_cl([_tool_response({"object_types": []})])
    try:
        cl.kn_search("test")
        assert transport._call_count >= 2
    finally:
        cl._mock_ctx.stop()


def test_session_cached_on_second_call():
    """Session should be reused (not re-initialized) on subsequent calls."""
    from kweaver.resources import context_loader as _mod
    _mod._session_cache[f"{_MCP_URL}:{_KN_ID}"] = _SESSION_ID

    cl, transport = _make_cl([
        _tool_response({"object_types": [{"id": "ot1"}]}),
        _tool_response({"datas": []}),
    ])
    try:
        cl.kn_search("test query")
        cl.query_object_instance("ot1", {"operation": "and", "sub_conditions": []})
        assert transport._call_count == 2
    finally:
        cl._mock_ctx.stop()
        _mod._session_cache.clear()


# ── Layer 1: kn_search ────────────────────────────────────────────────────────


def test_kn_search_returns_schema():
    """kn_search: returns object_types, relation_types, action_types."""
    expected = {
        "object_types": [{"id": "ot1", "name": "Patient"}],
        "relation_types": [],
        "action_types": [],
    }
    cl, transport = _make_cl([_tool_response(expected)])
    try:
        result = cl.kn_search("patient")
        assert result["object_types"][0]["name"] == "Patient"
    finally:
        cl._mock_ctx.stop()


def test_kn_search_only_schema_flag():
    """kn_search: only_schema=True passes through in args."""
    expected = {"object_types": [], "relation_types": [], "action_types": []}
    cl, transport = _make_cl([_tool_response(expected)])
    try:
        result = cl.kn_search("patient", only_schema=True)
        assert isinstance(result, dict)
    finally:
        cl._mock_ctx.stop()


# ── Layer 2: query_object_instance ────────────────────────────────────────────


def test_query_object_instance_returns_datas():
    """query_object_instance: returns datas list with _instance_identity."""
    expected = {
        "datas": [
            {"_instance_identity": {"id": "p001"}, "name": "Alice", "age": 30}
        ]
    }
    condition = {"operation": "and", "sub_conditions": []}
    cl, transport = _make_cl([_tool_response(expected)])
    try:
        result = cl.query_object_instance("ot_patient", condition, limit=10)
        assert len(result["datas"]) == 1
        assert result["datas"][0]["_instance_identity"]["id"] == "p001"
    finally:
        cl._mock_ctx.stop()


# ── Layer 3: get_logic_properties_values ─────────────────────────────────────


def test_get_logic_properties_raises_on_missing_params():
    """get_logic_properties_values: raises with hint on MISSING_INPUT_PARAMS."""
    cl, transport = _make_cl([_missing_params_response()])
    try:
        with pytest.raises(RuntimeError, match="MISSING_INPUT_PARAMS"):
            cl.get_logic_properties_values(
                "ot1", "treatment", [{"id": "p001"}], ["treatment_plan"]
            )
    finally:
        cl._mock_ctx.stop()


def test_get_logic_properties_returns_values():
    """get_logic_properties_values: returns property values on success."""
    expected = {"properties": {"treatment_plan": "insulin therapy"}}
    cl, transport = _make_cl([_tool_response(expected)])
    try:
        result = cl.get_logic_properties_values(
            "ot1", "treatment", [{"id": "p001"}], ["treatment_plan"]
        )
        assert result["properties"]["treatment_plan"] == "insulin therapy"
    finally:
        cl._mock_ctx.stop()


# ── Layer 3: get_action_info ──────────────────────────────────────────────────


def test_get_action_info_returns_dynamic_tools():
    """get_action_info: returns _dynamic_tools list."""
    expected = {"_dynamic_tools": [{"name": "prescribe", "description": "Prescribe medicine"}]}
    cl, transport = _make_cl([_tool_response(expected)])
    try:
        result = cl.get_action_info("at_prescribe", {"id": "p001"})
        assert result["_dynamic_tools"][0]["name"] == "prescribe"
    finally:
        cl._mock_ctx.stop()


# ── MCP introspection ─────────────────────────────────────────────────────────


def test_list_tools():
    """list_tools: calls tools/list and returns result."""
    expected = {"tools": [{"name": "kn_search"}, {"name": "query_object_instance"}]}
    cl, transport = _make_cl([_method_response(expected)])
    try:
        result = cl.list_tools()
        assert len(result["tools"]) == 2
    finally:
        cl._mock_ctx.stop()


def test_list_resources():
    """list_resources: calls resources/list and returns result."""
    expected = {"resources": [{"uri": "kn://schema", "name": "schema"}]}
    cl, transport = _make_cl([_method_response(expected)])
    try:
        result = cl.list_resources()
        assert result["resources"][0]["uri"] == "kn://schema"
    finally:
        cl._mock_ctx.stop()


# ── Error handling ────────────────────────────────────────────────────────────


def test_rpc_error_raises_runtime_error():
    """Any JSON-RPC error response should raise RuntimeError."""
    cl, transport = _make_cl([_error_response("tool not found")])
    try:
        with pytest.raises(RuntimeError, match="tool not found"):
            cl.kn_search("test")
    finally:
        cl._mock_ctx.stop()


def test_missing_session_id_raises():
    """If server does not return MCP-Session-Id, RuntimeError is raised."""
    import unittest.mock as _mock

    cl = ContextLoaderResource.__new__(ContextLoaderResource)
    cl._base_url = _BASE_URL
    cl._mcp_url = _MCP_URL
    cl._access_token = _TOKEN
    cl._kn_id = _KN_ID
    cl._cache_key = f"{_MCP_URL}:{_KN_ID}"

    ctx = _mock.patch("httpx.Client")
    MockClient = ctx.start()
    instance = _mock.MagicMock()
    no_session_resp = _mock.MagicMock()
    no_session_resp.status_code = 200
    no_session_resp.headers = {}
    instance.post.return_value = no_session_resp
    instance.__enter__ = _mock.MagicMock(return_value=instance)
    instance.__exit__ = _mock.MagicMock(return_value=False)
    MockClient.return_value = instance

    try:
        with pytest.raises(RuntimeError, match="MCP-Session-Id"):
            cl._ensure_session()
    finally:
        ctx.stop()
