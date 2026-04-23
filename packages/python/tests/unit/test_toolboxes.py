"""Unit tests for the toolboxes resource (envelope shape, routing, auto-auth)."""

from __future__ import annotations

import json

import httpx

from kweaver import KWeaverClient


_PREFIX = "/api/agent-operator-integration/v1/tool-box"


def _transport(handler):
    return httpx.MockTransport(handler)


def _client(handler):
    return KWeaverClient(base_url="https://mock", token="tok-py", transport=_transport(handler))


def test_list_toolboxes_uses_list_endpoint_and_unwraps_data():
    captured: dict[str, object] = {}

    def handler(request: httpx.Request) -> httpx.Response:
        captured["url"] = str(request.url)
        return httpx.Response(200, json={"code": 0, "data": {"entries": [{"box_id": "b1"}]}})

    client = _client(handler)
    try:
        result = client.toolboxes.list(keyword="foo", limit=10, offset=0)
        assert result == {"entries": [{"box_id": "b1"}]}
        assert "/tool-box/list" in captured["url"]  # type: ignore[index]
        assert "keyword=foo" in captured["url"]  # type: ignore[operator]
    finally:
        client.close()


def test_list_tools_in_toolbox():
    def handler(request: httpx.Request) -> httpx.Response:
        assert request.url.path == f"{_PREFIX}/b1/tools/list"
        return httpx.Response(200, json={"data": [{"tool_id": "t1"}]})

    client = _client(handler)
    try:
        result = client.toolboxes.list_tools("b1")
        assert result == [{"tool_id": "t1"}]
    finally:
        client.close()


def test_set_tool_statuses_normalises_tuple_input():
    captured: dict[str, object] = {}

    def handler(request: httpx.Request) -> httpx.Response:
        captured["body"] = json.loads(request.content)
        return httpx.Response(200, json={"code": 0})

    client = _client(handler)
    try:
        client.toolboxes.set_tool_statuses("b1", [("t1", "enabled"), ("t2", "disabled")])
        assert captured["body"] == {
            "updates": [
                {"tool_id": "t1", "status": "enabled"},
                {"tool_id": "t2", "status": "disabled"},
            ]
        }
    finally:
        client.close()


def test_execute_posts_envelope_to_proxy_endpoint():
    captured: dict[str, object] = {}

    def handler(request: httpx.Request) -> httpx.Response:
        captured["path"] = request.url.path
        captured["body"] = json.loads(request.content)
        return httpx.Response(200, json={"code": 0, "data": {"ok": True}})

    client = _client(handler)
    try:
        client.toolboxes.execute(
            "b1",
            "t1",
            body={"task_id": "x"},
            header={"Authorization": "Bearer override"},
            query={"dry": "true"},
            timeout=42,
        )
        assert captured["path"] == f"{_PREFIX}/b1/proxy/t1"
        assert captured["body"] == {
            "timeout": 42,
            "header": {"Authorization": "Bearer override"},
            "query": {"dry": "true"},
            "body": {"task_id": "x"},
        }
    finally:
        client.close()


def test_debug_posts_envelope_to_debug_endpoint():
    captured: dict[str, object] = {}

    def handler(request: httpx.Request) -> httpx.Response:
        captured["path"] = request.url.path
        return httpx.Response(200, json={})

    client = _client(handler)
    try:
        client.toolboxes.debug("b1", "t1")
        assert captured["path"] == f"{_PREFIX}/b1/tool/t1/debug"
    finally:
        client.close()


def test_execute_auto_injects_authorization_header_from_session_token():
    captured: dict[str, object] = {}

    def handler(request: httpx.Request) -> httpx.Response:
        captured["body"] = json.loads(request.content)
        return httpx.Response(200, json={})

    # NB: TokenAuth emits the raw token as the Authorization value (no "Bearer "
    # prefix is added). The forwarder relays it verbatim to the downstream tool;
    # callers who need the prefix should pass token="Bearer ..." explicitly.
    client = _client(handler)
    try:
        client.toolboxes.execute("b1", "t1", body={"k": 1})
        envelope = captured["body"]
        assert envelope["header"] == {"Authorization": "tok-py"}  # type: ignore[index]
        assert envelope["body"] == {"k": 1}  # type: ignore[index]
        assert envelope["query"] == {}  # type: ignore[index]
        assert "timeout" not in envelope  # type: ignore[operator]
    finally:
        client.close()


def test_execute_forward_auth_false_omits_authorization():
    captured: dict[str, object] = {}

    def handler(request: httpx.Request) -> httpx.Response:
        captured["body"] = json.loads(request.content)
        return httpx.Response(200, json={})

    client = _client(handler)
    try:
        client.toolboxes.execute("b1", "t1", body={}, forward_auth=False)
        assert captured["body"]["header"] == {}  # type: ignore[index]
    finally:
        client.close()


def test_execute_caller_provided_authorization_is_preserved():
    captured: dict[str, object] = {}

    def handler(request: httpx.Request) -> httpx.Response:
        captured["body"] = json.loads(request.content)
        return httpx.Response(200, json={})

    client = _client(handler)
    try:
        client.toolboxes.execute("b1", "t1", header={"authorization": "Bearer override"})
        # Case-insensitive: caller's lowercase key wins, no auto-injection above it.
        assert captured["body"]["header"] == {"authorization": "Bearer override"}  # type: ignore[index]
    finally:
        client.close()
