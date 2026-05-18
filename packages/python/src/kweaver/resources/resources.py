"""SDK resource: vega-backend Resources (table/logicview)."""

from __future__ import annotations

import logging
import time
from typing import TYPE_CHECKING, Any
from urllib.parse import quote

logger = logging.getLogger(__name__)

from kweaver.types import Resource, ViewField

_DEFAULT_LIST_LIMIT = 30

if TYPE_CHECKING:
    from kweaver._http import HttpClient


class ResourcesResource:
    """Vega-backend resource management: table/logicview resources under a catalog."""

    def __init__(self, http: HttpClient) -> None:
        self._http = http

    def find_by_table(
        self,
        datasource_id: str,
        table_name: str,
        *,
        wait: bool = True,
        timeout: float = 30,
    ) -> Resource | None:
        """Find the resource for a specific table in a catalog (datasource)."""
        deadline = time.monotonic() + timeout
        attempt = 0
        while True:
            data = self._http.get(
                "/api/vega-backend/v1/resources",
                params={"catalog_id": datasource_id, "name": table_name},
            )
            items = data if isinstance(data, list) else (data.get("entries") or data.get("data") or [])
            logger.debug(
                "find_by_table attempt=%d ds=%s table=%r found=%d",
                attempt + 1, datasource_id, table_name, len(items),
            )
            for d in items:
                if d.get("name") == table_name:
                    return _parse_resource(d)
            if not wait or time.monotonic() >= deadline:
                return None
            delay = min(5.0, 1.0 * 2 ** attempt)
            time.sleep(delay)
            attempt += 1

    def create(
        self,
        name: str,
        datasource_id: str,
        *,
        table: str | None = None,
        category: str = "table",
        fields: list[dict[str, Any]] | None = None,
    ) -> Resource:
        """Create a vega-backend resource.

        For table-based resources (*table* is provided), posts category=table.
        For logic views, set *category='logicview'* and omit *table*.
        """
        body: dict[str, Any] = {
            "name": name,
            "catalog_id": datasource_id,
            "category": category,
        }
        if table:
            body["source_identifier"] = table
        if fields:
            body["schema_definition"] = fields
        data = self._http.post("/api/vega-backend/v1/resources", json=body)
        created_id = str(data.get("id", "")) if isinstance(data, dict) else ""
        if not created_id:
            raise ValueError(f"No id in create response: {data}")
        return self.get(created_id)

    def list(
        self,
        *,
        datasource_id: str | None = None,
        name: str | None = None,
        category: str | None = None,
        limit: int = _DEFAULT_LIST_LIMIT,
    ) -> list[Resource]:
        params: dict[str, Any] = {"limit": limit}
        if datasource_id:
            params["catalog_id"] = datasource_id
        if name:
            params["name"] = name
        if category:
            params["category"] = category
        data = self._http.get("/api/vega-backend/v1/resources", params=params)
        items = data if isinstance(data, list) else (data.get("entries") or data.get("data") or [])
        return [_parse_resource(d) for d in items]

    def get(self, id: str) -> Resource:
        data = self._http.get(f"/api/vega-backend/v1/resources/{quote(str(id), safe='')}")
        items = data if isinstance(data, list) else (data.get("entries") or [])
        raw = items[0] if items else (data if isinstance(data, dict) and "id" in data else None)
        if not raw:
            raise ValueError(f"Resource not found: {id}")
        return _parse_resource(raw)

    def delete(self, id: str) -> None:
        self._http.delete(f"/api/vega-backend/v1/resources/{quote(str(id), safe='')}")

    def query(
        self,
        id: str,
        *,
        offset: int = 0,
        limit: int = 50,
        need_total: bool = False,
        filter_condition: Any | None = None,
        sort: str | None = None,
        direction: str | None = None,
    ) -> dict[str, Any]:
        """Query data from a vega-backend resource.

        POST ``/api/vega-backend/v1/resources/{id}/data``.
        """
        body: dict[str, Any] = {
            "offset": offset,
            "limit": limit,
            "need_total": need_total,
        }
        if filter_condition is not None:
            body["filter_condition"] = filter_condition
        if sort is not None:
            body["sort"] = sort
        if direction is not None:
            body["direction"] = direction
        path = f"/api/vega-backend/v1/resources/{quote(str(id), safe='')}/data"
        data = self._http.post(
            path,
            json=body,
            headers={"x-http-method-override": "GET"},
        )
        return data if isinstance(data, dict) else {}


def _parse_resource(d: dict[str, Any]) -> Resource:
    raw_schema = d.get("schema_definition")
    schema: list[ViewField] | None = None
    if raw_schema:
        schema = [
            ViewField(
                name=f["name"],
                type=f.get("type", "varchar"),
                display_name=f.get("display_name"),
                comment=f.get("comment"),
            )
            for f in raw_schema
        ]
    return Resource(
        id=str(d.get("id", "")),
        name=d.get("name", ""),
        catalog_id=str(d.get("catalog_id", "")),
        category=d.get("category", ""),
        source_identifier=d.get("source_identifier"),
        status=d.get("status"),
        schema_definition=schema,
        logic_definition=d.get("logic_definition"),
    )
