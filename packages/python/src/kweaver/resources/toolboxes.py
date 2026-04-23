"""SDK resource: toolboxes and tools (agent-operator-integration).

Mirrors ``packages/typescript/src/api/toolboxes.ts``. The execute/debug
endpoints expect an *envelope* JSON body — flat payloads cause the forwarder
to drop downstream Authorization headers and the underlying tool answers with
401 "token expired".
"""

from __future__ import annotations

from pathlib import Path
from typing import TYPE_CHECKING, Any, Iterable, Literal

if TYPE_CHECKING:
    from kweaver._http import HttpClient


_PREFIX = "/api/agent-operator-integration/v1/tool-box"

ToolStatus = Literal["enabled", "disabled"]
ToolboxStatus = Literal["draft", "published"]


def _unwrap_data(payload: Any) -> Any:
    if isinstance(payload, dict) and "data" in payload:
        return payload["data"]
    return payload


def _build_envelope(
    *,
    body: Any,
    header: dict[str, Any] | None,
    query: dict[str, Any] | None,
    timeout: float | None,
) -> dict[str, Any]:
    envelope: dict[str, Any] = {}
    if timeout is not None:
        envelope["timeout"] = timeout
    envelope["header"] = header or {}
    envelope["query"] = query or {}
    envelope["body"] = body if body is not None else {}
    return envelope


class ToolboxesResource:
    """Toolbox + tool management on the agent-operator-integration service."""

    def __init__(self, http: HttpClient) -> None:
        self._http = http

    # ── toolbox lifecycle ────────────────────────────────────────────────────

    def list(self, *, keyword: str | None = None, limit: int = 30, offset: int = 0) -> Any:
        """List toolboxes. Returns the parsed backend payload as-is."""
        params: dict[str, Any] = {"limit": limit, "offset": offset}
        if keyword:
            params["keyword"] = keyword
        return _unwrap_data(self._http.get(f"{_PREFIX}/list", params=params))

    def create(self, body: dict[str, Any]) -> Any:
        return _unwrap_data(self._http.post(_PREFIX, json=body))

    def delete(self, box_id: str) -> None:
        self._http.delete(f"{_PREFIX}/{box_id}")

    def set_status(self, box_id: str, status: ToolboxStatus) -> None:
        self._http.post(f"{_PREFIX}/{box_id}/status", json={"status": status})

    # ── tool lifecycle ───────────────────────────────────────────────────────

    def list_tools(self, box_id: str) -> Any:
        return _unwrap_data(self._http.get(f"{_PREFIX}/{box_id}/tools/list"))

    def upload_tool(
        self,
        box_id: str,
        spec_path: str | Path,
        *,
        metadata_type: str = "openapi",
    ) -> Any:
        """Upload an OpenAPI spec file as a tool (multipart form)."""
        path = Path(spec_path)
        data = path.read_bytes()
        # The backend expects the field name "file"; mime is not enforced.
        files = {"file": (path.name, data, "application/octet-stream")}
        status, content = self._http.post_multipart(
            f"{_PREFIX}/{box_id}/tool",
            files=files,
            params={"metadata_type": metadata_type},
        )
        if status >= 400:
            from kweaver._errors import raise_for_status_parts

            raise_for_status_parts(status, content)
        try:
            import json as _json

            return _unwrap_data(_json.loads(content) if content else None)
        except Exception:
            return content.decode("utf-8", errors="replace") if content else None

    def set_tool_statuses(
        self,
        box_id: str,
        updates: Iterable[tuple[str, ToolStatus]] | list[dict[str, str]],
    ) -> None:
        """Batch enable/disable tools.

        ``updates`` accepts either ``[(tool_id, "enabled"), ...]`` or the raw
        ``[{"tool_id": ..., "status": ...}, ...]`` shape.
        """
        normalised: list[dict[str, str]] = []
        for item in updates:
            if isinstance(item, dict):
                normalised.append({"tool_id": item["tool_id"], "status": item["status"]})
            else:
                tool_id, status = item
                normalised.append({"tool_id": tool_id, "status": status})
        self._http.post(f"{_PREFIX}/{box_id}/tools/status", json={"updates": normalised})

    # ── execute / debug ──────────────────────────────────────────────────────

    def execute(
        self,
        box_id: str,
        tool_id: str,
        *,
        body: Any = None,
        header: dict[str, Any] | None = None,
        query: dict[str, Any] | None = None,
        timeout: float | None = None,
        forward_auth: bool = True,
    ) -> Any:
        """Invoke a published+enabled tool through the toolbox proxy.

        ``forward_auth`` (default True) auto-injects the active client's
        Authorization header into the envelope when the caller did not set
        one — most published tools declare an Authorization parameter and
        otherwise reach the downstream service with no token.
        """
        return self._invoke(
            f"{_PREFIX}/{box_id}/proxy/{tool_id}",
            body=body,
            header=header,
            query=query,
            timeout=timeout,
            forward_auth=forward_auth,
        )

    def debug(
        self,
        box_id: str,
        tool_id: str,
        *,
        body: Any = None,
        header: dict[str, Any] | None = None,
        query: dict[str, Any] | None = None,
        timeout: float | None = None,
        forward_auth: bool = True,
    ) -> Any:
        """Invoke a tool through the debug endpoint (works on draft/disabled tools)."""
        return self._invoke(
            f"{_PREFIX}/{box_id}/tool/{tool_id}/debug",
            body=body,
            header=header,
            query=query,
            timeout=timeout,
            forward_auth=forward_auth,
        )

    # ── internals ────────────────────────────────────────────────────────────

    def _invoke(
        self,
        path: str,
        *,
        body: Any,
        header: dict[str, Any] | None,
        query: dict[str, Any] | None,
        timeout: float | None,
        forward_auth: bool,
    ) -> Any:
        merged_header = dict(header or {})
        if forward_auth and not any(k.lower() == "authorization" for k in merged_header):
            auth_headers = self._http._auth.auth_headers()
            bearer = auth_headers.get("Authorization") or auth_headers.get("authorization")
            if bearer:
                merged_header["Authorization"] = bearer
        envelope = _build_envelope(body=body, header=merged_header, query=query, timeout=timeout)
        return _unwrap_data(self._http.post(path, json=envelope, timeout=timeout))
