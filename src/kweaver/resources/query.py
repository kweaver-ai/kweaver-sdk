"""SDK resource: query (agent-retrieval + ontology-query)."""

from __future__ import annotations

from typing import TYPE_CHECKING, Any, Iterator

from kweaver.types import (
    Condition,
    ConceptResult,
    InstanceResult,
    KnSearchResult,
    SemanticSearchResult,
    SubgraphPath,
    SubgraphResult,
)

if TYPE_CHECKING:
    from kweaver._http import HttpClient


class QueryResource:
    def __init__(self, http: HttpClient) -> None:
        self._http = http

    def semantic_search(
        self,
        kn_id: str,
        query: str,
        *,
        mode: str = "keyword_vector_retrieval",
        max_concepts: int = 10,
    ) -> SemanticSearchResult:
        data = self._http.post(
            "/api/agent-retrieval/v1/kn/semantic-search",
            json={
                "kn_id": kn_id,
                "query": query,
                "mode": mode,
                "rerank_action": "default",
                "max_concepts": max_concepts,
                "return_query_understanding": False,
            },
        )
        return SemanticSearchResult(
            concepts=[ConceptResult(**c) for c in data.get("concepts", [])],
            hits_total=data.get("hits_total", 0),
            query_understanding=data.get("query_understanding"),
        )

    def kn_search(
        self,
        kn_id: str,
        query: str,
        *,
        only_schema: bool = False,
    ) -> KnSearchResult:
        body: dict[str, Any] = {"kn_id": kn_id, "query": query}
        if only_schema:
            body["only_schema"] = True
        data = self._http.post(
            "/api/agent-retrieval/in/v1/kn/kn_search", json=body
        )
        return KnSearchResult(
            object_types=data.get("object_types"),
            relation_types=data.get("relation_types"),
            action_types=data.get("action_types"),
            nodes=data.get("nodes"),
        )

    def instances(
        self,
        kn_id: str,
        ot_id: str,
        *,
        condition: Condition | None = None,
        limit: int = 20,
        search_after: list[Any] | None = None,
        need_total: bool = True,
    ) -> InstanceResult:
        body: dict[str, Any] = {
            "limit": limit,
            "need_total": need_total,
        }
        if condition is not None:
            body["condition"] = condition.to_rest()
        if search_after is not None:
            body["search_after"] = search_after

        data = self._http.post(
            f"/api/ontology-query/v1/knowledge-networks/{kn_id}/object-types/{ot_id}",
            json=body,
            headers={"X-HTTP-Method-Override": "GET"},
            timeout=120.0,
        )
        return InstanceResult(
            data=data.get("datas") or data.get("data") or [],
            total_count=data.get("total_count"),
            search_after=data.get("search_after"),
            object_type=data.get("object_type"),
        )

    def instances_iter(
        self,
        kn_id: str,
        ot_id: str,
        *,
        condition: Condition | None = None,
        limit: int = 100,
    ) -> Iterator[InstanceResult]:
        cursor: list[Any] | None = None
        while True:
            result = self.instances(
                kn_id, ot_id, condition=condition, limit=limit, search_after=cursor
            )
            yield result
            if not result.data or result.search_after is None:
                break
            cursor = result.search_after

    def subgraph(
        self,
        kn_id: str,
        paths: list[SubgraphPath],
    ) -> SubgraphResult:
        body: dict[str, Any] = {
            "kn_id": kn_id,
            "paths": [p.model_dump() for p in paths],
        }
        data = self._http.post(
            "/api/agent-retrieval/in/v1/kn/query_instance_subgraph",
            json=body,
        )
        return SubgraphResult(entries=data.get("entries", []))

    def object_type_properties(
        self,
        kn_id: str,
        ot_id: str,
        body: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        """Query object type property definitions and statistics."""
        data = self._http.post(
            f"/api/ontology-query/v1/knowledge-networks/{kn_id}/object-types/{ot_id}/properties",
            json=body or {},
            headers={"X-HTTP-Method-Override": "GET"},
        )
        return data or {}
