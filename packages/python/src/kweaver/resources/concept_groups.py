"""SDK resource: concept groups (ontology-manager)."""
from __future__ import annotations

from typing import TYPE_CHECKING, Any

from kweaver.types import ConceptGroup

if TYPE_CHECKING:
    from kweaver._http import HttpClient

_BASE = "/api/ontology-manager/v1/knowledge-networks"


def _parse_cg(data: dict[str, Any]) -> ConceptGroup:
    return ConceptGroup(
        id=data.get("id", ""),
        name=data.get("name", ""),
        kn_id=data.get("kn_id", ""),
        branch=data.get("branch", "main"),
        object_type_ids=data.get("object_type_ids") or [],
        creator=data.get("creator"),
        updater=data.get("updater"),
        create_time=data.get("create_time"),
        update_time=data.get("update_time"),
    )


class ConceptGroupsResource:
    def __init__(self, http: HttpClient) -> None:
        self._http = http

    def create(self, kn_id: str, *, name: str) -> ConceptGroup:
        data = self._http.post(f"{_BASE}/{kn_id}/concept-groups", json={"name": name, "branch": "main"})
        return _parse_cg(data)

    def list(self, kn_id: str, *, offset: int = 0, limit: int = 20) -> list[ConceptGroup]:
        data = self._http.get(
            f"{_BASE}/{kn_id}/concept-groups",
            params={"offset": offset, "limit": limit},
        )
        entries = data.get("entries", data.get("data", [])) if isinstance(data, dict) else data
        return [_parse_cg(e) for e in entries]

    def get(self, kn_id: str, cg_id: str) -> ConceptGroup:
        data = self._http.get(f"{_BASE}/{kn_id}/concept-groups/{cg_id}")
        return _parse_cg(data)

    def update(self, kn_id: str, cg_id: str, *, name: str | None = None) -> ConceptGroup:
        body: dict[str, Any] = {}
        if name is not None:
            body["name"] = name
        data = self._http.put(f"{_BASE}/{kn_id}/concept-groups/{cg_id}", json=body)
        return _parse_cg(data)

    def delete(self, kn_id: str, cg_ids: list[str]) -> None:
        ids_str = ",".join(cg_ids)
        self._http.delete(f"{_BASE}/{kn_id}/concept-groups/{ids_str}")

    def add_members(self, kn_id: str, cg_id: str, *, object_type_ids: list[str]) -> None:
        self._http.post(
            f"{_BASE}/{kn_id}/concept-groups/{cg_id}/object-types",
            json={"object_type_ids": object_type_ids},
        )

    def remove_members(self, kn_id: str, cg_id: str, *, object_type_ids: list[str]) -> None:
        ids_str = ",".join(object_type_ids)
        self._http.delete(f"{_BASE}/{kn_id}/concept-groups/{cg_id}/object-types/{ids_str}")
