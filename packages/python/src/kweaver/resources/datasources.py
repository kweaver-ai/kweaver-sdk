"""SDK resource: data sources (data-connection service)."""

from __future__ import annotations

import json
from typing import TYPE_CHECKING, Any

from kweaver._crypto import encrypt_password
from kweaver._errors import KWeaverError
from kweaver.types import Column, DataSource, Table

if TYPE_CHECKING:
    from kweaver._http import HttpClient

_HTTPS_PROTOCOLS = {"maxcompute", "anyshare7", "opensearch"}


def _connect_protocol(ds_type: str) -> str:
    return "https" if ds_type in _HTTPS_PROTOCOLS else "jdbc"


def _make_bin_data(
    type: str,
    host: str,
    port: int,
    database: str,
    account: str,
    password: str,
    schema: str | None = None,
) -> dict[str, Any]:
    d: dict[str, Any] = {
        "host": host,
        "port": port,
        "database_name": database,
        "connect_protocol": _connect_protocol(type),
        "account": account,
        "password": encrypt_password(password),
    }
    if schema is not None:
        d["schema"] = schema
    return d


class DataSourcesResource:
    def __init__(self, http: HttpClient) -> None:
        self._http = http

    def test(
        self,
        type: str,
        host: str,
        port: int,
        database: str,
        account: str,
        password: str,
        schema: str | None = None,
    ) -> bool:
        self._http.post(
            "/api/data-connection/v1/datasource/test",
            json={
                "type": type,
                "bin_data": _make_bin_data(type, host, port, database, account, password, schema),
            },
        )
        return True

    def create(
        self,
        name: str,
        type: str,
        host: str,
        port: int,
        database: str,
        account: str,
        password: str,
        schema: str | None = None,
        comment: str | None = None,
    ) -> DataSource:
        body: dict[str, Any] = {
            "name": name,
            "type": type,
            "bin_data": _make_bin_data(type, host, port, database, account, password, schema),
        }
        if comment:
            body["comment"] = comment
        try:
            data = self._http.post("/api/data-connection/v1/datasource", json=body)
            return _parse_datasource(data)
        except KWeaverError as exc:
            if "已存在" in (exc.message or ""):
                existing = self.list(keyword=name)
                for ds in existing:
                    if ds.name == name:
                        return ds
            raise

    def list(self, *, keyword: str | None = None, type: str | None = None) -> list[DataSource]:
        params: dict[str, Any] = {}
        if keyword:
            params["keyword"] = keyword
        if type:
            params["type"] = type
        data = self._http.get("/api/data-connection/v1/datasource", params=params or None)
        items = data if isinstance(data, list) else (data.get("entries") or data.get("data") or [])
        return [_parse_datasource(d) for d in items]

    def get(self, id: str) -> DataSource:
        data = self._http.get(f"/api/data-connection/v1/datasource/{id}")
        return _parse_datasource(data)

    def delete(self, id: str) -> None:
        self._http.delete(f"/api/data-connection/v1/datasource/{id}")

    def scan_metadata(self, id: str, *, ds_type: str = "mysql") -> str:
        """Trigger a metadata scan for a vega catalog and wait for completion.

        ``id`` is a vega catalog id (e.g. ``d7nicrcjto2s73d9g67g``), not a
        legacy data-connection datasource UUID. ``ds_type`` is retained for
        signature compatibility but ignored — vega catalogs carry their own
        ``connector_type``.

        Returns the discover endpoint's response body as a JSON string.
        """
        del ds_type  # retained for backward compat, intentionally unused
        result = self._http.post(
            f"/api/vega-backend/v1/catalogs/{id}/discover",
            params={"wait": "true"},
        )
        if isinstance(result, str):
            return result
        return json.dumps(result)

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
          1. ``GET /api/vega-backend/v1/catalogs/{id}/resources?category=table``
          2. For each resource: ``GET /api/vega-backend/v1/resources/{rid}``,
             extracting ``source_metadata.columns``.

        If the catalog has no table resources and ``auto_scan=True``, triggers
        a discover and retries the list once. The optional ``keyword`` filters
        summaries client-side before the per-resource detail fetches, narrowing
        N+1 to k+1.

        ``id`` is a vega catalog id, not a legacy data-connection datasource UUID.
        """

        def _list_summaries_raw() -> list[dict[str, Any]]:
            params: dict[str, Any] = {"category": "table"}
            if limit is not None:
                params["limit"] = limit
            if offset is not None:
                params["offset"] = offset
            data = self._http.get(
                f"/api/vega-backend/v1/catalogs/{id}/resources",
                params=params,
            )
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


def _parse_datasource(d: Any) -> DataSource:
    if isinstance(d, list):
        d = d[0]
    return DataSource(
        id=str(d.get("id", d.get("ds_id", ""))),
        name=d.get("name", ""),
        type=d.get("type", ""),
        comment=d.get("comment"),
    )
