"""SDK resource: knowledge networks (ontology-manager + agent-retrieval)."""

from __future__ import annotations

import logging
from typing import TYPE_CHECKING, Any

from kweaver._errors import KWeaverError
from kweaver.types import BuildJob, BuildStatus, KNStatistics, KnowledgeNetwork

logger = logging.getLogger(__name__)

if TYPE_CHECKING:
    from kweaver._http import HttpClient


class KnowledgeNetworksResource:
    def __init__(self, http: HttpClient) -> None:
        self._http = http

    def create(
        self,
        name: str,
        *,
        description: str | None = None,
        tags: list[str] | None = None,
    ) -> KnowledgeNetwork:
        body: dict[str, Any] = {"name": name, "branch": "main"}
        if description:
            body["description"] = description
        if tags:
            body["tags"] = tags
        try:
            data = self._http.post(
                "/api/ontology-manager/v1/knowledge-networks", json=body
            )
            return _parse_kn(data)
        except KWeaverError as exc:
            if "Existed" in (exc.error_code or ""):
                # KN with this name already exists — find and return it
                existing = self.list(name=name)
                for kn in existing:
                    if kn.name == name:
                        return kn
            raise

    def list(
        self,
        *,
        name: str | None = None,
        name_pattern: str | None = None,
        tag: str | None = None,
        offset: int = 0,
        limit: int = 50,
        sort: str = "update_time",
        direction: str = "desc",
    ) -> list[KnowledgeNetwork]:
        params: dict[str, Any] = {
            "offset": offset,
            "limit": limit,
            "sort": sort,
            "direction": direction,
        }
        if name:
            params["name"] = name
        if name_pattern:
            params["name_pattern"] = name_pattern
        if tag:
            params["tag"] = tag
        data = self._http.get(
            "/api/ontology-manager/v1/knowledge-networks", params=params
        )
        items = data if isinstance(data, list) else (data.get("entries") or data.get("data") or [])
        return [_parse_kn(d) for d in items]

    def get(
        self,
        id: str,
        *,
        include_statistics: bool = False,
    ) -> KnowledgeNetwork:
        """Get knowledge network by ID.

        Args:
            id: Knowledge network ID.
            include_statistics: If True, request statistics in the response.
        """
        params: dict[str, Any] = {}
        if include_statistics:
            params["include_statistics"] = "true"
        data = self._http.get(
            f"/api/ontology-manager/v1/knowledge-networks/{id}",
            params=params or None,
        )
        return _parse_kn(data)

    def update(self, id: str, **kwargs: Any) -> KnowledgeNetwork:
        data = self._http.put(
            f"/api/ontology-manager/v1/knowledge-networks/{id}", json=kwargs
        )
        return _parse_kn(data)

    def export(self, id: str) -> dict[str, Any]:
        """Export full knowledge network definition (object types, relations, properties)."""
        data = self._http.get(
            f"/api/ontology-manager/v1/knowledge-networks/{id}",
            params={"mode": "export"},
        )
        return data or {}

    def delete(self, id: str) -> None:
        self._http.delete(f"/api/ontology-manager/v1/knowledge-networks/{id}")

    def build(self, id: str) -> BuildJob:
        """Trigger a full build via the public ontology-manager endpoint."""
        self._http.post(
            f"/api/ontology-manager/v1/knowledge-networks/{id}/jobs",
            json={"name": f"sdk_build_{id[:8]}", "job_type": "full"},
        )
        job = BuildJob(kn_id=id)
        job.set_poll_fn(lambda: self.build_status(id))
        return job

    def build_status(self, id: str) -> BuildStatus:
        """Check build status via the public ontology-manager endpoint."""
        data = self._http.get(
            f"/api/ontology-manager/v1/knowledge-networks/{id}/jobs",
            params={"limit": 1, "direction": "desc"},
        )
        jobs = data if isinstance(data, list) else (data.get("entries") or data.get("data") or [])
        if jobs:
            return BuildStatus(
                state=jobs[0].get("state", "running"),
                state_detail=jobs[0].get("state_detail"),
            )
        return BuildStatus(state="completed")


def _parse_kn(d: Any) -> KnowledgeNetwork:
    if isinstance(d, list):
        d = d[0]
    stats = d.get("statistics")
    return KnowledgeNetwork(
        id=str(d.get("id", d.get("kn_id", ""))),
        name=d.get("name", ""),
        tags=d.get("tags", []),
        comment=d.get("comment") or d.get("description"),
        statistics=KNStatistics(**stats) if stats else None,
    )
