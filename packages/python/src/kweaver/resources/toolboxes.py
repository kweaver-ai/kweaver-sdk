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
        page_size: int = 30,
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
        page_size: int = 30,
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
        page_size: int = 30,
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
