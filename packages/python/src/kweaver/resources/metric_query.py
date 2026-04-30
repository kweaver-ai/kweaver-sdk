"""SDK resource: BKN metric data and dry-run (ontology-query)."""

from __future__ import annotations

import json
from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:
    from kweaver._http import HttpClient

_OQ = "/api/ontology-query/v1/knowledge-networks"


class MetricQueryResource:
    """Query published metric data and dry-run (试算) without persisting definitions."""

    def __init__(self, http: HttpClient) -> None:
        self._http = http

    def data(
        self,
        kn_id: str,
        metric_id: str,
        body: dict[str, Any] | str,
        *,
        branch: str | None = None,
        fill_null: bool = False,
    ) -> Any:
        """POST ``/metrics/{metric_id}/data`` (no method override)."""
        payload = json.loads(body) if isinstance(body, str) else body
        params: dict[str, Any] = {}
        if branch is not None:
            params["branch"] = branch
        if fill_null:
            params["fill_null"] = "true"
        return self._http.post(
            f"{_OQ}/{kn_id}/metrics/{metric_id}/data",
            json=payload,
            params=params if params else None,
            timeout=120.0,
        )

    def dry_run(
        self,
        kn_id: str,
        body: dict[str, Any] | str,
        *,
        branch: str | None = None,
        fill_null: bool = False,
    ) -> Any:
        """POST ``/metrics/dry-run`` (no method override)."""
        payload = json.loads(body) if isinstance(body, str) else body
        params: dict[str, Any] = {}
        if branch is not None:
            params["branch"] = branch
        if fill_null:
            params["fill_null"] = "true"
        return self._http.post(
            f"{_OQ}/{kn_id}/metrics/dry-run",
            json=payload,
            params=params if params else None,
            timeout=120.0,
        )
