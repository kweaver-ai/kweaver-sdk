"""SDK resource: relation types (ontology-manager)."""

from __future__ import annotations

from typing import TYPE_CHECKING, Any

from kweaver._errors import KWeaverError
from kweaver.types import RelationType

if TYPE_CHECKING:
    from kweaver._http import HttpClient

_PREFIX = "/api/ontology-manager/v1"


class RelationTypesResource:
    def __init__(self, http: HttpClient) -> None:
        self._http = http

    def create(
        self,
        kn_id: str,
        *,
        name: str,
        source_ot_id: str,
        target_ot_id: str,
        mappings: list[tuple[str, str]] | None = None,
        mapping_view_id: str | None = None,
        source_mappings: list[tuple[str, str]] | None = None,
        target_mappings: list[tuple[str, str]] | None = None,
    ) -> RelationType:
        entry: dict[str, Any] = {
            "name": name,
            "branch": "main",
            "source_object_type_id": source_ot_id,
            "target_object_type_id": target_ot_id,
        }

        if mapping_view_id is not None:
            entry["type"] = "data_view"
            entry["mapping_rules"] = {
                "backing_data_source": {
                    "type": "data_view",
                    "id": mapping_view_id,
                },
                "source_mapping_rules": [
                    {
                        "source_property": {"name": s},
                        "target_property": {"name": t},
                    }
                    for s, t in (source_mappings or [])
                ],
                "target_mapping_rules": [
                    {
                        "source_property": {"name": s},
                        "target_property": {"name": t},
                    }
                    for s, t in (target_mappings or [])
                ],
            }
        else:
            entry["type"] = "direct"
            entry["mapping_rules"] = [
                {
                    "source_property": {"name": s},
                    "target_property": {"name": t},
                }
                for s, t in (mappings or [])
            ]

        try:
            data = self._http.post(
                f"{_PREFIX}/knowledge-networks/{kn_id}/relation-types",
                json={"entries": [entry]},
            )
            items = data if isinstance(data, list) else data.get("entries", data.get("data", [data]))
            return _parse_relation_type(items[0], kn_id)
        except KWeaverError as exc:
            if "Existed" in (exc.error_code or ""):
                existing = self.list(kn_id, keyword=name)
                for rt in existing:
                    if rt.name == name:
                        return rt
            raise

    def list(self, kn_id: str, *, branch: str = "main", keyword: str | None = None) -> list[RelationType]:
        params: dict[str, Any] = {"limit": -1, "branch": branch}
        if keyword:
            params["keyword"] = keyword
        data = self._http.get(
            f"{_PREFIX}/knowledge-networks/{kn_id}/relation-types",
            params=params,
        )
        items = data if isinstance(data, list) else (data.get("entries") or data.get("data") or [])
        return [_parse_relation_type(d, kn_id) for d in items]

    def get(self, kn_id: str, rt_id: str) -> RelationType:
        data = self._http.get(
            f"{_PREFIX}/knowledge-networks/{kn_id}/relation-types/{rt_id}"
        )
        # API may wrap single result in {"entries": [...]}
        if isinstance(data, dict) and "entries" in data:
            entries = data["entries"]
            if isinstance(entries, list) and entries:
                data = entries[0]
        return _parse_relation_type(data, kn_id)

    def update(self, kn_id: str, rt_id: str, **kwargs: Any) -> RelationType:
        data = self._http.put(
            f"{_PREFIX}/knowledge-networks/{kn_id}/relation-types/{rt_id}",
            json=kwargs,
        )
        return _parse_relation_type(data, kn_id)

    def delete(self, kn_id: str, rt_ids: str | list[str]) -> None:
        if isinstance(rt_ids, list):
            rt_ids = ",".join(rt_ids)
        self._http.delete(
            f"{_PREFIX}/knowledge-networks/{kn_id}/relation-types/{rt_ids}"
        )


def _parse_relation_type(d: dict[str, Any], kn_id: str) -> RelationType:
    return RelationType(
        id=str(d.get("id", "")),
        name=d.get("name", ""),
        kn_id=kn_id,
        source_ot_id=d.get("source_object_type_id", d.get("source_ot_id", "")),
        target_ot_id=d.get("target_object_type_id", d.get("target_ot_id", "")),
        mapping_type=d.get("type", d.get("mapping_type", "direct")),
    )
