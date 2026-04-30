"""SDK resource: agents (agent-factory service).

Endpoints (agent-factory v3):
  - List published: POST /api/agent-factory/v3/published/agent
  - Get by ID:      GET  /api/agent-factory/v3/agent/{id}
  - Get by key:     GET  /api/agent-factory/v3/agent/by-key/{key}
  - Create:         POST /api/agent-factory/v3/agent
  - Update:         PUT  /api/agent-factory/v3/agent/{id}
  - Delete:         DELETE /api/agent-factory/v3/agent/{id}
  - Publish:        POST /api/agent-factory/v3/agent/{id}/publish
  - Unpublish:      PUT  /api/agent-factory/v3/agent/{id}/unpublish
  - Copy:           POST /api/agent-factory/v3/agent/{id}/copy
  - Copy to draft template: POST .../copy2tpl
  - Bulk export:    POST /api/agent-factory/v3/agent-inout/export
  - Bulk import:    POST /api/agent-factory/v3/agent-inout/import (multipart)
"""

from __future__ import annotations

import json
import re
from pathlib import Path
from typing import TYPE_CHECKING, Any, Literal

from kweaver._errors import EndpointUnavailableError, KWeaverError, raise_for_status_parts
from kweaver.types import Agent, AgentTemplate, AgentCategory

if TYPE_CHECKING:
    from kweaver._http import HttpClient


def _reraise_factory_v3(endpoint: str, exc: BaseException) -> None:
    if isinstance(exc, KWeaverError) and exc.status_code in (404, 405):
        raise EndpointUnavailableError(
            f"Endpoint {endpoint} is not available on this server. "
            "It may require a newer agent-factory version.",
            status_code=exc.status_code,
            endpoint_path=endpoint,
            trace_id=getattr(exc, "trace_id", None),
            error_code=getattr(exc, "error_code", None),
        ) from exc
    raise exc


def _parse_attachment_filename(header: str | None) -> str | None:
    """Parse filename from Content-Disposition (attachment)."""
    if not header:
        return None
    from urllib.parse import unquote

    m = re.search(r"filename\*=(?:UTF-8''|)([^;\s]+)", header, re.I)
    if m:
        raw = m.group(1).strip('"')
        try:
            return unquote(raw)
        except Exception:
            return raw
    m2 = re.search(r'filename="([^"]+)"', header, re.I)
    if m2:
        return m2.group(1)
    m3 = re.search(r"filename=([^;\s]+)", header, re.I)
    if m3:
        return m3.group(1).strip('"')
    return None


class AgentsResource:
    def __init__(self, http: HttpClient) -> None:
        self._http = http

    # ── List (published agents) ──────────────────────────────────────────

    def list(
        self,
        *,
        keyword: str | None = None,
        status: str | None = None,
        offset: int = 0,
        limit: int = 50,
    ) -> list[Agent]:
        """List published agents.

        Args:
            keyword: Filter by name substring.
            status: Ignored (kept for API compatibility). The published
                    endpoint only returns published agents.
            offset: Pagination offset (default 0).
            limit: Max items to return (default 50).
        """
        body: dict[str, Any] = {
            "offset": offset,
            "limit": limit,
            "name": keyword or "",
            "category_id": "",
            "custom_space_id": "",
            "is_to_square": 1,
        }

        # The agent-factory API requires text/plain content-type for this
        # endpoint (application/json returns empty results — platform quirk).
        data = self._http.post(
            "/api/agent-factory/v3/published/agent",
            json=body,
            headers={"content-type": "text/plain;charset=UTF-8"},
        )
        items = (
            data
            if isinstance(data, list)
            else (data.get("entries") or data.get("data") or [])
        )
        return [_parse_agent(d) for d in items]

    # ── List personal space agents ────────────────────────────────────────

    def list_personal(
        self,
        *,
        keyword: str | None = None,
        pagination_marker: str | None = None,
        publish_status: str | None = None,
        publish_to_be: str | None = None,
        size: int = 48,
    ) -> list[Agent]:
        """List personal space agents.

        Args:
            keyword: Filter by name substring.
            pagination_marker: Pagination token.
            publish_status: Filter by publish status.
            publish_to_be: Filter by publish destination.
            size: Number of results (default 48).

        Returns:
            List of Agent objects.
        """
        params: dict[str, Any] = {"size": size}
        if keyword:
            params["name"] = keyword
        if pagination_marker:
            params["pagination_marker_str"] = pagination_marker
        if publish_status:
            params["publish_status"] = publish_status
        if publish_to_be:
            params["publish_to_be"] = publish_to_be

        query_string = "&".join(f"{k}={v}" for k, v in params.items())
        url = f"/api/agent-factory/v3/personal-space/agent-list?{query_string}"

        data = self._http.get(url)
        items = (data if isinstance(data, list) else data.get("entries") or [])
        return [_parse_agent(d) for d in items]

    # ── List published agent templates ─────────────────────────────────────

    def list_templates(
        self,
        *,
        keyword: str | None = None,
        category_id: str | None = None,
        pagination_marker: str | None = None,
        size: int = 48,
    ) -> list[AgentTemplate]:
        """List published agent templates.

        Args:
            keyword: Filter by name substring.
            category_id: Filter by category ID.
            pagination_marker: Pagination token.
            size: Number of results (default 48).

        Returns:
            List of AgentTemplate objects.
        """
        params: dict[str, Any] = {"size": size}
        if keyword:
            params["name"] = keyword
        if category_id:
            params["category_id"] = category_id
        if pagination_marker:
            params["pagination_marker_str"] = pagination_marker

        query_string = "&".join(f"{k}={v}" for k, v in params.items())
        url = f"/api/agent-factory/v3/published/agent-tpl?{query_string}"

        data = self._http.get(url)
        items = (data if isinstance(data, list) else data.get("entries") or [])
        return [_parse_template(d) for d in items]

    def get_template(self, id: str) -> AgentTemplate:
        """Get published agent template by ID.

        Args:
            id: Template ID.

        Returns:
            AgentTemplate object.
        """
        data = self._http.get(f"/api/agent-factory/v3/published/agent-tpl/{id}")
        return _parse_template(data)

    # ── List categories ───────────────────────────────────────────────────

    def list_categories(self) -> list[AgentCategory]:
        """List agent categories.

        Returns:
            List of AgentCategory objects.
        """
        data = self._http.get("/api/agent-factory/v3/category")
        items = (data if isinstance(data, list) else data.get("entries") or [])
        return [
            AgentCategory(
                id=str(c.get("id", "")),
                name=c.get("name", ""),
                description=c.get("description", ""),
            )
            for c in items
        ]

    # ── Get by ID ────────────────────────────────────────────────────────

    def get(self, id: str) -> Agent:
        """Get agent details by ID."""
        data = self._http.get(f"/api/agent-factory/v3/agent/{id}")
        return _parse_agent(data)

    # ── Get by key ───────────────────────────────────────────────────────

    def get_by_key(self, key: str) -> Agent:
        """Get agent details by unique key."""
        data = self._http.get(f"/api/agent-factory/v3/agent/by-key/{key}")
        return _parse_agent(data)

    # ── Create ───────────────────────────────────────────────────────────

    def create(
        self,
        *,
        name: str,
        profile: str,
        config: dict[str, Any] | None = None,
        key: str | None = None,
        product_key: str = "DIP",
        avatar_type: int = 1,
        avatar: str = "icon-dip-agent-default",
    ) -> dict[str, str]:
        """Create a new agent.

        Args:
            name: Agent name (max 50 chars).
            profile: Agent description (max 500 chars).
            config: Full agent configuration dict. If None, a minimal
                    config with a single string input field is used.
            key: Optional unique key (auto-generated if omitted).
            product_key: Product key — "DIP", "AnyShare", or "ChatBI".
            avatar_type: 1=built-in, 2=uploaded, 3=AI-generated.
            avatar: Avatar identifier or URL.

        Returns:
            Dict with ``id`` and ``version`` of the created agent.
        """
        if config is None:
            config = {
                "input": {"fields": [{"name": "user_input", "type": "string", "desc": ""}]},
                "output": {"default_format": "markdown"},
            }

        body: dict[str, Any] = {
            "name": name,
            "profile": profile,
            "avatar_type": avatar_type,
            "avatar": avatar,
            "product_key": product_key,
            "config": config,
        }
        if key is not None:
            body["key"] = key

        data = self._http.post("/api/agent-factory/v3/agent", json=body)
        return {"id": str(data.get("id", "")), "version": str(data.get("version", ""))}

    # ── Update ───────────────────────────────────────────────────────────

    def update(self, id: str, body: dict[str, Any]) -> None:
        """Update an agent.

        Args:
            id: Agent ID.
            body: Full update body containing name, profile, avatar_type,
                  avatar, product_key, and config. Use :meth:`get` to
                  fetch the current state, modify fields, and pass here.
        """
        self._http.put(f"/api/agent-factory/v3/agent/{id}", json=body)

    # ── Delete ───────────────────────────────────────────────────────────

    def delete(self, id: str) -> None:
        """Delete an agent."""
        self._http.delete(f"/api/agent-factory/v3/agent/{id}")

    # ── Publish ──────────────────────────────────────────────────────────

    def publish(self, id: str, *, category_id: str | None = None) -> dict[str, Any]:
        """Publish an agent.

        Args:
            id: Agent ID.
            category_id: Optional category ID for classification.

        Returns:
            Dict with release_id, version, published_at, etc.
        """
        body: dict[str, Any] = {
            "business_domain_id": "bd_public",
            "category_ids": [category_id] if category_id else [],
            "description": "",
            "publish_to_where": ["square"],
            "publish_to_bes": ["skill_agent"],
            "pms_control": None,
        }
        data = self._http.post(f"/api/agent-factory/v3/agent/{id}/publish", json=body)
        return data or {}

    # ── Unpublish ────────────────────────────────────────────────────────

    def unpublish(self, id: str) -> None:
        """Unpublish an agent (remove from published list)."""
        self._http.put(f"/api/agent-factory/v3/agent/{id}/unpublish")

    # ── Copy / bulk export-import (agent-factory v3, not operator impex) ─────

    def copy(self, agent_id: str) -> dict[str, Any]:
        """Duplicate agent in personal space (POST ``…/agent/{id}/copy``)."""
        path = f"/api/agent-factory/v3/agent/{agent_id}/copy"
        try:
            data = self._http.post(path)
        except KWeaverError as exc:
            _reraise_factory_v3(path, exc)
        return data if isinstance(data, dict) else {}

    def copy_to_template(self, agent_id: str) -> dict[str, Any]:
        """Copy agent as draft template (POST ``…/copy2tpl``)."""
        path = f"/api/agent-factory/v3/agent/{agent_id}/copy2tpl"
        try:
            data = self._http.post(path)
        except KWeaverError as exc:
            _reraise_factory_v3(path, exc)
        return data if isinstance(data, dict) else {}

    def export(self, agent_ids: list[str]) -> tuple[str, bytes]:
        """Export agents JSON; returns ``(filename, content_bytes)`` from bulk export endpoint."""
        path = "/api/agent-factory/v3/agent-inout/export"
        status, headers, body = self._http.post_raw(path, json={"agent_ids": agent_ids})
        if status in (404, 405):
            raise EndpointUnavailableError(
                f"Endpoint {path} is not available on this server. "
                "It may require a newer agent-factory version.",
                status_code=status,
                endpoint_path=path,
            )
        if status >= 400:
            raise_for_status_parts(status, body)
        cd = headers.get("content-disposition")
        filename = _parse_attachment_filename(cd) or "agents_export.json"
        return filename, body

    def import_(
        self,
        file_path: str | Path,
        *,
        import_type: Literal["create", "upsert"] = "create",
    ) -> dict[str, Any]:
        """Import agents from an export JSON file (multipart ``file`` + ``import_type``).

        Returns:
            Parsed JSON dict; common keys may include those in :class:`~kweaver.types.AgentImportResult`.
        """
        pth = Path(file_path)
        ep = "/api/agent-factory/v3/agent-inout/import"
        mime = "application/json" if str(pth).lower().endswith(".json") else "application/octet-stream"
        files = {"file": (pth.name, pth.read_bytes(), mime)}
        status, content = self._http.post_multipart(
            ep,
            files=files,
            data={"import_type": import_type},
        )
        if status in (404, 405):
            raise EndpointUnavailableError(
                f"Endpoint {ep} is not available on this server. "
                "It may require a newer agent-factory version.",
                status_code=status,
                endpoint_path=ep,
            )
        if status >= 400:
            raise_for_status_parts(status, content)
        if not content:
            return {}
        try:
            parsed = json.loads(content)
        except Exception:
            return {"raw": content.decode("utf-8", errors="replace")}
        return parsed if isinstance(parsed, dict) else {"result": parsed}

    import_agents = import_


def _parse_template(d: Any) -> AgentTemplate:
    """Parse API response into AgentTemplate."""
    return AgentTemplate(
        id=str(d.get("tpl_id") or d.get("id", "")),
        name=d.get("name", ""),
        description=d.get("profile") or d.get("description", ""),
        config=d.get("config"),
    )


def _parse_agent(d: Any) -> Agent:
    # Extract knowledge network IDs from config.data_source.kg
    kn_ids: list[str] = d.get("kn_ids", [])
    config = d.get("config") or {}
    if not kn_ids:
        ds = config.get("data_source") or {}
        kn_ids = [kg["kg_id"] for kg in (ds.get("kg") or []) if kg.get("kg_id")]
        kn_entry = (ds.get("kn_entry") or ds.get("knowledge_network")) or {}
        if isinstance(kn_entry, list):
            kn_ids.extend(e.get("id", "") for e in kn_entry if e.get("id"))

    # Map agent-factory status to simplified status.
    # The published list endpoint omits the "status" field entirely —
    # if published_at or version exists, treat as published.
    raw_status = d.get("status")
    if raw_status in ("published", "published_edited"):
        status = "published"
    elif raw_status is None and (d.get("published_at") or d.get("version")):
        status = "published"
    else:
        status = "draft"

    return Agent(
        id=str(d.get("id", "")),
        name=d.get("name", ""),
        key=d.get("key"),
        version=d.get("version"),
        description=d.get("profile") or d.get("description"),
        status=status,
        kn_ids=kn_ids,
        system_prompt=config.get("system_prompt") or d.get("system_prompt"),
        capabilities=d.get("capabilities", []),
        model_config_data=config.get("llms") or d.get("model_config"),
        conversation_count=d.get("conversation_count", 0),
    )
