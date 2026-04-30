"""SDK resource: BKN metrics (bkn-backend)."""

from __future__ import annotations

import json
from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:
    from kweaver._http import HttpClient

_BASE = "/api/bkn-backend/v1/knowledge-networks"


def _metrics_path_segment(metric_ids: str) -> str:
    """Normalize one or comma-separated metric ids for ``/metrics/{segment}`` paths."""
    parts = [p.strip() for p in metric_ids.split(",") if p.strip()]
    if not parts:
        raise ValueError("metric_ids must contain at least one id")
    return ",".join(parts)


class BknMetricsResource:
    """CRUD and search for BKN metric definitions on bkn-backend."""

    def __init__(self, http: HttpClient) -> None:
        self._http = http

    def list(
        self,
        kn_id: str,
        *,
        offset: int | None = None,
        limit: int = 30,
        branch: str | None = None,
        name_pattern: str | None = None,
        sort: str | None = None,
        direction: str | None = None,
        tag: str | None = None,
        group_id: str | None = None,
    ) -> Any:
        """GET /metrics with optional filters. Default ``limit`` is 30 (AGENTS.md)."""
        params: dict[str, Any] = {"limit": limit}
        if offset is not None:
            params["offset"] = offset
        if branch is not None:
            params["branch"] = branch
        if name_pattern is not None:
            params["name_pattern"] = name_pattern
        if sort is not None:
            params["sort"] = sort
        if direction is not None:
            params["direction"] = direction
        if tag is not None:
            params["tag"] = tag
        if group_id is not None:
            params["group_id"] = group_id
        return self._http.get(f"{_BASE}/{kn_id}/metrics", params=params)

    def create(
        self,
        kn_id: str,
        body: dict[str, Any] | str,
        *,
        branch: str | None = None,
        strict_mode: bool | None = None,
    ) -> Any:
        """POST /metrics with ``X-HTTP-Method-Override: POST`` (batch create)."""
        payload = json.loads(body) if isinstance(body, str) else body
        params: dict[str, Any] = {}
        if branch is not None:
            params["branch"] = branch
        if strict_mode is not None:
            params["strict_mode"] = strict_mode
        headers = {"X-HTTP-Method-Override": "POST"}
        return self._http.post(
            f"{_BASE}/{kn_id}/metrics",
            json=payload,
            params=params if params else None,
            headers=headers,
        )

    def search(
        self,
        kn_id: str,
        body: dict[str, Any] | str,
        *,
        branch: str | None = None,
        strict_mode: bool | None = None,
    ) -> Any:
        """POST /metrics with ``X-HTTP-Method-Override: GET`` (concept search)."""
        payload = json.loads(body) if isinstance(body, str) else body
        params: dict[str, Any] = {}
        if branch is not None:
            params["branch"] = branch
        if strict_mode is not None:
            params["strict_mode"] = strict_mode
        headers = {"X-HTTP-Method-Override": "GET"}
        return self._http.post(
            f"{_BASE}/{kn_id}/metrics",
            json=payload,
            params=params if params else None,
            headers=headers,
        )

    def validate(
        self,
        kn_id: str,
        body: dict[str, Any] | str,
        *,
        branch: str | None = None,
        strict_mode: bool | None = None,
        import_mode: str | None = None,
    ) -> Any:
        """POST /metrics/validation."""
        payload = json.loads(body) if isinstance(body, str) else body
        params: dict[str, Any] = {}
        if branch is not None:
            params["branch"] = branch
        if strict_mode is not None:
            params["strict_mode"] = strict_mode
        if import_mode is not None:
            params["import_mode"] = import_mode
        return self._http.post(
            f"{_BASE}/{kn_id}/metrics/validation",
            json=payload,
            params=params if params else None,
        )

    def get(self, kn_id: str, metric_id: str, *, branch: str | None = None) -> Any:
        """GET ``/metrics/{metric_id}``. Pass comma-separated ids for batch read (same path segment)."""
        segment = _metrics_path_segment(metric_id)
        params = {"branch": branch} if branch is not None else None
        return self._http.get(f"{_BASE}/{kn_id}/metrics/{segment}", params=params)

    def update(
        self,
        kn_id: str,
        metric_id: str,
        body: dict[str, Any] | str,
        *,
        branch: str | None = None,
        strict_mode: bool | None = None,
    ) -> Any:
        payload = json.loads(body) if isinstance(body, str) else body
        params: dict[str, Any] = {}
        if branch is not None:
            params["branch"] = branch
        if strict_mode is not None:
            params["strict_mode"] = strict_mode
        return self._http.request(
            "PUT",
            f"{_BASE}/{kn_id}/metrics/{metric_id}",
            json=payload,
            params=params if params else None,
        )

    def delete(self, kn_id: str, metric_id: str, *, branch: str | None = None) -> Any:
        """DELETE ``/metrics/{metric_id}``. Pass comma-separated ids for batch delete."""
        segment = _metrics_path_segment(metric_id)
        params: dict[str, Any] = {}
        if branch is not None:
            params["branch"] = branch
        return self._http.request(
            "DELETE",
            f"{_BASE}/{kn_id}/metrics/{segment}",
            params=params if params else None,
        )
