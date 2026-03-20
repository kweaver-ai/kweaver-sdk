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
"""

from __future__ import annotations

from typing import TYPE_CHECKING, Any

from kweaver.types import Agent

if TYPE_CHECKING:
    from kweaver._http import HttpClient


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
                "output": {},
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

    def publish(self, id: str, *, business_domain_id: str | None = None) -> dict[str, Any]:
        """Publish an agent, making it available for chat.

        Returns:
            Dict with ``release_id``, ``version``, ``published_at``, etc.
        """
        body: dict[str, Any] = {"agent_id": id}
        if business_domain_id is not None:
            body["business_domain_id"] = business_domain_id
        data = self._http.post(f"/api/agent-factory/v3/agent/{id}/publish", json=body)
        return data or {}

    # ── Unpublish ────────────────────────────────────────────────────────

    def unpublish(self, id: str) -> None:
        """Unpublish an agent (remove from published list)."""
        self._http.put(f"/api/agent-factory/v3/agent/{id}/unpublish")


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
