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
    type: str | None = None
    data_source_type: str | None = None
    data_source_name: str | None = None
    sql_str: str | None = None
    meta_table_name: str | None = None
    fields: list[ViewField] | None = None


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
    data_properties: list[DataPropertyDetail] = []
    status: ObjectTypeStatus | None = None


class RelationType(BaseModel):
    id: str
    name: str
    kn_id: str
    source_ot_id: str
    target_ot_id: str
    mapping_type: str = "direct"


# ── BKN Phase 1 entity types ───────────────────────────────────────────


class ConceptGroup(BaseModel):
    model_config = {"extra": "ignore"}

    id: str
    name: str
    kn_id: str
    branch: str = "main"
    object_type_ids: list[str] = []
    creator: str | None = None
    updater: str | None = None
    create_time: str | None = None
    update_time: str | None = None


class Job(BaseModel):
    model_config = {"extra": "ignore"}

    id: str
    kn_id: str
    type: str
    status: str  # pending | running | completed | failed
    progress: float | None = None
    creator: str | None = None
    create_time: str | None = None
    update_time: str | None = None


class Task(BaseModel):
    """Sub-task of a Job (BKN background task unit)."""

    model_config = {"extra": "ignore"}

    id: str
    job_id: str
    name: str
    status: str
    error: str | None = None
    create_time: str | None = None
    update_time: str | None = None


class DataPropertyDetail(BaseModel):
    model_config = {"extra": "ignore"}

    name: str
    display_name: str | None = None
    type: str
    indexed: bool = False
    full_text: bool = False
    vector: bool = False
    required: bool = False
    default_value: Any = None
    enum_values: list[str] | None = None
    mapped_field: str | dict[str, Any] | None = None


class MappingRule(BaseModel):
    model_config = {"extra": "ignore"}

    source_field: str
    target_field: str
    operator: str | None = None


class ActionSource(BaseModel):
    model_config = {"extra": "ignore"}

    type: str
    url: str | None = None
    method: str | None = None


class ActionParam(BaseModel):
    model_config = {"extra": "ignore"}

    name: str
    type: str
    required: bool = False
    default: Any = None
    description: str | None = None


class ServiceHealth(BaseModel):
    model_config = {"extra": "ignore"}

    service: str
    status: str
    version: str | None = None
    go_version: str | None = None
    arch: str | None = None


class BKNInspectReport(BaseModel):
    model_config = {"extra": "ignore"}

    kn: KnowledgeNetwork
    health: list[ServiceHealth] = []
    stats: KNStatistics = Field(default_factory=KNStatistics)
    object_type_summary: list[dict[str, Any]] = []
    active_jobs: list[Job] = []


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
    raw: str | None = None


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
    conversation_id: str = ""


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


# ── Vega types ────────────────────────────────────────────────────────────


class VegaServerInfo(BaseModel):
    model_config = {"extra": "ignore"}

    server_name: str
    server_version: str
    language: str
    go_version: str
    go_arch: str
    extra: dict[str, Any] = Field(default_factory=dict)


class VegaCatalog(BaseModel):
    model_config = {"extra": "ignore"}

    id: str
    name: str
    type: str = ""
    connector_type: str = ""
    status: str | None = None
    health_status: str | None = None
    health_check_status: str | None = None
    description: str | None = None
    creator: Any = None
    create_time: int | str | None = None
    update_time: int | str | None = None


class VegaResourceProperty(BaseModel):
    model_config = {"extra": "ignore"}

    name: str
    type: str
    description: str | None = None
    nullable: bool | None = None
    primary_key: bool | None = None


class VegaResource(BaseModel):
    model_config = {"extra": "ignore"}

    id: str
    name: str
    catalog_id: str = ""
    category: str = ""  # table / view / topic / dataset / etc.
    status: str = ""
    description: str | None = None
    properties: list[VegaResourceProperty] = []
    create_time: int | str | None = None
    update_time: int | str | None = None


class VegaConnectorType(BaseModel):
    model_config = {"extra": "ignore"}

    type: str
    name: str
    enabled: bool = True
    description: str | None = None
    icon: str | None = None


# ── Vega model types ──────────────────────────────────────────────────────


class VegaMetricModel(BaseModel):
    model_config = {"extra": "ignore"}

    id: str
    name: str
    description: str | None = None
    status: str | None = None
    catalog_id: str | None = None
    creator: Any = None
    create_time: int | str | None = None
    update_time: int | str | None = None
    extra: dict[str, Any] = Field(default_factory=dict)


class VegaEventModel(BaseModel):
    model_config = {"extra": "ignore"}

    id: str
    name: str
    description: str | None = None
    status: str | None = None
    catalog_id: str | None = None
    creator: Any = None
    create_time: int | str | None = None
    update_time: int | str | None = None
    extra: dict[str, Any] = Field(default_factory=dict)


class VegaTraceModel(BaseModel):
    model_config = {"extra": "ignore"}

    id: str
    name: str
    description: str | None = None
    status: str | None = None
    catalog_id: str | None = None
    creator: Any = None
    create_time: int | str | None = None
    update_time: int | str | None = None
    extra: dict[str, Any] = Field(default_factory=dict)


class VegaDataView(BaseModel):
    model_config = {"extra": "ignore"}

    id: str
    name: str
    description: str | None = None
    status: str | None = None
    catalog_id: str | None = None
    fields: list[dict[str, Any]] = []
    creator: Any = None
    create_time: int | str | None = None
    update_time: int | str | None = None
    extra: dict[str, Any] = Field(default_factory=dict)


class VegaDataDictItem(BaseModel):
    model_config = {"extra": "ignore"}

    key: str
    value: str
    description: str | None = None


class VegaDataDict(BaseModel):
    model_config = {"extra": "ignore"}

    id: str
    name: str
    description: str | None = None
    status: str | None = None
    items: list[VegaDataDictItem] = []
    creator: Any = None
    create_time: int | str | None = None
    update_time: int | str | None = None
    extra: dict[str, Any] = Field(default_factory=dict)


class VegaObjectiveModel(BaseModel):
    model_config = {"extra": "ignore"}

    id: str
    name: str
    description: str | None = None
    status: str | None = None
    catalog_id: str | None = None
    creator: Any = None
    create_time: int | str | None = None
    update_time: int | str | None = None
    extra: dict[str, Any] = Field(default_factory=dict)


# ── Vega task types ───────────────────────────────────────────────────────


class VegaDiscoverTask(BaseModel):
    model_config = {"extra": "ignore"}

    id: str
    catalog_id: str
    status: str  # pending | running | completed | failed
    progress: float | None = None
    error: str | None = None
    create_time: str | None = None
    update_time: str | None = None


class VegaMetricTask(BaseModel):
    model_config = {"extra": "ignore"}

    id: str
    status: str
    metric_model_id: str | None = None
    progress: float | None = None
    error: str | None = None
    create_time: str | None = None
    update_time: str | None = None


class VegaSpan(BaseModel):
    model_config = {"extra": "ignore"}

    trace_id: str
    span_id: str
    parent_span_id: str | None = None
    operation_name: str
    start_time: str | None = None
    duration_ms: float | None = None
    tags: dict[str, Any] = Field(default_factory=dict)
    logs: list[dict[str, Any]] = []


# ── Vega query result types ───────────────────────────────────────────────


class VegaQueryResult(BaseModel):
    model_config = {"extra": "ignore"}

    entries: list[dict[str, Any]] = []
    total_count: int = 0
    search_after: list[Any] | None = None


class VegaDslResult(BaseModel):
    model_config = {"extra": "ignore"}

    hits: list[dict[str, Any]] = []
    total: int = 0
    took_ms: int = 0
    aggregations: dict[str, Any] | None = None


class VegaPromqlResult(BaseModel):
    model_config = {"extra": "ignore"}

    status: str
    result_type: str = ""
    result: list[Any] = []
    error: str | None = None


# ── Vega health/stats/inspect types ──────────────────────────────────────


class VegaHealthReport(BaseModel):
    model_config = {"extra": "ignore"}

    catalogs: list[VegaCatalog] = []
    healthy_count: int = 0
    degraded_count: int = 0
    unhealthy_count: int = 0
    offline_count: int = 0


class VegaPlatformStats(BaseModel):
    model_config = {"extra": "ignore"}

    catalog_count: int = 0
    resource_count: int = 0
    metric_model_count: int = 0
    event_model_count: int = 0
    trace_model_count: int = 0
    data_view_count: int = 0
    data_dict_count: int = 0
    objective_model_count: int = 0
    extra: dict[str, Any] = Field(default_factory=dict)


class VegaInspectReport(BaseModel):
    model_config = {"extra": "ignore"}

    server_info: VegaServerInfo | None = None
    catalog_health: VegaHealthReport = Field(default_factory=VegaHealthReport)
    platform_stats: VegaPlatformStats | None = None
    active_tasks: list[VegaDiscoverTask] = []
    errors: list[str] = []
