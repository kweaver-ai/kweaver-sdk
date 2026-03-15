"""SDK resource: context-loader (MCP JSON-RPC 2.0 client).

Implements the same protocol as the TypeScript kweaverc context-loader,
providing Layer 1 (search), Layer 2 (query instances), and Layer 3
(logic properties, action info) operations against the KWeaver MCP server.
"""

from __future__ import annotations

import json
import logging
from typing import TYPE_CHECKING, Any

import httpx

if TYPE_CHECKING:
    from kweaver._http import HttpClient

logger = logging.getLogger("kweaver.context_loader")

MCP_PROTOCOL_VERSION = "2024-11-05"
MCP_PATH = "/api/agent-retrieval/v1/mcp"

_session_cache: dict[str, str] = {}
_request_id: int = 0


def _next_id() -> int:
    global _request_id
    _request_id += 1
    return _request_id


def _build_mcp_url(base_url: str) -> str:
    return base_url.rstrip("/") + MCP_PATH


class ContextLoaderResource:
    """MCP context-loader client over HTTP (JSON-RPC 2.0).

    Equivalent to TypeScript src/api/context-loader.ts.
    """

    def __init__(self, base_url: str, access_token: str, kn_id: str) -> None:
        self._base_url = base_url.rstrip("/")
        self._mcp_url = _build_mcp_url(base_url)
        self._access_token = access_token
        self._kn_id = kn_id
        self._cache_key = f"{self._mcp_url}:{kn_id}"

    def _build_headers(self, session_id: str | None = None) -> dict[str, str]:
        headers: dict[str, str] = {
            "Content-Type": "application/json",
            "Accept": "application/json, text/event-stream",
            "Authorization": f"Bearer {self._access_token}",
            "X-Kn-ID": self._kn_id,
            "MCP-Protocol-Version": MCP_PROTOCOL_VERSION,
        }
        if session_id:
            headers["MCP-Session-Id"] = session_id
        return headers

    def _ensure_session(self) -> str:
        cached = _session_cache.get(self._cache_key)
        if cached:
            return cached

        init_body = json.dumps({
            "jsonrpc": "2.0",
            "id": _next_id(),
            "method": "initialize",
            "params": {
                "protocolVersion": MCP_PROTOCOL_VERSION,
                "capabilities": {},
                "clientInfo": {"name": "kweaver-sdk", "version": "0.1.0"},
            },
        })

        with httpx.Client() as client:
            resp = client.post(
                self._mcp_url,
                content=init_body,
                headers=self._build_headers(),
                timeout=30.0,
            )
            if resp.status_code >= 400:
                raise RuntimeError(f"MCP initialize failed with HTTP {resp.status_code}")

        session_id = (
            resp.headers.get("MCP-Session-Id")
            or resp.headers.get("mcp-session-id")
        )
        if not session_id:
            raise RuntimeError(
                "MCP server did not return MCP-Session-Id. "
                "The server may require session initialization."
            )

        notif_body = json.dumps({
            "jsonrpc": "2.0",
            "method": "notifications/initialized",
        })
        with httpx.Client() as client:
            client.post(
                self._mcp_url,
                content=notif_body,
                headers=self._build_headers(session_id),
                timeout=10.0,
            )

        _session_cache[self._cache_key] = session_id
        return session_id

    def _call_method(self, method: str, params: dict[str, Any] | None = None) -> Any:
        session_id = self._ensure_session()
        body: dict[str, Any] = {
            "jsonrpc": "2.0",
            "method": method,
            "id": _next_id(),
        }
        if params:
            body["params"] = params

        with httpx.Client() as client:
            resp = client.post(
                self._mcp_url,
                content=json.dumps(body),
                headers=self._build_headers(session_id),
                timeout=60.0,
            )
            if resp.status_code >= 400:
                raise RuntimeError(f"MCP {method} failed with HTTP {resp.status_code}")

        parsed = resp.json()
        if error := parsed.get("error"):
            raise RuntimeError(f"Context-loader error: {error.get('message', error)}")

        if "result" in parsed:
            return parsed["result"]

        raise RuntimeError(f"Context-loader returned no result for method {method}")

    def _call_tool(self, tool_name: str, args: dict[str, Any]) -> Any:
        session_id = self._ensure_session()
        body = {
            "jsonrpc": "2.0",
            "method": "tools/call",
            "params": {"name": tool_name, "arguments": args},
            "id": _next_id(),
        }

        with httpx.Client() as client:
            resp = client.post(
                self._mcp_url,
                content=json.dumps(body),
                headers=self._build_headers(session_id),
                timeout=60.0,
            )
            if resp.status_code >= 400:
                raise RuntimeError(f"MCP tools/call '{tool_name}' failed with HTTP {resp.status_code}")

        parsed = resp.json()

        if _is_missing_input_params(parsed):
            raise RuntimeError(_format_missing_input_params(parsed))

        if error := parsed.get("error"):
            data = error.get("data")
            if _is_missing_input_params(data):
                raise RuntimeError(_format_missing_input_params(data))
            raise RuntimeError(f"Context-loader error: {error.get('message', error)}")

        if "result" in parsed:
            result = parsed["result"]
            content = result.get("content") if isinstance(result, dict) else None
            if isinstance(content, list) and content:
                first = content[0]
                text = first.get("text") if isinstance(first, dict) else None
                if isinstance(text, str):
                    try:
                        return json.loads(text)
                    except json.JSONDecodeError:
                        return {"raw": text}
            return result

        if any(k in parsed for k in ("object_types", "concepts", "datas", "entries", "_dynamic_tools")):
            return parsed

        raise RuntimeError(f"Context-loader returned no result for tool {tool_name}")

    # ── Layer 1 ─────────────────────────────────────────────────────────────

    def kn_search(self, query: str, *, only_schema: bool = False) -> dict[str, Any]:
        """Search schema — returns object_types, relation_types, action_types."""
        return self._call_tool("kn_search", {"query": query, "only_schema": only_schema})

    def kn_schema_search(self, query: str, *, max_concepts: int = 10) -> dict[str, Any]:
        """Candidate discovery — returns concepts (schema only)."""
        return self._call_tool("kn_schema_search", {"query": query, "max_concepts": max_concepts})

    # ── Layer 2 ─────────────────────────────────────────────────────────────

    def query_object_instance(
        self, ot_id: str, condition: dict[str, Any], *, limit: int = 20
    ) -> dict[str, Any]:
        """Query object instances — returns datas with _instance_identity."""
        return self._call_tool("query_object_instance", {
            "ot_id": ot_id,
            "condition": condition,
            "limit": limit,
        })

    def query_instance_subgraph(
        self, relation_type_paths: list[dict[str, Any]]
    ) -> dict[str, Any]:
        """Query instance subgraph — returns entries with nested _instance_identity."""
        return self._call_tool("query_instance_subgraph", {
            "relation_type_paths": relation_type_paths,
        })

    # ── Layer 3 ─────────────────────────────────────────────────────────────

    def get_logic_properties_values(
        self,
        ot_id: str,
        query: str,
        instance_identities: list[dict[str, Any]],
        properties: list[str],
        additional_context: str | None = None,
    ) -> dict[str, Any]:
        """Get logic property values. Raises on MISSING_INPUT_PARAMS."""
        args: dict[str, Any] = {
            "ot_id": ot_id,
            "query": query,
            "_instance_identities": instance_identities,
            "properties": properties,
        }
        if additional_context is not None:
            args["additional_context"] = additional_context
        return self._call_tool("get_logic_properties_values", args)

    def get_action_info(
        self, at_id: str, instance_identity: dict[str, Any]
    ) -> dict[str, Any]:
        """Get action info — returns _dynamic_tools."""
        return self._call_tool("get_action_info", {
            "at_id": at_id,
            "_instance_identity": instance_identity,
        })

    # ── MCP introspection ────────────────────────────────────────────────────

    def list_tools(self, cursor: str | None = None) -> dict[str, Any]:
        params = {"cursor": cursor} if cursor else {}
        return self._call_method("tools/list", params or None)

    def list_resources(self, cursor: str | None = None) -> dict[str, Any]:
        params = {"cursor": cursor} if cursor else {}
        return self._call_method("resources/list", params or None)

    def read_resource(self, uri: str) -> dict[str, Any]:
        return self._call_method("resources/read", {"uri": uri})

    def list_resource_templates(self, cursor: str | None = None) -> dict[str, Any]:
        params = {"cursor": cursor} if cursor else {}
        return self._call_method("resources/templates/list", params or None)

    def list_prompts(self, cursor: str | None = None) -> dict[str, Any]:
        params = {"cursor": cursor} if cursor else {}
        return self._call_method("prompts/list", params or None)

    def get_prompt(self, name: str, args: dict[str, Any] | None = None) -> dict[str, Any]:
        params: dict[str, Any] = {"name": name}
        if args:
            params["arguments"] = args
        return self._call_method("prompts/get", params)

    @classmethod
    def clear_session_cache(cls) -> None:
        """Clear the session cache (useful for testing)."""
        _session_cache.clear()


def _is_missing_input_params(obj: Any) -> bool:
    return (
        isinstance(obj, dict)
        and obj.get("error_code") == "MISSING_INPUT_PARAMS"
    )


def _format_missing_input_params(err: dict[str, Any]) -> str:
    lines = [
        f"MISSING_INPUT_PARAMS: {err.get('message', '')}",
        "Add the following to additional_context and retry:",
    ]
    for m in err.get("missing", []):
        for p in m.get("params", []):
            hint = p.get("hint")
            if hint:
                lines.append(f"  - {p['name']}: {hint}")
    return "\n".join(lines)
