"""SDK resource: object types (ontology-manager)."""

from __future__ import annotations

import logging
from typing import TYPE_CHECKING, Any

from kweaver._errors import KWeaverError
from kweaver.types import DataProperty, ObjectType, ObjectTypeStatus, Property

logger = logging.getLogger(__name__)

if TYPE_CHECKING:
    from kweaver._http import HttpClient

_PREFIX = "/api/ontology-manager/v1"


class ObjectTypesResource:
    def __init__(self, http: HttpClient) -> None:
        self._http = http

    def create(
        self,
        kn_id: str,
        *,
        name: str,
        dataview_id: str,
        primary_keys: list[str] | None = None,
        primary_key: str | None = None,
        display_key: str,
        properties: list[Property] | None = None,
    ) -> ObjectType:
        if primary_keys is None:
            if primary_key is not None:
                primary_keys = [primary_key]
            else:
                raise ValueError("Either 'primary_keys' or 'primary_key' must be provided")

        entry: dict[str, Any] = {
            "name": name,
            "data_source": {"type": "data_view", "id": dataview_id},
            "primary_keys": primary_keys,
            "display_key": display_key,
        }
        if properties is not None:
            entry["data_properties"] = [_property_to_rest(p) for p in properties]
        # If no explicit properties, auto-generate from primary/display keys
        # The OT service validates PKs exist in data_properties with a valid type
        if not entry.get("data_properties"):
            auto_props = set(primary_keys)
            auto_props.add(display_key)
            entry["data_properties"] = [
                {"name": n, "display_name": n, "type": "string"} for n in auto_props
            ]

        try:
            data = self._http.post(
                f"{_PREFIX}/knowledge-networks/{kn_id}/object-types",
                json={"entries": [entry], "branch": "main"},
            )
            items = data if isinstance(data, list) else data.get("entries", data.get("data", [data]))
            return _parse_object_type(items[0], kn_id)
        except KWeaverError as exc:
            if "Existed" in (exc.error_code or "") or "已存在" in (exc.message or ""):
                existing = self.list(kn_id)
                logger.debug(
                    "OT name=%r already exists, found %d OTs: %s",
                    name, len(existing), [ot.name for ot in existing],
                )
                for ot in existing:
                    if ot.name == name:
                        return ot
            raise

    def list(self, kn_id: str, *, branch: str = "main") -> list[ObjectType]:
        data = self._http.get(
            f"{_PREFIX}/knowledge-networks/{kn_id}/object-types",
            params={"limit": -1, "branch": branch},
        )
        items = data if isinstance(data, list) else (data.get("entries") or data.get("data") or [])
        return [_parse_object_type(d, kn_id) for d in items]

    def get(self, kn_id: str, ot_id: str) -> ObjectType:
        data = self._http.get(
            f"{_PREFIX}/knowledge-networks/{kn_id}/object-types/{ot_id}"
        )
        # API may wrap single result in {"entries": [...]}
        if isinstance(data, dict) and "entries" in data:
            entries = data["entries"]
            if isinstance(entries, list) and entries:
                data = entries[0]
        return _parse_object_type(data, kn_id)

    def update(self, kn_id: str, ot_id: str, **kwargs: Any) -> ObjectType:
        data = self._http.put(
            f"{_PREFIX}/knowledge-networks/{kn_id}/object-types/{ot_id}",
            json=kwargs,
        )
        return _parse_object_type(data, kn_id)

    def delete(self, kn_id: str, ot_ids: str | list[str]) -> None:
        if isinstance(ot_ids, list):
            ot_ids = ",".join(ot_ids)
        self._http.delete(
            f"{_PREFIX}/knowledge-networks/{kn_id}/object-types/{ot_ids}"
        )


def _property_to_rest(p: Property) -> dict[str, Any]:
    d: dict[str, Any] = {
        "name": p.name,
        "display_name": p.display_name or p.name,
    }
    if p.type:
        d["type"] = p.type
    d["index_config"] = {
        "keyword_config": {"enabled": p.indexed},
        "fulltext_config": {"enabled": p.fulltext},
        "vector_config": {"enabled": p.vector},
    }
    return d


def _parse_object_type(d: dict[str, Any], kn_id: str) -> ObjectType:
    ds = d.get("data_source", {})
    dataview_id = ds.get("id", "") if isinstance(ds, dict) else ""

    props: list[DataProperty] = []
    for p in d.get("data_properties", d.get("properties", [])):
        ic = p.get("index_config", {})
        props.append(
            DataProperty(
                name=p["name"],
                display_name=p.get("display_name"),
                type=p.get("type", "varchar"),
                comment=p.get("comment"),
                indexed=ic.get("keyword_config", {}).get("enabled", False),
                fulltext=ic.get("fulltext_config", {}).get("enabled", False),
                vector=ic.get("vector_config", {}).get("enabled", False),
            )
        )

    status_data = d.get("status")
    status = ObjectTypeStatus(**status_data) if isinstance(status_data, dict) else None

    return ObjectType(
        id=str(d.get("id", "")),
        name=d.get("name", ""),
        kn_id=kn_id,
        dataview_id=dataview_id,
        primary_keys=d.get("primary_keys", []),
        display_key=d.get("display_key", ""),
        incremental_key=d.get("incremental_key"),
        properties=props,
        status=status,
    )
