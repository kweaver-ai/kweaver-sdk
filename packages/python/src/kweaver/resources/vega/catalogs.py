"""VegaCatalogsResource — catalog CRUD + discover/health operations."""
from __future__ import annotations
from typing import Any, TYPE_CHECKING
from kweaver.types import Column, Table, VegaCatalog, VegaResource

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

    # ── Scan & table listing ──────────────────────────────────────────────

    def scan_metadata(self, id: str) -> dict:
        """Trigger a metadata scan (discover) for a vega catalog, wait for it.

        ``id`` is a vega catalog id (e.g. ``d7nicrcjto2s73d9g67g``).
        Returns the discover endpoint's response as a dict.
        """
        return self.discover(id, wait=True)

    def list_tables(
        self,
        id: str,
        *,
        keyword: str | None = None,
        limit: int | None = None,
        offset: int | None = None,
        auto_scan: bool = True,
    ) -> list[Table]:
        """List tables with columns from a vega catalog.

        Two-stage fetch:
          1. ``GET /catalogs/{id}/resources?category=table`` — list summaries
          2. For each resource: ``GET /resources/{rid}`` — pull
             ``source_metadata.columns``

        If no table resources exist and ``auto_scan=True``, triggers a
        discover and retries once. ``keyword`` filters summaries client-side
        before the per-resource detail fetches, narrowing N+1 to k+1.
        """
        def _list_summaries_raw() -> list[dict[str, Any]]:
            params: dict[str, Any] = {"category": "table"}
            if limit is not None:
                params["limit"] = limit
            if offset is not None:
                params["offset"] = offset
            data = self._http.get(f"{self._BASE}/{id}/resources", params=params)
            return (
                data
                if isinstance(data, list)
                else (data.get("entries") or data.get("data") or [])
            )

        summaries = _list_summaries_raw()
        if not summaries and auto_scan:
            self.scan_metadata(id)
            summaries = _list_summaries_raw()

        if keyword:
            k = keyword.lower()
            summaries = [it for it in summaries if k in str(it.get("name", "")).lower()]

        tables: list[Table] = []
        for s in summaries:
            rid = s.get("id", "")
            if not rid:
                continue
            try:
                detail_raw = self._http.get(f"/api/vega-backend/v1/resources/{rid}")
            except Exception as exc:
                raise RuntimeError(
                    f"vega resource {rid} fetch failed: {exc}"
                ) from exc

            detail = detail_raw
            if isinstance(detail_raw, dict):
                entries = detail_raw.get("entries") or detail_raw.get("data")
                if isinstance(entries, list) and entries:
                    detail = entries[0]
            if not isinstance(detail, dict):
                continue
            columns_raw = (detail.get("source_metadata") or {}).get("columns") or []
            tables.append(
                Table(
                    name=detail.get("name", s.get("name", "")),
                    columns=[
                        Column(
                            name=c.get("name", c.get("field_name", "")),
                            type=c.get("type", c.get("field_type", "varchar")),
                            comment=c.get("description") or c.get("comment"),
                        )
                        for c in columns_raw
                    ],
                )
            )
        return tables
