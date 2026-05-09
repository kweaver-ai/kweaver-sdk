"""SDK resource: data sources (data-connection service)."""

from __future__ import annotations

import time
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
    """Data-connection layer: register JDBC/HTTPS-style sources, list tables, probe."""

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
        """Trigger a metadata scan for a datasource and wait for completion.

        Returns the scan task ID.
        """
        ds = self.get(id)
        scan_name = f"sdk_scan_{id[:8]}"
        result = self._http.post(
            "/api/data-connection/v1/metadata/scan",
            json={
                "scan_name": scan_name,
                "type": 0,
                "ds_info": {"ds_id": id, "ds_type": ds_type or ds.type or "mysql"},
                "use_default_template": True,
                "use_multi_threads": True,
                "status": "open",
            },
        )
        task_id = result.get("id", "")
        # Poll until scan completes with exponential backoff
        for attempt in range(30):
            time.sleep(min(2 * (1.5 ** attempt), 15))
            status = self._http.get(f"/api/data-connection/v1/metadata/scan/{task_id}")
            if status.get("status") in ("success", "fail"):
                break
        return task_id

    def list_tables(
        self,
        id: str,
        *,
        keyword: str | None = None,
        limit: int | None = None,
        offset: int | None = None,
        auto_scan: bool = True,
    ) -> list[Table]:
        params: dict[str, Any] = {"limit": -1}
        if keyword:
            params["keyword"] = keyword
        if limit is not None:
            params["limit"] = limit
        if offset is not None:
            params["offset"] = offset
        data = self._http.get(
            f"/api/data-connection/v1/metadata/data-source/{id}",
            params=params,
        )
        items = data if isinstance(data, list) else (data.get("entries") or data.get("data") or [])

        # Auto-trigger metadata scan if no tables found
        if not items and auto_scan:
            self.scan_metadata(id)
            data = self._http.get(
                f"/api/data-connection/v1/metadata/data-source/{id}",
                params=params,
            )
            items = data if isinstance(data, list) else (data.get("entries") or data.get("data") or [])

        tables: list[Table] = []
        for t in items:
            table_id = t.get("id", "")
            table_name = t.get("name", "")
            # Fetch column details if not inline
            columns_raw = t.get("columns", t.get("fields", []))
            if not columns_raw and table_id:
                col_data = self._http.get(
                    f"/api/data-connection/v1/metadata/table/{table_id}",
                    params={"limit": -1},
                )
                columns_raw = (
                    col_data if isinstance(col_data, list)
                    else (col_data.get("entries") or col_data.get("data") or [])
                )
            tables.append(
                Table(
                    name=table_name,
                    columns=[
                        Column(
                            name=c.get("name", c.get("field_name", "")),
                            type=c.get("type", c.get("field_type", "varchar")),
                            comment=c.get("comment"),
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
