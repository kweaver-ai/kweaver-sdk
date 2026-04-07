"""Tests for ToolBoxesResource."""
import httpx
import pytest
from tests.conftest import RequestCapture, make_client


def test_list_toolboxes(capture: RequestCapture):
    def handler(req):
        return httpx.Response(200, json={"data": [], "total": 0})
    client = make_client(handler, capture)
    result = client.toolboxes.list()
    assert capture.requests[-1].method == "GET"
    assert "/tool-box/list" in capture.last_url()


def test_get_toolbox(capture: RequestCapture):
    def handler(req):
        return httpx.Response(200, json={"box_id": "box-1", "box_name": "Test Box"})
    client = make_client(handler, capture)
    result = client.toolboxes.get("box-1")
    assert result["box_id"] == "box-1"
    assert "/tool-box/box-1" in capture.last_url()


def test_create_toolbox(capture: RequestCapture):
    def handler(req):
        return httpx.Response(200, json={"box_id": "box-1"})
    client = make_client(handler, capture)
    result = client.toolboxes.create({"box_name": "Test Box", "metadata_type": "openapi"})
    assert capture.requests[-1].method == "POST"
    url = capture.last_url()
    assert url.endswith("/tool-box") or "/tool-box?" in url


def test_update_toolbox(capture: RequestCapture):
    def handler(req):
        return httpx.Response(200, json={"box_id": "box-1"})
    client = make_client(handler, capture)
    result = client.toolboxes.update("box-1", body={
        "box_name": "Updated", "box_desc": "desc",
        "box_svc_url": "url", "box_category": "cat",
    })
    assert capture.requests[-1].method == "PUT"
    assert "/tool-box/box-1" in capture.last_url()


def test_delete_toolbox(capture: RequestCapture):
    def handler(req):
        return httpx.Response(200, json={"box_id": "box-1"})
    client = make_client(handler, capture)
    result = client.toolboxes.delete("box-1")
    assert capture.requests[-1].method == "DELETE"
    assert "/tool-box/box-1" in capture.last_url()


def test_update_toolbox_status(capture: RequestCapture):
    def handler(req):
        return httpx.Response(200, json={"box_id": "box-1", "status": "published"})
    client = make_client(handler, capture)
    result = client.toolboxes.update_status("box-1", body={"status": "published"})
    assert capture.requests[-1].method == "PUT"
    assert "/tool-box/box-1/status" in capture.last_url()


def test_list_tools(capture: RequestCapture):
    def handler(req):
        return httpx.Response(200, json={"tools": [], "total": 0})
    client = make_client(handler, capture)
    result = client.toolboxes.list_tools("box-1")
    assert "/tool-box/box-1/tools" in capture.last_url()


def test_get_tool(capture: RequestCapture):
    def handler(req):
        return httpx.Response(200, json={"tool_id": "tool-1", "name": "Test Tool"})
    client = make_client(handler, capture)
    result = client.toolboxes.get_tool("box-1", "tool-1")
    assert result["tool_id"] == "tool-1"
    assert "/tool-box/box-1/tools/tool-1" in capture.last_url()


def test_create_tool(capture: RequestCapture):
    def handler(req):
        return httpx.Response(200, json={"box_id": "box-1", "success_count": 1})
    client = make_client(handler, capture)
    result = client.toolboxes.create_tool("box-1", body={"metadata_type": "openapi"})
    assert capture.requests[-1].method == "POST"
    assert "/tool-box/box-1/tools" in capture.last_url()


def test_update_tool(capture: RequestCapture):
    def handler(req):
        return httpx.Response(200, json={"box_id": "box-1", "tool_id": "tool-1"})
    client = make_client(handler, capture)
    result = client.toolboxes.update_tool("box-1", "tool-1", body={"name": "Updated"})
    assert capture.requests[-1].method == "PUT"
    assert "/tool-box/box-1/tools/tool-1" in capture.last_url()


def test_update_tool_status(capture: RequestCapture):
    def handler(req):
        return httpx.Response(200, json=[{"tool_id": "tool-1", "status": "enabled"}])
    client = make_client(handler, capture)
    result = client.toolboxes.update_tool_status("box-1", body={"tool_id": "tool-1", "status": "enabled"})
    assert capture.requests[-1].method == "PUT"
    assert "/tool-box/box-1/tools/status" in capture.last_url()


def test_delete_tool(capture: RequestCapture):
    def handler(req):
        return httpx.Response(200, json={"box_id": "box-1", "tool_ids": ["tool-1"]})
    client = make_client(handler, capture)
    result = client.toolboxes.delete_tool("box-1", "tool-1")
    assert capture.requests[-1].method == "DELETE"
    assert "/tool-box/box-1/tools/tool-1" in capture.last_url()


def test_batch_delete_tools(capture: RequestCapture):
    def handler(req):
        return httpx.Response(200, json={"box_id": "box-1", "tool_ids": ["tool-1", "tool-2"]})
    client = make_client(handler, capture)
    result = client.toolboxes.batch_delete_tools("box-1", body={"tool_ids": ["tool-1", "tool-2"]})
    assert capture.requests[-1].method == "POST"
    assert "/batch-delete" in capture.last_url()


def test_convert_operator_to_tool(capture: RequestCapture):
    def handler(req):
        return httpx.Response(200, json={"box_id": "box-1", "tool_id": "tool-1"})
    client = make_client(handler, capture)
    result = client.toolboxes.convert_operator_to_tool({
        "box_id": "box-1", "operator_id": "op-1", "operator_version": "v1",
    })
    assert capture.requests[-1].method == "POST"
    assert "/convert" in capture.last_url()


def test_list_toolbox_market(capture: RequestCapture):
    def handler(req):
        return httpx.Response(200, json={"data": []})
    client = make_client(handler, capture)
    result = client.toolboxes.list_market()
    assert "/tool-box/market" in capture.last_url()


def test_get_toolbox_market(capture: RequestCapture):
    def handler(req):
        return httpx.Response(200, json={"box_id": "box-1"})
    client = make_client(handler, capture)
    result = client.toolboxes.get_market("box-1")
    assert "/tool-box/market/box-1" in capture.last_url()


def test_list_toolbox_categories(capture: RequestCapture):
    def handler(req):
        return httpx.Response(200, json=[{"category_type": "cat-1"}])
    client = make_client(handler, capture)
    result = client.toolboxes.list_categories()
    assert "/tool-box/categories" in capture.last_url()


def test_create_internal_toolbox(capture: RequestCapture):
    def handler(req):
        return httpx.Response(200, json={"box_id": "box-1"})
    client = make_client(handler, capture)
    body = {
        "box_id": "box-1", "box_name": "Test", "box_desc": "desc",
        "metadata_type": "function", "data": "test",
        "config_version": "v1", "config_source": "auto",
    }
    result = client.toolboxes.create_internal(body)
    assert capture.requests[-1].method == "POST"
    assert "/tool-box/internal" in capture.last_url()


def test_tool_proxy(capture: RequestCapture):
    def handler(req):
        return httpx.Response(200, json={"status_code": 200, "body": {}})
    client = make_client(handler, capture)
    result = client.toolboxes.tool_proxy("box-1", "tool-1", body={})
    assert capture.requests[-1].method == "POST"
    assert "/proxy" in capture.last_url()


def test_debug_tool(capture: RequestCapture):
    def handler(req):
        return httpx.Response(200, json={"status_code": 200, "body": {}})
    client = make_client(handler, capture)
    result = client.toolboxes.debug_tool("box-1", "tool-1", body={})
    assert capture.requests[-1].method == "POST"
    assert "/debug" in capture.last_url()


def test_execute_function(capture: RequestCapture):
    def handler(req):
        return httpx.Response(200, json={"result": "ok"})
    client = make_client(handler, capture)
    result = client.toolboxes.execute_function({"code": "print('hello')"})
    assert capture.requests[-1].method == "POST"
    assert "/function/execute" in capture.last_url()


def test_ai_generate_function(capture: RequestCapture):
    def handler(req):
        return httpx.Response(200, json={"content": {"name": "test"}})
    client = make_client(handler, capture)
    result = client.toolboxes.ai_generate_function({"query": "generate a function"})
    assert capture.requests[-1].method == "POST"
    assert "/function/ai-generate" in capture.last_url()


def test_list_prompt_templates(capture: RequestCapture):
    def handler(req):
        return httpx.Response(200, json=[{"prompt_id": "p-1"}])
    client = make_client(handler, capture)
    result = client.toolboxes.list_prompt_templates()
    assert "/function/prompt-templates" in capture.last_url()


def test_install_dependencies(capture: RequestCapture):
    def handler(req):
        return httpx.Response(200, json={"session_id": "s-1"})
    client = make_client(handler, capture)
    result = client.toolboxes.install_dependencies({
        "dependencies": [{"name": "requests", "version": "2.28.0"}],
    })
    assert capture.requests[-1].method == "POST"
    assert "/dependencies/install" in capture.last_url()


def test_get_dependency_versions(capture: RequestCapture):
    def handler(req):
        return httpx.Response(200, json={"package_name": "requests", "versions": ["2.28.0"]})
    client = make_client(handler, capture)
    result = client.toolboxes.get_dependency_versions("requests")
    assert "/dependencies/requests/versions" in capture.last_url()
