"""SDK resource: data views (mdl-data-model service)."""

from __future__ import annotations

import hashlib
import logging
import time
import uuid
from typing import TYPE_CHECKING, Any
from urllib.parse import quote

logger = logging.getLogger(__name__)

from kweaver._errors import KWeaverError
from kweaver.types import DataView, ViewField

if TYPE_CHECKING:
    from kweaver._http import HttpClient


class DataViewsResource:
    def __init__(self, http: HttpClient) -> None:
        self._http = http

    def find_by_table(
        self,
        datasource_id: str,
        table_name: str,
        *,
        wait: bool = True,
        timeout: float = 30,
    ) -> DataView | None:
        """Find the auto-created atomic view for a table in a datasource.

        Atomic views are created asynchronously by a background monitor
        after a metadata scan.  If *wait* is True, polls until the view
        appears or *timeout* expires.
        """
        deadline = time.monotonic() + timeout
        attempt = 0
        while True:
            data = self._http.get(
                "/api/mdl-data-model/v1/data-views",
                params={"data_source_id": datasource_id, "keyword": table_name, "limit": -1},
            )
            items = data if isinstance(data, list) else (data.get("entries") or data.get("data") or [])
            logger.debug(
                "find_by_table attempt=%d ds=%s table=%r found=%d",
                attempt + 1, datasource_id, table_name, len(items),
            )
            for d in items:
                if d.get("name") == table_name:
                    return _parse_single_dataview(d)
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
        sql: str | None = None,
        fields: list[dict[str, Any]] | None = None,
        columns: list[Any] | None = None,
    ) -> DataView:
        """Create or find a data view.

        For table-based views: returns the auto-created atomic view from
        metadata scan (triggering a scan if needed).
        For SQL views: creates a custom view.
        """
        if table:
            # Try to find existing atomic view first (created by background monitor)
            existing = self.find_by_table(datasource_id, table)
            if existing:
                return existing
            # Atomic view not ready yet — create it directly
            logger.info("No atomic view for table %r, creating directly", table)
            view_id = hashlib.md5(
                f"{datasource_id}:{table}".encode()
            ).hexdigest()[:35]
            # Build fields from columns metadata if available
            view_fields = fields or []
            if not view_fields and columns:
                view_fields = [
                    {"name": c.name if hasattr(c, "name") else c.get("name", ""),
                     "type": c.type if hasattr(c, "type") else c.get("type", "varchar")}
                    for c in columns
                ]
            body = [
                {
                    "id": view_id,
                    "name": name,
                    "technical_name": table,
                    "type": "atomic",
                    "query_type": "SQL",
                    "data_source_id": datasource_id,
                    "group_id": datasource_id,
                    "fields": view_fields,
                }
            ]
            for attempt in range(3):
                try:
                    data = self._http.post("/api/mdl-data-model/v1/data-views", json=body)
                    created_id = _extract_view_id(data) or view_id
                    return self.get(created_id)
                except KWeaverError as exc:
                    if "Existed" not in (exc.error_code or ""):
                        raise
                    if attempt == 2:
                        # Last resort: return whatever exists with this name
                        views = self.list(name=name)
                        if views:
                            return views[0]
                        raise
                    # Retry with a unique name suffix
                    suffix = uuid.uuid4().hex[:6]
                    unique_name = f"{name}_{suffix}"
                    view_id = hashlib.md5(
                        f"{datasource_id}:{unique_name}".encode()
                    ).hexdigest()[:35]
                    body[0]["id"] = view_id
                    body[0]["name"] = unique_name
                    name = unique_name
        if sql:
            # Generate a deterministic view ID (lowercase, max 40 chars)
            view_id = "dv_" + hashlib.md5(
                f"{datasource_id}:{name}".encode()
            ).hexdigest()[:32]
            body = [
                {
                    "id": view_id,
                    "name": name,
                    "type": "custom",
                    "query_type": "SQL",
                    "data_source_id": datasource_id,
                    "data_scope": [
                        {
                            "id": "node_0",
                            "title": name,
                            "type": "sql",
                            "config": {"sql_expression": sql},
                            "input_nodes": [],
                            "output_fields": [],
                        }
                    ],
                    "fields": fields or [],
                }
            ]
            data = self._http.post("/api/mdl-data-model/v1/data-views", json=body)
            created_id = _extract_view_id(data) or view_id
            return self.get(created_id)
        else:
            raise ValueError("Either 'table' or 'sql' must be provided")

    def list(
        self,
        *,
        datasource_id: str | None = None,
        name: str | None = None,
        type: str | None = None,
    ) -> list[DataView]:
        params: dict[str, Any] = {"limit": 30}
        if datasource_id:
            params["data_source_id"] = datasource_id
        if name:
            params["keyword"] = name
        if type:
            params["type"] = type
        data = self._http.get("/api/mdl-data-model/v1/data-views", params=params)
        items = data if isinstance(data, list) else (data.get("entries") or data.get("data") or [])
        return [_parse_single_dataview(d) for d in items]

    def get(self, id: str) -> DataView:
        data = self._http.get(f"/api/mdl-data-model/v1/data-views/{id}")
        if isinstance(data, list):
            data = data[0]
        return _parse_single_dataview(data)

    def delete(self, id: str) -> None:
        self._http.delete(f"/api/mdl-data-model/v1/data-views/{id}")

    def query(
        self,
        id: str,
        *,
        sql: str | None = None,
        offset: int = 0,
        limit: int = 50,
        need_total: bool = False,
        output_fields: list[str] | None = None,
        filters: dict[str, Any] | None = None,
        sort: list[dict[str, Any]] | None = None,
    ) -> dict[str, Any]:
        """Execute a query against a data view (mdl-uniquery).

        POST ``/api/mdl-uniquery/v1/data-views/{id}``. When *sql* is omitted,
        the server uses the view's stored SQL definition.

        Returns the raw JSON object (typically ``columns``, ``entries``,
        ``total_count``).
        """
        body: dict[str, Any] = {
            "offset": offset,
            "limit": limit,
            "need_total": need_total,
        }
        if sql is not None:
            body["sql"] = sql
        if output_fields is not None:
            body["output_fields"] = output_fields
        if filters is not None:
            body["filters"] = filters
        if sort is not None:
            body["sort"] = sort
        path = f"/api/mdl-uniquery/v1/data-views/{quote(str(id), safe='')}"
        data = self._http.post(
            path,
            json=body,
            headers={"x-http-method-override": "GET"},
        )
        return data if isinstance(data, dict) else {}

def _extract_view_id(data: Any) -> str | None:
    """Extract the first view ID from a create response (which may be IDs only)."""
    if isinstance(data, list) and data:
        item = data[0]
        if isinstance(item, str):
            return item
        if isinstance(item, dict):
            return str(item.get("id", ""))
    if isinstance(data, dict):
        return str(data.get("id", ""))
    return None


def _parse_single_dataview(d: dict[str, Any]) -> DataView:
    raw_fields = d.get("fields")
    fields: list[ViewField] | None = None
    if raw_fields:
        fields = [
            ViewField(
                name=f["name"],
                type=f.get("type", "varchar"),
                display_name=f.get("display_name"),
                comment=f.get("comment"),
            )
            for f in raw_fields
        ]
    return DataView(
        id=str(d.get("id", "")),
        name=d.get("name", ""),
        query_type=d.get("query_type", "SQL"),
        datasource_id=str(d.get("data_source_id", "")),
        type=d.get("type"),
        data_source_type=d.get("data_source_type"),
        data_source_name=d.get("data_source_name"),
        sql_str=d.get("sql_str"),
        meta_table_name=d.get("meta_table_name"),
        fields=fields,
    )
