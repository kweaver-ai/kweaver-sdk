"""VegaCatalogsResource — catalog CRUD + discover/health operations."""
from __future__ import annotations
from typing import Any, TYPE_CHECKING
from kweaver.types import VegaCatalog, VegaResource

if TYPE_CHECKING:
    from kweaver._http import HttpClient


class VegaCatalogsResource:
    _BASE = "/api/vega-backend/v1/catalogs"

    def __init__(self, http: HttpClient) -> None:
        self._http = http

    def list(
        self,
        *,
        status: str | None = None,
        limit: int = 20,
        offset: int = 0,
    ) -> list[VegaCatalog]:
        params: dict[str, Any] = {"limit": limit, "offset": offset}
        if status is not None:
            params["status"] = status
        data = self._http.get(self._BASE, params=params)
        entries = data.get("entries", data.get("data", [])) if isinstance(data, dict) else data
        return [VegaCatalog(**e) for e in entries]

    def get(self, id: str) -> VegaCatalog:
        data = self._http.get(f"{self._BASE}/{id}")
        if isinstance(data, dict) and "entries" in data:
            data = data["entries"][0] if data["entries"] else data
        return VegaCatalog(**data)

    def health_status(self, ids: list[str]) -> list[VegaCatalog]:
        # ids go in the path segment: GET /catalogs/{ids}/health-status
        ids_path = ",".join(ids)
        data = self._http.get(f"{self._BASE}/{ids_path}/health-status")
        entries = data.get("entries", data.get("data", [])) if isinstance(data, dict) else data
        return [VegaCatalog(**e) for e in entries]

    def test_connection(self, id: str) -> dict:
        result = self._http.post(f"{self._BASE}/{id}/test-connection")
        return result if isinstance(result, dict) else {}

    def discover(self, id: str, *, wait: bool = False) -> dict:
        params: dict[str, Any] = {}
        if wait:
            params["wait"] = "true"
        data = self._http.post(f"{self._BASE}/{id}/discover", params=params if params else None)
        return data if isinstance(data, dict) else {}

    def resources(
        self,
        id: str,
        *,
        category: str | None = None,
        limit: int = 20,
        offset: int = 0,
    ) -> list[VegaResource]:
        params: dict[str, Any] = {"limit": limit, "offset": offset}
        if category is not None:
            params["category"] = category
        data = self._http.get(f"{self._BASE}/{id}/resources", params=params)
        entries = data.get("entries", data.get("data", [])) if isinstance(data, dict) else data
        return [VegaResource(**e) for e in entries]
