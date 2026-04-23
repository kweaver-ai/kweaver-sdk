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
        page_size: int = 30,
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
        page_size: int = 30,
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
