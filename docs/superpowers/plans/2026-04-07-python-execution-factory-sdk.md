# Python Execution Factory SDK Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Port TypeScript execution-factory SDK (4 modules, 50 API methods) to Python SDK with full unit test coverage

**Architecture:** Create 4 new Resource classes (`OperatorsResource`, `ToolBoxesResource`, `MCPServersResource`, `ImpexResource`) following existing Python SDK patterns (HttpClient-based, dict in/out), register them in KWeaverClient, and write TDD-style unit tests using httpx.MockTransport + RequestCapture fixtures. All API endpoints map to `/api/agent-operator-integration/v1`.

**Tech Stack:** Python 3.10+, httpx, pytest, Pydantic (types only)

**Reference:**
- TS source: `packages/typescript/src/api/execution-factory/{operator,toolbox,mcp,impex}.ts`
- TS types: `packages/typescript/src/api/execution-factory/types.ts`
- Python pattern: `packages/python/src/kweaver/resources/{jobs,agents}.py`
- Python test pattern: `packages/python/tests/unit/test_jobs.py`
- Test fixtures: `packages/python/tests/conftest.py`

---

## File Structure

```
packages/python/src/kweaver/resources/
├── operators.py          # NEW — OperatorsResource (12 methods)
├── toolboxes.py          # NEW — ToolBoxesResource (22 methods)
├── mcp_servers.py        # NEW — MCPServersResource (14 methods)
└── impex.py              # NEW — ImpexResource (2 methods)

packages/python/src/kweaver/_client.py           # MODIFY — add 4 attributes

packages/python/tests/unit/
├── test_operators.py     # NEW — ~12 test cases
├── test_toolboxes.py     # NEW — ~22 test cases
├── test_mcp_servers.py   # NEW — ~14 test cases
└── test_impex.py         # NEW — ~2 test cases
```

---

### Task 1: OperatorsResource — Implementation & Tests

**Files:**
- Create: `packages/python/src/kweaver/resources/operators.py`
- Create: `packages/python/tests/unit/test_operators.py`

**API Prefix:** `/api/agent-operator-integration/v1`

**Methods to implement (12):**

| Method | HTTP | Endpoint | TS Source |
|--------|------|----------|-----------|
| `list()` | GET | `/operator/info/list` | listOperators |
| `get()` | GET | `/operator/{id}` | getOperator |
| `register()` | POST | `/operator/register` | registerOperator |
| `edit()` | PUT | `/operator/{id}/versions/{version}` | editOperator |
| `delete()` | POST | `/operator/delete` | deleteOperator |
| `update_status()` | PUT | `/operator/status` | updateOperatorStatus |
| `debug()` | POST | `/operator/debug` | debugOperator |
| `list_history()` | GET | `/operator/{id}/history` | listOperatorHistory |
| `list_market()` | GET | `/operator/market` | listOperatorMarket |
| `get_market()` | GET | `/operator/market/{id}` | getOperatorMarket |
| `list_categories()` | GET | `/operator/categories` | listOperatorCategories |
| `register_internal()` | POST | `/operator/internal/register` | registerInternalOperator |

- [ ] **Step 1: Write failing tests for OperatorsResource**

```python
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /home/yabosui/kweaver-sdk && python -m pytest packages/python/tests/unit/test_operators.py -v 2>&1 | head -30`
Expected: FAIL — `AttributeError: 'KWeaverClient' has no attribute 'operators'`

- [ ] **Step 3: Implement OperatorsResource**

```python
"""SDK resource: operators (execution-factory service)."""
from __future__ import annotations

from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:
    from kweaver._http import HttpClient

_API_PREFIX = "/api/agent-operator-integration/v1"


class OperatorsResource:
    """Operator management via agent-operator-integration API."""

    def __init__(self, http: HttpClient) -> None:
        self._http = http

    def list(
        self,
        *,
        page: int = 1,
        page_size: int = 10,
        operator_id: str | None = None,
        name: str | None = None,
        status: str = "published",
        metadata_type: str | None = None,
        category: str | None = None,
        source: str | None = None,
        create_user: str | None = None,
    ) -> dict[str, Any]:
        params: dict[str, Any] = {"page": page, "page_size": page_size, "status": status}
        if operator_id:
            params["operator_id"] = operator_id
        if name:
            params["name"] = name
        if metadata_type:
            params["metadata_type"] = metadata_type
        if category:
            params["category"] = category
        if source:
            params["source"] = source
        if create_user:
            params["create_user"] = create_user
        return self._http.get(f"{_API_PREFIX}/operator/info/list", params=params)

    def get(self, operator_id: str, *, version: str | None = None) -> dict[str, Any]:
        url = f"{_API_PREFIX}/operator/{operator_id}"
        if version:
            url += f"?version={version}"
        return self._http.get(url)

    def register(self, body: dict[str, Any]) -> dict[str, Any]:
        return self._http.post(f"{_API_PREFIX}/operator/register", json=body)

    def edit(self, operator_id: str, version: str, *, body: dict[str, Any]) -> dict[str, Any]:
        return self._http.put(
            f"{_API_PREFIX}/operator/{operator_id}/versions/{version}", json=body
        )

    def delete(self, body: list[dict[str, Any]]) -> dict[str, Any]:
        return self._http.post(f"{_API_PREFIX}/operator/delete", json=body)

    def update_status(self, body: list[dict[str, Any]]) -> dict[str, Any]:
        return self._http.put(f"{_API_PREFIX}/operator/status", json=body)

    def debug(self, body: dict[str, Any]) -> dict[str, Any]:
        return self._http.post(f"{_API_PREFIX}/operator/debug", json=body)

    def list_history(
        self, operator_id: str, *, page: int = 1, page_size: int = 10
    ) -> dict[str, Any]:
        params = {"page": page, "page_size": page_size}
        return self._http.get(
            f"{_API_PREFIX}/operator/{operator_id}/history", params=params
        )

    def list_market(
        self,
        *,
        page: int = 1,
        page_size: int = 10,
        operator_id: str | None = None,
        name: str | None = None,
        category: str | None = None,
        source: str | None = None,
    ) -> dict[str, Any]:
        params: dict[str, Any] = {"page": page, "page_size": page_size}
        if operator_id:
            params["operator_id"] = operator_id
        if name:
            params["name"] = name
        if category:
            params["category"] = category
        if source:
            params["source"] = source
        return self._http.get(f"{_API_PREFIX}/operator/market", params=params)

    def get_market(self, operator_id: str) -> dict[str, Any]:
        return self._http.get(f"{_API_PREFIX}/operator/market/{operator_id}")

    def list_categories(self) -> list[dict[str, Any]]:
        return self._http.get(f"{_API_PREFIX}/operator/categories")

    def register_internal(self, body: dict[str, Any]) -> dict[str, Any]:
        return self._http.post(f"{_API_PREFIX}/operator/internal/register", json=body)
```

- [ ] **Step 4: Register OperatorsResource in _client.py**

In `packages/python/src/kweaver/_client.py`:
- Add import: `from kweaver.resources.operators import OperatorsResource`
- Add attribute after line 109: `self.operators = OperatorsResource(self._http)`

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd /home/yabosui/kweaver-sdk && python -m pytest packages/python/tests/unit/test_operators.py -v`
Expected: All 12 tests PASS

- [ ] **Step 6: Commit**

```bash
git add packages/python/src/kweaver/resources/operators.py \
        packages/python/tests/unit/test_operators.py \
        packages/python/src/kweaver/_client.py
git commit -m "feat(python): add OperatorsResource with 12 API methods and unit tests"
```

---

### Task 2: ToolBoxesResource — Implementation & Tests

**Files:**
- Create: `packages/python/src/kweaver/resources/toolboxes.py`
- Create: `packages/python/tests/unit/test_toolboxes.py`

**Methods to implement (22):**

| Method | HTTP | Endpoint | TS Source |
|--------|------|----------|-----------|
| `list()` | GET | `/tool-box/list` | listToolBoxes |
| `get()` | GET | `/tool-box/{id}` | getToolBox |
| `create()` | POST | `/tool-box` | createToolBox |
| `update()` | PUT | `/tool-box/{id}` | updateToolBox |
| `delete()` | DELETE | `/tool-box/{id}` | deleteToolBox |
| `update_status()` | PUT | `/tool-box/{id}/status` | updateToolBoxStatus |
| `list_tools()` | GET | `/tool-box/{id}/tools` | listTools |
| `get_tool()` | GET | `/tool-box/{boxId}/tools/{toolId}` | getTool |
| `create_tool()` | POST | `/tool-box/{id}/tools` | createTool |
| `update_tool()` | PUT | `/tool-box/{boxId}/tools/{toolId}` | updateTool |
| `update_tool_status()` | PUT | `/tool-box/{id}/tools/status` | updateToolStatus |
| `delete_tool()` | DELETE | `/tool-box/{boxId}/tools/{toolId}` | deleteTool |
| `batch_delete_tools()` | POST | `/tool-box/{id}/tools/batch-delete` | batchDeleteTools |
| `convert_operator_to_tool()` | POST | `/tool-box/tools/convert` | convertOperatorToTool |
| `list_market()` | GET | `/tool-box/market` | listToolBoxMarket |
| `get_market()` | GET | `/tool-box/market/{id}` | getToolBoxMarket |
| `list_categories()` | GET | `/tool-box/categories` | listToolBoxCategories |
| `create_internal()` | POST | `/tool-box/internal` | createInternalToolBox |
| `tool_proxy()` | POST | `/tool-box/{boxId}/tools/{toolId}/proxy` | toolProxy |
| `debug_tool()` | POST | `/tool-box/{boxId}/tools/{toolId}/debug` | debugTool |
| `execute_function()` | POST | `/function/execute` | executeFunction |
| `ai_generate_function()` | POST | `/function/ai-generate` | aiGenerateFunction |
| `list_prompt_templates()` | GET | `/function/prompt-templates` | listPromptTemplates |
| `install_dependencies()` | POST | `/function/dependencies/install` | installDependencies |
| `get_dependency_versions()` | GET | `/function/dependencies/{name}/versions` | getDependencyVersions |

- [ ] **Step 1: Write failing tests for ToolBoxesResource**

```python
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
    assert "/tool-box" in capture.last_url() and "/tool-box/" not in capture.last_url().replace("/tool-box", "", 1)


def test_update_toolbox(capture: RequestCapture):
    def handler(req):
        return httpx.Response(200, json={"box_id": "box-1"})
    client = make_client(handler, capture)
    result = client.toolboxes.update("box-1", body={"box_name": "Updated", "box_desc": "desc", "box_svc_url": "url", "box_category": "cat"})
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
    result = client.toolboxes.convert_operator_to_tool({"box_id": "box-1", "operator_id": "op-1", "operator_version": "v1"})
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
    result = client.toolboxes.install_dependencies({"dependencies": [{"name": "requests", "version": "2.28.0"}]})
    assert capture.requests[-1].method == "POST"
    assert "/dependencies/install" in capture.last_url()


def test_get_dependency_versions(capture: RequestCapture):
    def handler(req):
        return httpx.Response(200, json={"package_name": "requests", "versions": ["2.28.0"]})
    client = make_client(handler, capture)
    result = client.toolboxes.get_dependency_versions("requests")
    assert "/dependencies/requests/versions" in capture.last_url()
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /home/yabosui/kweaver-sdk && python -m pytest packages/python/tests/unit/test_toolboxes.py -v 2>&1 | head -20`
Expected: FAIL — missing `toolboxes` attribute

- [ ] **Step 3: Implement ToolBoxesResource**

```python
"""SDK resource: toolboxes & tools (execution-factory service)."""
from __future__ import annotations

from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:
    from kweaver._http import HttpClient

_API_PREFIX = "/api/agent-operator-integration/v1"


class ToolBoxesResource:
    """ToolBox and Tool management via agent-operator-integration API."""

    def __init__(self, http: HttpClient) -> None:
        self._http = http

    def list(
        self,
        *,
        page: int = 1,
        page_size: int = 10,
        box_id: str | None = None,
        box_name: str | None = None,
        status: str = "published",
        category_type: str | None = None,
        source: str | None = None,
        create_user: str | None = None,
    ) -> dict[str, Any]:
        params: dict[str, Any] = {"page": page, "page_size": page_size, "status": status}
        if box_id:
            params["box_id"] = box_id
        if box_name:
            params["box_name"] = box_name
        if category_type:
            params["category_type"] = category_type
        if source:
            params["source"] = source
        if create_user:
            params["create_user"] = create_user
        return self._http.get(f"{_API_PREFIX}/tool-box/list", params=params)

    def get(self, box_id: str) -> dict[str, Any]:
        return self._http.get(f"{_API_PREFIX}/tool-box/{box_id}")

    def create(self, body: dict[str, Any]) -> dict[str, Any]:
        return self._http.post(f"{_API_PREFIX}/tool-box", json=body)

    def update(self, box_id: str, *, body: dict[str, Any]) -> dict[str, Any]:
        return self._http.put(f"{_API_PREFIX}/tool-box/{box_id}", json=body)

    def delete(self, box_id: str) -> dict[str, Any]:
        return self._http.delete(f"{_API_PREFIX}/tool-box/{box_id}")

    def update_status(self, box_id: str, *, body: dict[str, Any]) -> dict[str, Any]:
        return self._http.put(f"{_API_PREFIX}/tool-box/{box_id}/status", json=body)

    def list_tools(
        self,
        box_id: str,
        *,
        page: int = 1,
        page_size: int = 10,
        tool_id: str | None = None,
        name: str | None = None,
        status: str | None = None,
        metadata_type: str | None = None,
    ) -> dict[str, Any]:
        params: dict[str, Any] = {"page": page, "page_size": page_size}
        if tool_id:
            params["tool_id"] = tool_id
        if name:
            params["name"] = name
        if status:
            params["status"] = status
        if metadata_type:
            params["metadata_type"] = metadata_type
        return self._http.get(f"{_API_PREFIX}/tool-box/{box_id}/tools", params=params)

    def get_tool(self, box_id: str, tool_id: str) -> dict[str, Any]:
        return self._http.get(f"{_API_PREFIX}/tool-box/{box_id}/tools/{tool_id}")

    def create_tool(self, box_id: str, *, body: dict[str, Any]) -> dict[str, Any]:
        return self._http.post(f"{_API_PREFIX}/tool-box/{box_id}/tools", json=body)

    def update_tool(self, box_id: str, tool_id: str, *, body: dict[str, Any]) -> dict[str, Any]:
        return self._http.put(f"{_API_PREFIX}/tool-box/{box_id}/tools/{tool_id}", json=body)

    def update_tool_status(self, box_id: str, *, body: dict[str, Any]) -> dict[str, Any]:
        return self._http.put(f"{_API_PREFIX}/tool-box/{box_id}/tools/status", json=body)

    def delete_tool(self, box_id: str, tool_id: str) -> dict[str, Any]:
        return self._http.delete(f"{_API_PREFIX}/tool-box/{box_id}/tools/{tool_id}")

    def batch_delete_tools(self, box_id: str, *, body: dict[str, Any]) -> dict[str, Any]:
        return self._http.post(f"{_API_PREFIX}/tool-box/{box_id}/tools/batch-delete", json=body)

    def convert_operator_to_tool(self, body: dict[str, Any]) -> dict[str, Any]:
        return self._http.post(f"{_API_PREFIX}/tool-box/tools/convert", json=body)

    def list_market(
        self,
        *,
        page: int = 1,
        page_size: int = 10,
        box_id: str | None = None,
        box_name: str | None = None,
        category_type: str | None = None,
        source: str | None = None,
    ) -> dict[str, Any]:
        params: dict[str, Any] = {"page": page, "page_size": page_size}
        if box_id:
            params["box_id"] = box_id
        if box_name:
            params["box_name"] = box_name
        if category_type:
            params["category_type"] = category_type
        if source:
            params["source"] = source
        return self._http.get(f"{_API_PREFIX}/tool-box/market", params=params)

    def get_market(self, box_id: str) -> dict[str, Any]:
        return self._http.get(f"{_API_PREFIX}/tool-box/market/{box_id}")

    def list_categories(self) -> list[dict[str, Any]]:
        return self._http.get(f"{_API_PREFIX}/tool-box/categories")

    def create_internal(self, body: dict[str, Any]) -> dict[str, Any]:
        return self._http.post(f"{_API_PREFIX}/tool-box/internal", json=body)

    def tool_proxy(self, box_id: str, tool_id: str, *, body: dict[str, Any]) -> dict[str, Any]:
        return self._http.post(f"{_API_PREFIX}/tool-box/{box_id}/tools/{tool_id}/proxy", json=body)

    def debug_tool(self, box_id: str, tool_id: str, *, body: dict[str, Any]) -> dict[str, Any]:
        return self._http.post(f"{_API_PREFIX}/tool-box/{box_id}/tools/{tool_id}/debug", json=body)

    def execute_function(self, body: dict[str, Any]) -> dict[str, Any]:
        return self._http.post(f"{_API_PREFIX}/function/execute", json=body)

    def ai_generate_function(self, body: dict[str, Any]) -> dict[str, Any]:
        return self._http.post(f"{_API_PREFIX}/function/ai-generate", json=body)

    def list_prompt_templates(self) -> list[dict[str, Any]]:
        return self._http.get(f"{_API_PREFIX}/function/prompt-templates")

    def install_dependencies(self, body: dict[str, Any]) -> dict[str, Any]:
        return self._http.post(f"{_API_PREFIX}/function/dependencies/install", json=body)

    def get_dependency_versions(self, package_name: str) -> dict[str, Any]:
        return self._http.get(f"{_API_PREFIX}/function/dependencies/{package_name}/versions")
```

- [ ] **Step 4: Register ToolBoxesResource in _client.py**

Add import: `from kweaver.resources.toolboxes import ToolBoxesResource`
Add attribute: `self.toolboxes = ToolBoxesResource(self._http)`

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd /home/yabosui/kweaver-sdk && python -m pytest packages/python/tests/unit/test_toolboxes.py -v`
Expected: All 25 tests PASS

- [ ] **Step 6: Commit**

```bash
git add packages/python/src/kweaver/resources/toolboxes.py \
        packages/python/tests/unit/test_toolboxes.py \
        packages/python/src/kweaver/_client.py
git commit -m "feat(python): add ToolBoxesResource with 25 API methods and unit tests"
```

---

### Task 3: MCPServersResource — Implementation & Tests

**Files:**
- Create: `packages/python/src/kweaver/resources/mcp_servers.py`
- Create: `packages/python/tests/unit/test_mcp_servers.py`

**Methods to implement (14):**

| Method | HTTP | Endpoint | TS Source |
|--------|------|----------|-----------|
| `list()` | GET | `/mcp/list` | listMCPServers |
| `get()` | GET | `/mcp/{id}` | getMCPServer |
| `register()` | POST | `/mcp` | registerMCPServer |
| `update()` | PUT | `/mcp/{id}` | updateMCPServer |
| `delete()` | DELETE | `/mcp/{id}` | deleteMCPServer |
| `update_status()` | PUT | `/mcp/{id}/status` | updateMCPServerStatus |
| `parse_sse()` | POST | `/mcp/parse/sse` | parseMCPSSERequest |
| `debug_tool()` | POST | `/mcp/{id}/tools/{name}/debug` | debugMCPTool |
| `list_market()` | GET | `/mcp/market/list` | listMCPMarket |
| `get_market()` | GET | `/mcp/market/{id}` | getMCPMarket |
| `list_categories()` | GET | `/mcp/categories` | listMCPCategories |
| `proxy_call_tool()` | POST | `/mcp/{id}/proxy/call-tool` | mcpProxyCallTool |
| `proxy_list_tools()` | GET | `/mcp/{id}/proxy/list-tools` | mcpProxyListTools |

- [ ] **Step 1: Write failing tests for MCPServersResource**

```python
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
    assert "/mcp" in capture.last_url() and "/mcp/" not in capture.last_url().replace("/mcp", "", 1)


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
```

- [ ] **Step 2: Run tests to verify they fail**

Expected: FAIL — missing `mcp_servers` attribute

- [ ] **Step 3: Implement MCPServersResource**

```python
"""SDK resource: MCP servers (execution-factory service)."""
from __future__ import annotations

from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:
    from kweaver._http import HttpClient

_API_PREFIX = "/api/agent-operator-integration/v1"


class MCPServersResource:
    """MCP server management via agent-operator-integration API."""

    def __init__(self, http: HttpClient) -> None:
        self._http = http

    def list(
        self,
        *,
        page: int = 1,
        page_size: int = 10,
        mcp_id: str | None = None,
        name: str | None = None,
        status: str = "published",
        creation_type: str | None = None,
        mode: str | None = None,
        source: str | None = None,
        create_user: str | None = None,
    ) -> dict[str, Any]:
        params: dict[str, Any] = {"page": page, "page_size": page_size, "status": status}
        if mcp_id:
            params["mcp_id"] = mcp_id
        if name:
            params["name"] = name
        if creation_type:
            params["creation_type"] = creation_type
        if mode:
            params["mode"] = mode
        if source:
            params["source"] = source
        if create_user:
            params["create_user"] = create_user
        return self._http.get(f"{_API_PREFIX}/mcp/list", params=params)

    def get(self, mcp_id: str) -> dict[str, Any]:
        return self._http.get(f"{_API_PREFIX}/mcp/{mcp_id}")

    def register(self, body: dict[str, Any]) -> dict[str, Any]:
        return self._http.post(f"{_API_PREFIX}/mcp", json=body)

    def update(self, mcp_id: str, *, body: dict[str, Any]) -> dict[str, Any]:
        return self._http.put(f"{_API_PREFIX}/mcp/{mcp_id}", json=body)

    def delete(self, mcp_id: str) -> dict[str, Any]:
        return self._http.delete(f"{_API_PREFIX}/mcp/{mcp_id}")

    def update_status(self, mcp_id: str, *, status: str) -> dict[str, Any]:
        return self._http.put(f"{_API_PREFIX}/mcp/{mcp_id}/status", json={"status": status})

    def parse_sse(self, body: dict[str, Any]) -> dict[str, Any]:
        return self._http.post(f"{_API_PREFIX}/mcp/parse/sse", json=body)

    def debug_tool(self, mcp_id: str, tool_name: str, *, body: dict[str, Any]) -> dict[str, Any]:
        return self._http.post(f"{_API_PREFIX}/mcp/{mcp_id}/tools/{tool_name}/debug", json=body)

    def list_market(
        self,
        *,
        page: int = 1,
        page_size: int = 10,
        mcp_id: str | None = None,
        name: str | None = None,
        source: str | None = None,
        category: str | None = None,
    ) -> dict[str, Any]:
        params: dict[str, Any] = {"page": page, "page_size": page_size}
        if mcp_id:
            params["mcp_id"] = mcp_id
        if name:
            params["name"] = name
        if source:
            params["source"] = source
        if category:
            params["category"] = category
        return self._http.get(f"{_API_PREFIX}/mcp/market/list", params=params)

    def get_market(self, mcp_id: str) -> dict[str, Any]:
        return self._http.get(f"{_API_PREFIX}/mcp/market/{mcp_id}")

    def list_categories(self) -> list[dict[str, Any]]:
        return self._http.get(f"{_API_PREFIX}/mcp/categories")

    def proxy_call_tool(self, mcp_id: str, *, body: dict[str, Any]) -> dict[str, Any]:
        return self._http.post(f"{_API_PREFIX}/mcp/{mcp_id}/proxy/call-tool", json=body)

    def proxy_list_tools(self, mcp_id: str) -> dict[str, Any]:
        return self._http.get(f"{_API_PREFIX}/mcp/{mcp_id}/proxy/list-tools")
```

- [ ] **Step 4: Register MCPServersResource in _client.py**

Add import: `from kweaver.resources.mcp_servers import MCPServersResource`
Add attribute: `self.mcp_servers = MCPServersResource(self._http)`

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd /home/yabosui/kweaver-sdk && python -m pytest packages/python/tests/unit/test_mcp_servers.py -v`
Expected: All 13 tests PASS

- [ ] **Step 6: Commit**

```bash
git add packages/python/src/kweaver/resources/mcp_servers.py \
        packages/python/tests/unit/test_mcp_servers.py \
        packages/python/src/kweaver/_client.py
git commit -m "feat(python): add MCPServersResource with 14 API methods and unit tests"
```

---

### Task 4: ImpexResource — Implementation & Tests

**Files:**
- Create: `packages/python/src/kweaver/resources/impex.py`
- Create: `packages/python/tests/unit/test_impex.py`

**Methods to implement (2):**

| Method | HTTP | Endpoint | TS Source |
|--------|------|----------|-----------|
| `export_data()` | GET | `/impex/export/{type}/{id}` | exportData |
| `import_data()` | POST | `/impex/import/{type}` | importData |

- [ ] **Step 1: Write failing tests for ImpexResource**

```python
"""Tests for ImpexResource."""
import httpx
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
```

- [ ] **Step 2: Run tests to verify they fail**

Expected: FAIL — missing `impex` attribute

- [ ] **Step 3: Implement ImpexResource**

```python
"""SDK resource: import/export (execution-factory service)."""
from __future__ import annotations

from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:
    from kweaver._http import HttpClient

_API_PREFIX = "/api/agent-operator-integration/v1"


class ImpexResource:
    """Import/Export for execution factory resources."""

    def __init__(self, http: HttpClient) -> None:
        self._http = http

    def export_data(self, *, type: str, id: str) -> dict[str, Any]:
        return self._http.get(f"{_API_PREFIX}/impex/export/{type}/{id}")

    def import_data(self, *, type: str, body: dict[str, Any]) -> dict[str, Any]:
        return self._http.post(f"{_API_PREFIX}/impex/import/{type}", json=body)
```

- [ ] **Step 4: Register ImpexResource in _client.py**

Add import: `from kweaver.resources.impex import ImpexResource`
Add attribute: `self.impex = ImpexResource(self._http)`

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd /home/yabosui/kweaver-sdk && python -m pytest packages/python/tests/unit/test_impex.py -v`
Expected: All 2 tests PASS

- [ ] **Step 6: Commit**

```bash
git add packages/python/src/kweaver/resources/impex.py \
        packages/python/tests/unit/test_impex.py \
        packages/python/src/kweaver/_client.py
git commit -m "feat(python): add ImpexResource with export/import API methods and unit tests"
```

---

### Task 5: Full Suite Verification

- [ ] **Step 1: Run full test suite**

Run: `cd /home/yabosui/kweaver-sdk && python -m pytest packages/python/tests/unit/test_operators.py packages/python/tests/unit/test_toolboxes.py packages/python/tests/unit/test_mcp_servers.py packages/python/tests/unit/test_impex.py -v`
Expected: All ~52 tests PASS

- [ ] **Step 2: Run existing tests to check for regressions**

Run: `cd /home/yabosui/kweaver-sdk && python -m pytest packages/python/tests/unit/ -v --ignore=packages/python/tests/unit/test_vega.py`
Expected: All existing tests still PASS (no regressions)

- [ ] **Step 3: Final commit (if needed)**

```bash
git add -A
git commit -m "chore(python): verify execution factory SDK — all 52 tests passing"
```
