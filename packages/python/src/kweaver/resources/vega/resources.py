"""VegaResourcesResource — data resource CRUD + query/preview operations."""
from __future__ import annotations
from typing import Any, TYPE_CHECKING
from kweaver.types import VegaResource, VegaQueryResult

if TYPE_CHECKING:
    from kweaver._http import HttpClient


class VegaResourcesResource:
    _BASE = "/api/vega-backend/v1/resources"

    def __init__(self, http: HttpClient) -> None:
        self._http = http

    def list(
        self,
        *,
        catalog_id: str | None = None,
        category: str | None = None,
        status: str | None = None,
        limit: int = 20,
        offset: int = 0,
    ) -> list[VegaResource]:
        params: dict[str, Any] = {"limit": limit, "offset": offset}
        if catalog_id is not None:
            params["catalog_id"] = catalog_id
        if category is not None:
            params["category"] = category
        if status is not None:
            params["status"] = status
        data = self._http.get(self._BASE, params=params)
        entries = data.get("entries", data.get("data", [])) if isinstance(data, dict) else data
        return [VegaResource(**e) for e in entries]

    def get(self, id: str) -> VegaResource:
        data = self._http.get(f"{self._BASE}/{id}")
        if isinstance(data, dict) and "entries" in data:
            data = data["entries"][0] if data["entries"] else data
        return VegaResource(**data)

    def data(self, id: str, *, body: dict) -> VegaQueryResult:
        result = self._http.post(f"{self._BASE}/{id}/data", json=body)
        return VegaQueryResult(**result) if isinstance(result, dict) else VegaQueryResult()

    def build(self, id: str, *, mode: str = "full") -> dict[str, Any]:
        """Trigger an index build on a catalog resource.

        mode: ``full`` | ``incremental`` | ``realtime``.
        Returns the raw response payload (typically contains a ``task_id``).
        """
        result = self._http.post(f"{self._BASE}/{id}/build", json={"mode": mode})
        return result if isinstance(result, dict) else {}

    def build_status(self, id: str, task_id: str) -> dict[str, Any]:
        """Fetch the status of a previously triggered build task."""
        result = self._http.get(f"{self._BASE}/dataset/{id}/build/{task_id}")
        return result if isinstance(result, dict) else {}

