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
    def __init__(self, http: HttpClient, *, tls_insecure: bool = False) -> None:
        self._http = http
        self._tls_insecure = tls_insecure

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
        """Search KN schema via the public HTTP compatibility endpoint."""
        data = self._http.post(
            "/api/agent-retrieval/v1/kn/kn_search",
            json={
                "kn_id": kn_id,
                "query": query,
                "only_schema": only_schema,
            },
        )
        return KnSearchResult(
            object_types=data.get("object_types"),
            relation_types=data.get("relation_types"),
            action_types=data.get("action_types"),
            metric_types=data.get("metric_types"),
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
        """Query instance subgraph via MCP."""
        from kweaver.resources.context_loader import ContextLoaderResource

        base_url = str(self._http._client.base_url).rstrip("/")
        token = self._http._auth.auth_headers().get("Authorization", "").removeprefix("Bearer ").strip()
        cl = ContextLoaderResource(
            base_url,
            token,
            kn_id=kn_id,
            tls_insecure=self._tls_insecure,
        )
        data = cl.query_instance_subgraph(
            [p.model_dump() for p in paths],
        )
        return SubgraphResult(entries=data.get("entries", []))

    def object_type_properties(
        self,
        kn_id: str,
        ot_id: str,
        body: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        """Query instance property values for an object type.

        Args:
            kn_id: Knowledge network ID.
            ot_id: Object type ID.
            body: Request body with ``_instance_identities`` (list of identity dicts)
                  and ``properties`` (list of property names to return).
        """
        data = self._http.post(
            f"/api/ontology-query/v1/knowledge-networks/{kn_id}/object-types/{ot_id}/properties",
            json=body or {},
            headers={"X-HTTP-Method-Override": "GET"},
        )
        return data or {}
