"""Pydantic models for entities, parameters, and results."""

from __future__ import annotations

import time
from typing import Any, Callable

from pydantic import BaseModel, Field


# ── Entity types (returned from API) ────────────────────────────────────


class DataSource(BaseModel):
    id: str
    name: str
    type: str
    comment: str | None = None


class Column(BaseModel):
    name: str
    type: str
    comment: str | None = None


class Table(BaseModel):
    name: str
    columns: list[Column] = []


class ViewField(BaseModel):
    name: str
    type: str
    display_name: str | None = None
    comment: str | None = None


class DataView(BaseModel):
    id: str
    name: str
    query_type: str
    datasource_id: str = ""
    fields: list[ViewField] = []


class KNStatistics(BaseModel):
    object_types_total: int = 0
    relation_types_total: int = 0
    action_types_total: int = 0
    concept_groups_total: int = 0


class KnowledgeNetwork(BaseModel):
    id: str
    name: str
    tags: list[str] = []
    comment: str | None = None
    statistics: KNStatistics | None = None


class DataProperty(BaseModel):
    name: str
    display_name: str | None = None
    type: str = "varchar"
    comment: str | None = None
    indexed: bool = False
    fulltext: bool = False
    vector: bool = False


class ObjectTypeStatus(BaseModel):
    index_available: bool = False
    doc_count: int = 0
    storage_size: int = 0
    update_time: int = 0


class ObjectType(BaseModel):
    id: str
    name: str
    kn_id: str
    dataview_id: str
    primary_keys: list[str]
    display_key: str
    incremental_key: str | None = None
    properties: list[DataProperty] = []
    status: ObjectTypeStatus | None = None


class RelationType(BaseModel):
    id: str
    name: str
    kn_id: str
    source_ot_id: str
    target_ot_id: str
    mapping_type: str = "direct"


# ── Parameter types (user-constructed input) ────────────────────────────


class Property(BaseModel):
    """Index configuration for a property when creating an ObjectType."""

    name: str
    display_name: str | None = None
    type: str | None = None
    indexed: bool = False
    fulltext: bool = False
    vector: bool = False


class Condition(BaseModel):
    """Query filter condition, supports recursive composition."""

    field: str | None = None
    operation: str
    value: Any = None
    value_from: str = "const"
    sub_conditions: list[Condition] | None = None

    def to_rest(self) -> dict[str, Any]:
        if self.sub_conditions is not None:
            return {
                "operation": self.operation,
                "sub_conditions": [c.to_rest() for c in self.sub_conditions],
            }
        d: dict[str, Any] = {
            "field": self.field,
            "operation": self.operation,
            "value": self.value,
            "value_from": self.value_from,
        }
        return d


class PathNode(BaseModel):
    id: str
    condition: Condition | None = None
    limit: int = 100


class PathEdge(BaseModel):
    id: str
    source: str
    target: str


class SubgraphPath(BaseModel):
    object_types: list[PathNode]
    relation_types: list[PathEdge]


# ── Result types ────────────────────────────────────────────────────────


class ConceptResult(BaseModel):
    concept_type: str
    concept_id: str
    concept_name: str
    concept_detail: dict[str, Any] | None = None
    intent_score: float = 0.0
    match_score: float = 0.0
    rerank_score: float = 0.0
    samples: list[dict[str, Any]] | None = None


class SemanticSearchResult(BaseModel):
    concepts: list[ConceptResult] = []
    hits_total: int = 0
    query_understanding: dict[str, Any] | None = None


class KnSearchResult(BaseModel):
    object_types: list[dict[str, Any]] | None = None
    relation_types: list[dict[str, Any]] | None = None
    action_types: list[dict[str, Any]] | None = None
    nodes: list[dict[str, Any]] | None = None


class InstanceResult(BaseModel):
    data: list[dict[str, Any]] = []
    total_count: int | None = None
    search_after: list[Any] | None = None
    object_type: dict[str, Any] | None = None


class SubgraphResult(BaseModel):
    entries: list[dict[str, Any]] = []


class BuildStatus(BaseModel):
    state: str
    state_detail: str | None = None


class BuildJob(BaseModel):
    kn_id: str
    _poll_fn: Callable[[], BuildStatus] | None = None

    model_config = {"arbitrary_types_allowed": True}

    def set_poll_fn(self, fn: Callable[[], BuildStatus]) -> None:
        self._poll_fn = fn

    def poll(self) -> BuildStatus:
        if self._poll_fn is None:
            raise RuntimeError("BuildJob not connected to a client")
        return self._poll_fn()

    def wait(self, timeout: float = 300, poll_interval: float = 2.0) -> BuildStatus:
        deadline = time.time() + timeout
        while True:
            status = self.poll()
            if status.state in ("completed", "failed"):
                return status
            if time.time() + poll_interval > deadline:
                raise TimeoutError(
                    f"Build for kn_id={self.kn_id} did not complete within {timeout}s"
                )
            time.sleep(poll_interval)


# ── Agent & Conversation types ─────────────────────────────────────


class Agent(BaseModel):
    id: str
    name: str
    key: str | None = None               # agent-factory app key
    version: str | None = None            # agent version (e.g. "v20")
    description: str | None = None
    status: str = "draft"                 # published / draft
    kn_ids: list[str] = []
    system_prompt: str | None = None
    capabilities: list[str] = []
    model_config_data: Any = None
    conversation_count: int = 0


class Conversation(BaseModel):
    id: str
    agent_id: str
    title: str | None = None
    message_count: int = 0
    last_active: str | None = None


class Reference(BaseModel):
    source: str
    content: str
    score: float = 0.0


class Message(BaseModel):
    id: str
    role: str                             # user / assistant
    content: str
    references: list[Reference] = []
    timestamp: str


class MessageChunk(BaseModel):
    """Single chunk from a streaming response."""
    delta: str
    finished: bool = False
    references: list[Reference] = []


# ── Action types ──────────────────────────────────────────────────────


class ActionType(BaseModel):
    id: str
    name: str
    kn_id: str = ""
    description: str | None = None
    input_params: list[dict[str, Any]] = []
    output_params: list[dict[str, Any]] = []


class ActionExecution(BaseModel):
    execution_id: str
    kn_id: str
    action_type_id: str
    status: str = "pending"  # pending, running, completed, failed, cancelled
    result: dict[str, Any] | None = None
    _poll_fn: Callable[[], "ActionExecution"] | None = None

    model_config = {"arbitrary_types_allowed": True}

    def set_poll_fn(self, fn: Callable[[], "ActionExecution"]) -> None:
        self._poll_fn = fn

    def poll(self) -> "ActionExecution":
        if self._poll_fn is None:
            raise RuntimeError("ActionExecution not connected to a client")
        return self._poll_fn()

    def wait(self, timeout: float = 300, poll_interval: float = 2.0) -> "ActionExecution":
        deadline = time.time() + timeout
        while True:
            updated = self.poll()
            if updated.status in ("completed", "failed", "cancelled"):
                return updated
            if time.time() + poll_interval > deadline:
                raise TimeoutError(
                    f"Action execution {self.execution_id} did not complete within {timeout}s"
                )
            time.sleep(poll_interval)

    def cancel(self) -> None:
        raise NotImplementedError("Use action_types.cancel() directly")
