"""Tests for MCPServersResource."""
import httpx
import pytest
from tests.conftest import RequestCapture, make_client


def test_list_mcp_servers(capture: RequestCapture):
    def handler(req):
        return httpx.Response(200, json={"data": [], "total": 0})
    client = make_client(handler, capture)
    result = client.mcp_servers.list()
    assert capture.requests[-1].method == "GET"
    assert "/mcp/list" in capture.last_url()


def test_get_mcp_server(capture: RequestCapture):
    def handler(req):
        return httpx.Response(200, json={"mcp_id": "mcp-1", "name": "Test MCP"})
    client = make_client(handler, capture)
    result = client.mcp_servers.get("mcp-1")
    assert result["mcp_id"] == "mcp-1"
    assert "/mcp/mcp-1" in capture.last_url()


def test_register_mcp_server(capture: RequestCapture):
    def handler(req):
        return httpx.Response(200, json={"mcp_id": "mcp-1"})
    client = make_client(handler, capture)
    result = client.mcp_servers.register({"name": "Test MCP", "mode": "sse"})
    assert capture.requests[-1].method == "POST"
    url = capture.last_url()
    assert url.endswith("/mcp") or "/mcp?" in url


def test_update_mcp_server(capture: RequestCapture):
    def handler(req):
        return httpx.Response(200, json={"mcp_id": "mcp-1"})
    client = make_client(handler, capture)
    result = client.mcp_servers.update("mcp-1", body={"mode": "sse"})
    assert capture.requests[-1].method == "PUT"
    assert "/mcp/mcp-1" in capture.last_url()


def test_delete_mcp_server(capture: RequestCapture):
    def handler(req):
        return httpx.Response(200, json={})
    client = make_client(handler, capture)
    result = client.mcp_servers.delete("mcp-1")
    assert capture.requests[-1].method == "DELETE"
    assert "/mcp/mcp-1" in capture.last_url()


def test_update_mcp_server_status(capture: RequestCapture):
    def handler(req):
        return httpx.Response(200, json={"mcp_id": "mcp-1", "status": "published"})
    client = make_client(handler, capture)
    result = client.mcp_servers.update_status("mcp-1", status="published")
    assert capture.requests[-1].method == "PUT"
    assert "/mcp/mcp-1/status" in capture.last_url()


def test_parse_sse(capture: RequestCapture):
    def handler(req):
        return httpx.Response(200, json={"tools": [{"name": "tool-1"}]})
    client = make_client(handler, capture)
    result = client.mcp_servers.parse_sse({"mode": "sse", "url": "http://example.com/sse", "headers": {}})
    assert capture.requests[-1].method == "POST"
    assert "/parse/sse" in capture.last_url()


def test_debug_mcp_tool(capture: RequestCapture):
    def handler(req):
        return httpx.Response(200, json={"content": [{"type": "text", "text": "ok"}]})
    client = make_client(handler, capture)
    result = client.mcp_servers.debug_tool("mcp-1", "tool-1", body={})
    assert capture.requests[-1].method == "POST"
    assert "/mcp/mcp-1/tools/tool-1/debug" in capture.last_url()


def test_list_mcp_market(capture: RequestCapture):
    def handler(req):
        return httpx.Response(200, json={"data": []})
    client = make_client(handler, capture)
    result = client.mcp_servers.list_market()
    assert "/mcp/market/list" in capture.last_url()


def test_get_mcp_market(capture: RequestCapture):
    def handler(req):
        return httpx.Response(200, json={"mcp_id": "mcp-1"})
    client = make_client(handler, capture)
    result = client.mcp_servers.get_market("mcp-1")
    assert "/mcp/market/mcp-1" in capture.last_url()


def test_list_mcp_categories(capture: RequestCapture):
    def handler(req):
        return httpx.Response(200, json=[{"category": "cat-1"}])
    client = make_client(handler, capture)
    result = client.mcp_servers.list_categories()
    assert "/mcp/categories" in capture.last_url()


def test_proxy_call_tool(capture: RequestCapture):
    def handler(req):
        return httpx.Response(200, json={"content": [{"type": "text", "text": "ok"}]})
    client = make_client(handler, capture)
    result = client.mcp_servers.proxy_call_tool("mcp-1", body={"tool_name": "tool-1", "parameters": {}})
    assert capture.requests[-1].method == "POST"
    assert "/proxy/call-tool" in capture.last_url()


def test_proxy_list_tools(capture: RequestCapture):
    def handler(req):
        return httpx.Response(200, json={"tools": [{"name": "tool-1"}]})
    client = make_client(handler, capture)
    result = client.mcp_servers.proxy_list_tools("mcp-1")
    assert capture.requests[-1].method == "GET"
    assert "/proxy/list-tools" in capture.last_url()
