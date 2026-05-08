"""SDK resource: data sources (data-connection service).

scan_metadata / list_tables have been moved to
``kweaver.resources.vega.catalogs.VegaCatalogsResource``; the methods here
are thin delegation stubs kept for backward compatibility.
"""

from __future__ import annotations

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

        .. deprecated::
            Use ``client.vega.catalogs.scan_metadata(id)`` directly. This
            method delegates to the vega catalogs resource for backward
            compatibility.

        ``id`` is a vega catalog id. ``ds_type`` is ignored (retained for
        signature compatibility).

        Returns the discover response as a JSON string.
        """
        import json as _json
        del ds_type
        from kweaver.resources.vega.catalogs import VegaCatalogsResource
        vega_cats = VegaCatalogsResource(self._http)
        result = vega_cats.scan_metadata(id)
        return _json.dumps(result) if isinstance(result, dict) else str(result)

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

        .. deprecated::
            Use ``client.vega.catalogs.list_tables(id, ...)`` directly.

        ``id`` is a vega catalog id, not a legacy data-connection datasource
        UUID.
        """
        from kweaver.resources.vega.catalogs import VegaCatalogsResource
        vega_cats = VegaCatalogsResource(self._http)
        return vega_cats.list_tables(
            id,
            keyword=keyword,
            limit=limit,
            offset=offset,
            auto_scan=auto_scan,
        )



def _parse_datasource(d: Any) -> DataSource:
    if isinstance(d, list):
        d = d[0]
    return DataSource(
        id=str(d.get("id", d.get("ds_id", ""))),
        name=d.get("name", ""),
        type=d.get("type", ""),
        comment=d.get("comment"),
    )
