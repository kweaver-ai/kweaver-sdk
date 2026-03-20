# Vega 读取操作与可观测性设计

## 概述

在 kweaver-sdk（Python + TypeScript）中扩展 Vega 数据管理平台的完整读取操作和可观测能力。所有 Vega 资源通过 `client.vega.*` 命名空间访问，CLI 命令位于 `kweaver vega *` 下。

## 目标用户

- **平台运维人员** — 日常健康巡检、故障排查、容量监控
- **数据工程师/开发者** — 编程式数据查询、元数据管理
- **AI Agent** — 通过工具调用进行数据发现和查询（CLI + JSON 输出）

## 架构

Vega 能力作为 kweaver-sdk 的扩展模块，复用现有的 Auth、HTTP 和 CLI 基础设施。通过单一 `vega_url` 配置指向 vega-backend（所有 Vega 服务的统一入口）。

```
KWeaverClient
├── agents               (已有)
├── knowledge_networks   (已有)
├── query                (已有)
└── vega                 (新增 — VegaNamespace)
    ├── catalogs         (CatalogsResource)
    ├── resources        (ResourcesResource)
    ├── connector_types  (ConnectorTypesResource)
    ├── metric_models    (MetricModelsResource)
    ├── event_models     (EventModelsResource)
    ├── trace_models     (TraceModelsResource)
    ├── data_views       (DataViewsResource)
    ├── data_dicts       (DataDictsResource)
    ├── objective_models (ObjectiveModelsResource)
    ├── query            (VegaQueryResource)
    ├── tasks            (TasksResource — 统一：discover/metric/event)
    └── health / stats / inspect (VegaNamespace 上的方法)
```

### VegaNamespace 类

`KWeaverClient` 上的 `vega` 属性是一个 `VegaNamespace` 实例，拥有**独立的 `HttpClient`**，指向 `vega_url`。这是必要的，因为 Vega 服务使用与 KWeaver 主平台不同的 base URL。

```python
# Python
class VegaNamespace:
    """Vega 资源的命名空间，拥有独立的 HttpClient。"""

    def __init__(self, http: HttpClient) -> None:
        self._http = http
        self.catalogs = VegaCatalogsResource(http)
        self.resources = VegaResourcesResource(http)
        self.connector_types = VegaConnectorTypesResource(http)
        # 6 个模型资源通过泛型基类实现（见"熵减"章节）
        self.metric_models = VegaMetricModelsResource(http)
        self.event_models = VegaEventModelsResource(http)
        self.trace_models = VegaTraceModelsResource(http)
        self.data_views = VegaDataViewsResource(http)
        self.data_dicts = VegaDataDictsResource(http)
        self.objective_models = VegaObjectiveModelsResource(http)
        self.query = VegaQueryResource(http)
        self.tasks = VegaTasksResource(http)

    def health(self) -> VegaServerInfo: ...
    def stats(self) -> VegaPlatformStats: ...
    def inspect(self, full: bool = False) -> VegaInspectReport: ...
```

```typescript
// TypeScript — 使用 VegaContext（对应 ClientContext）
interface VegaContext {
  base(): { baseUrl: string; accessToken: string; businessDomain: string };
}
```

### 配置

```python
# 显式配置 — vega_url 可选，未配置时 vega 功能不可用
client = KWeaverClient(
    base_url="https://kweaver.example.com",
    token="...",
    vega_url="http://vega-backend:13014",
)
# client.vega 可用

# 未配置 vega_url — 访问 client.vega 抛出 ValueError("vega_url not configured")
client = KWeaverClient(base_url="...", token="...")
client.vega  # → ValueError

# 环境变量
# KWEAVER_VEGA_URL=http://vega-backend:13014

# ~/.kweaver/<platform>/config.json
# { "vega_url": "http://vega-backend:13014" }

# ConfigAuth — 从存储的配置中读取 vega_url
client = KWeaverClient(auth=ConfigAuth())
```

**认证模型**：Vega 使用与 KWeaver 相同的 Hydra OAuth token。vega 的独立 `HttpClient` 复用同一个 `AuthProvider` 实例，仅 `base_url` 不同。

### CLI 辅助

CLI 中的 `make_client()` 扩展为接受 `--vega-url` 参数并读取 `KWEAVER_VEGA_URL` 环境变量。无需单独的 `make_vega_client()`。

## 类型定义

### Python（Pydantic 模型，位于 `types.py`）

```python
# ── Vega 实体类型 ──────────────────────────────────────────────────

class VegaServerInfo(BaseModel):
    server_name: str
    server_version: str
    language: str
    go_version: str
    go_arch: str

class VegaCatalog(BaseModel):
    id: str
    name: str
    type: str                          # "physical" | "logical"
    connector_type: str                # "mysql" | "opensearch" | ...
    status: str                        # "active" | "disabled"
    health_status: str | None = None   # "healthy" | "degraded" | "unhealthy" | "offline" | "disabled"
    health_check_time: str | None = None
    health_error: str | None = None
    description: str | None = None
    config: dict[str, Any] | None = None

class VegaResourceProperty(BaseModel):
    name: str
    type: str                  # "string" | "integer" | "float" | "boolean" | "datetime" | ...
    nullable: bool = True
    description: str | None = None

class VegaResource(BaseModel):
    id: str
    name: str
    catalog_id: str
    category: str              # "table" | "index" | "dataset" | "metric" | "topic" | "file" | "fileset" | "api" | "logicview"
    status: str                # "active" | "disabled" | "deprecated" | "stale"
    database: str | None = None
    schema_name: str | None = None
    properties: list[VegaResourceProperty] = []
    description: str | None = None

class VegaConnectorType(BaseModel):
    type: str
    name: str
    enabled: bool = True
    description: str | None = None

class VegaMetricModel(BaseModel):
    id: str
    name: str
    group_id: str | None = None
    data_connection_id: str | None = None
    status: str | None = None
    description: str | None = None

class VegaEventModel(BaseModel):
    id: str
    name: str
    status: str | None = None
    level: str | None = None
    description: str | None = None

class VegaTraceModel(BaseModel):
    id: str
    name: str
    status: str | None = None
    description: str | None = None

class VegaDataView(BaseModel):
    id: str
    name: str
    group_id: str | None = None
    status: str | None = None
    description: str | None = None

class VegaDataDict(BaseModel):
    id: str
    name: str
    description: str | None = None

class VegaDataDictItem(BaseModel):
    id: str
    dict_id: str
    key: str
    value: str
    sort_order: int = 0

class VegaObjectiveModel(BaseModel):
    id: str
    name: str
    description: str | None = None

class VegaDiscoverTask(BaseModel):
    id: str
    catalog_id: str
    status: str             # "pending" | "running" | "completed" | "failed"
    progress: float | None = None
    error: str | None = None
    created_at: str | None = None
    completed_at: str | None = None

class VegaMetricTask(BaseModel):
    id: str
    status: str
    plan_time: str | None = None

class VegaSpan(BaseModel):
    span_id: str
    trace_id: str
    parent_span_id: str | None = None
    operation_name: str | None = None
    service_name: str | None = None
    duration_ms: float | None = None
    start_time: str | None = None
    status: str | None = None
    attributes: dict[str, Any] = {}

# ── Vega 结果类型 ──────────────────────────────────────────────────

class VegaQueryResult(BaseModel):
    entries: list[dict[str, Any]] = []
    total_count: int | None = None

class VegaDslResult(BaseModel):
    """DSL 搜索结果。"""
    hits: list[dict[str, Any]] = []
    total: int = 0
    took_ms: int | None = None
    scroll_id: str | None = None

class VegaPromqlResult(BaseModel):
    status: str = "success"
    result_type: str | None = None   # "matrix" | "vector" | "scalar"
    result: list[dict[str, Any]] = []

class VegaHealthReport(BaseModel):
    catalogs: list[VegaCatalog] = []
    healthy_count: int = 0
    degraded_count: int = 0
    unhealthy_count: int = 0
    offline_count: int = 0

class VegaPlatformStats(BaseModel):
    catalogs_total: int = 0
    resources_by_category: dict[str, int] = {}
    models: dict[str, int] = {}        # {metric: 5, event: 3, trace: 2, ...}
    tasks_summary: dict[str, int] = {}  # {running: 2, pending: 1, ...}

class VegaInspectReport(BaseModel):
    server_info: VegaServerInfo
    catalog_health: VegaHealthReport
    resource_summary: dict[str, int] = {}
    active_tasks: list[VegaDiscoverTask] = []
```

### TypeScript（接口）

TypeScript 在 `types/vega.ts` 中以接口形式镜像上述所有类型。

## REST 端点映射

每个 SDK 方法对应一个具体的 HTTP 调用。各服务的基础路径：

- **vega-backend**: `/api/vega-backend/v1`
- **mdl-data-model**: `/api/mdl-data-model/v1`
- **mdl-uniquery**: `/api/mdl-uniquery/v1`

由于所有请求将通过 vega-backend 作为统一入口路由，SDK 始终发送到 `vega_url`。Vega-backend 内部代理请求到其他服务。

### Catalogs（vega-backend）

| SDK 方法 | HTTP | 端点 |
|---------|------|------|
| `catalogs.list()` | `GET` | `/api/vega-backend/v1/catalogs` |
| `catalogs.get(ids)` | `GET` | `/api/vega-backend/v1/catalogs/{ids}` |
| `catalogs.health_status(ids)` | `GET` | `/api/vega-backend/v1/catalogs/{ids}/health-status` |
| `catalogs.health_report()` | 组合 | `list()` → 对所有 catalog 调用 `health_status()` |
| `catalogs.test_connection(id)` | `POST` | `/api/vega-backend/v1/catalogs/{id}/test-connection` |
| `catalogs.discover(id)` | `POST` | `/api/vega-backend/v1/catalogs/{id}/discover` |
| `catalogs.resources(ids)` | `GET` | `/api/vega-backend/v1/catalogs/{ids}/resources` |

### Resources（vega-backend）

| SDK 方法 | HTTP | 端点 |
|---------|------|------|
| `resources.list()` | `GET` | `/api/vega-backend/v1/resources` |
| `resources.get(ids)` | `GET` | `/api/vega-backend/v1/resources/{ids}` |
| `resources.data(id, body)` | `POST` | `/api/vega-backend/v1/resources/{id}/data` |

### Connector Types（vega-backend）

| SDK 方法 | HTTP | 端点 |
|---------|------|------|
| `connector_types.list()` | `GET` | `/api/vega-backend/v1/connector-types` |
| `connector_types.get(type)` | `GET` | `/api/vega-backend/v1/connector-types/{type}` |

### Discover Tasks（vega-backend）

| SDK 方法 | HTTP | 端点 |
|---------|------|------|
| `tasks.list_discover()` | `GET` | `/api/vega-backend/v1/discover-tasks` |
| `tasks.get_discover(id)` | `GET` | `/api/vega-backend/v1/discover-tasks/{id}` |
| `tasks.wait_discover(id)` | 组合 | 轮询 `get_discover()` 直到终态（指数退避：初始 2s，翻倍至上限 30s） |

### Query Execute（vega-backend）

| SDK 方法 | HTTP | 端点 |
|---------|------|------|
| `query.execute(body)` | `POST` | `/api/vega-backend/v1/query/execute` |

### Metric Models（mdl-data-model）

| SDK 方法 | HTTP | 端点 |
|---------|------|------|
| `metric_models.list()` | `GET` | `/api/mdl-data-model/v1/metric-models` |
| `metric_models.get(ids)` | `GET` | `/api/mdl-data-model/v1/metric-models/{ids}` |
| `metric_models.fields(ids)` | `GET` | `/api/mdl-data-model/v1/metric-models/{ids}/fields` |
| `metric_models.order_fields(ids)` | `GET` | `/api/mdl-data-model/v1/metric-models/{ids}/order_fields` |

### Metric Tasks（mdl-data-model）

| SDK 方法 | HTTP | 端点 |
|---------|------|------|
| `tasks.get_metric(task_id)` | `GET` | `/api/mdl-data-model/v1/metric-tasks/{task_id}` |

### Event Models（mdl-data-model）

| SDK 方法 | HTTP | 端点 |
|---------|------|------|
| `event_models.list()` | `GET` | `/api/mdl-data-model/v1/event-models` |
| `event_models.get(ids)` | `GET` | `/api/mdl-data-model/v1/event-models/{ids}` |
| `event_models.levels()` | `GET` | `/api/mdl-data-model/v1/event-level` |

### Trace Models（mdl-data-model）

| SDK 方法 | HTTP | 端点 |
|---------|------|------|
| `trace_models.list()` | `GET` | `/api/mdl-data-model/v1/trace-models` |
| `trace_models.get(ids)` | `GET` | `/api/mdl-data-model/v1/trace-models/{ids}` |
| `trace_models.field_info(ids)` | `GET` | `/api/mdl-data-model/v1/trace-models/{ids}/field-info` |

### Data Views（mdl-data-model）

| SDK 方法 | HTTP | 端点 |
|---------|------|------|
| `data_views.list()` | `GET` | `/api/mdl-data-model/v1/data-views` |
| `data_views.get(ids)` | `GET` | `/api/mdl-data-model/v1/data-views/{ids}` |
| `data_views.groups()` | `GET` | `/api/mdl-data-model/v1/data-view-groups` |

### Data Dicts（mdl-data-model）

| SDK 方法 | HTTP | 端点 |
|---------|------|------|
| `data_dicts.list()` | `GET` | `/api/mdl-data-model/v1/data-dicts` |
| `data_dicts.get(id)` | `GET` | `/api/mdl-data-model/v1/data-dicts/{id}` |
| `data_dicts.items(id)` | `GET` | `/api/mdl-data-model/v1/data-dicts/{id}/items` |

### Objective Models（mdl-data-model）

| SDK 方法 | HTTP | 端点 |
|---------|------|------|
| `objective_models.list()` | `GET` | `/api/mdl-data-model/v1/objective-models` |
| `objective_models.get(ids)` | `GET` | `/api/mdl-data-model/v1/objective-models/{ids}` |

### DSL 查询（mdl-uniquery）

| SDK 方法 | HTTP | 端点 |
|---------|------|------|
| `query.dsl(index, body)` | `POST` | `/api/mdl-uniquery/v1/dsl/{index}/_search` |
| `query.dsl(body)` | `POST` | `/api/mdl-uniquery/v1/dsl/_search` |
| `query.dsl_count(index, body)` | `POST` | `/api/mdl-uniquery/v1/dsl/{index}/_count` |
| `query.dsl_scroll(body)` | `POST` | `/api/mdl-uniquery/v1/dsl/_search/scroll` |

### PromQL 查询（mdl-uniquery）

注意：PromQL 端点要求 `Content-Type: application/x-www-form-urlencoded`。SDK 实现时使用 `RequestContext.kwargs["data"]`（而非 `kwargs["json"]`）传递参数，httpx 会自动设置正确的 Content-Type。

| SDK 方法 | HTTP | 端点 |
|---------|------|------|
| `query.promql(query, start, end, step)` | `POST` | `/api/mdl-uniquery/v1/promql/query_range` |
| `query.promql_instant(query)` | `POST` | `/api/mdl-uniquery/v1/promql/query` |
| `query.promql_series(match)` | `POST` | `/api/mdl-uniquery/v1/promql/series` |

### 指标模型数据查询（mdl-uniquery）

| SDK 方法 | HTTP | 端点 |
|---------|------|------|
| `query.metric_model(ids, body)` | `POST` | `/api/mdl-uniquery/v1/metric-models/{ids}` |
| `query.metric_model_fields(ids)` | `GET` | `/api/mdl-uniquery/v1/metric-models/{ids}/fields` |
| `query.metric_model_labels(ids)` | `GET` | `/api/mdl-uniquery/v1/metric-models/{ids}/labels` |

### 数据视图查询（mdl-uniquery）

| SDK 方法 | HTTP | 端点 |
|---------|------|------|
| `query.data_view(ids, body)` | `POST` | `/api/mdl-uniquery/v1/data-views/{ids}` |

### Trace 查询（mdl-uniquery）

Trace 相关查询统一归入 `trace_models` 命名空间（而非分散到 `query`），因为所有操作都以 trace_model_id 为入口，语义上属于 trace model 的子操作。

| SDK 方法 | HTTP | 端点 |
|---------|------|------|
| `trace_models.trace(tm_id, trace_id)` | `POST` | `/api/mdl-uniquery/v1/trace-models/{tm_id}/traces/{trace_id}` |
| `trace_models.spans(tm_id, trace_id)` | `POST` | `/api/mdl-uniquery/v1/trace-models/{tm_id}/traces/{trace_id}/spans` |
| `trace_models.span(tm_id, trace_id, span_id)` | `GET` | `/api/mdl-uniquery/v1/trace-models/{tm_id}/traces/{trace_id}/spans/{span_id}` |
| `trace_models.related_logs(tm_id, trace_id, span_id)` | `POST` | `/api/mdl-uniquery/v1/trace-models/{tm_id}/traces/{trace_id}/spans/{span_id}/related-logs` |

### 事件查询（mdl-uniquery）

| SDK 方法 | HTTP | 端点 |
|---------|------|------|
| `query.events(body)` | `POST` | `/api/mdl-uniquery/v1/events` |
| `query.event(em_id, event_id)` | `GET` | `/api/mdl-uniquery/v1/event-models/{em_id}/events/{event_id}` |

### 健康检查（vega-backend）

| SDK 方法 | HTTP | 端点 |
|---------|------|------|
| `health()` | `GET` | `/health` |

## SDK 资源 API

### Catalogs

```python
client.vega.catalogs.list(status="healthy", limit=20, offset=0)
client.vega.catalogs.get("cat-1")
client.vega.catalogs.health_status(["cat-1", "cat-2"])
client.vega.catalogs.health_report()   # 组合操作：列出所有 → 批量 health_status → 聚合为 VegaHealthReport
client.vega.catalogs.test_connection("cat-1")
client.vega.catalogs.discover("cat-1")
client.vega.catalogs.resources("cat-1", category="table")
```

### Resources

```python
client.vega.resources.list(catalog_id="cat-1", category="table", status="active", limit=20, offset=0)
client.vega.resources.get("res-1")
client.vega.resources.data("res-1", body={...})  # 查询资源数据
```

### Connector Types

```python
client.vega.connector_types.list()
client.vega.connector_types.get("mysql")
```

### Metric Models

```python
client.vega.metric_models.list(limit=20, offset=0)
client.vega.metric_models.get("mm-1")
client.vega.metric_models.fields("mm-1")
client.vega.metric_models.order_fields("mm-1")
```

### Event Models

```python
client.vega.event_models.list(limit=20, offset=0)
client.vega.event_models.get("em-1")
client.vega.event_models.levels()
```

### Trace Models

```python
client.vega.trace_models.list(limit=20, offset=0)
client.vega.trace_models.get("tm-1")
client.vega.trace_models.field_info("tm-1")
client.vega.trace_models.trace("tm-1", "trace-id")                  # trace 详情（从 query.trace 合并而来）
client.vega.trace_models.spans("tm-1", "trace-id", body={...})
client.vega.trace_models.span("tm-1", "trace-id", "span-id")
client.vega.trace_models.related_logs("tm-1", "trace-id", "span-id")
```

### Data Views

```python
client.vega.data_views.list(limit=20, offset=0)
client.vega.data_views.get("dv-1")
client.vega.data_views.groups()
```

### Data Dicts

```python
client.vega.data_dicts.list(limit=20, offset=0)
client.vega.data_dicts.get("dd-1")
client.vega.data_dicts.items("dd-1", limit=20, offset=0)
```

### Objective Models

```python
client.vega.objective_models.list(limit=20, offset=0)
client.vega.objective_models.get("om-1")
```

### Query

```python
# DSL（兼容 OpenSearch）
client.vega.query.dsl(index="my-index", body={...})
client.vega.query.dsl(body={...})              # 全局搜索，不指定 index
client.vega.query.dsl_count(index="my-index", body={...})
client.vega.query.dsl_scroll(scroll_id="...")

# PromQL
client.vega.query.promql(query="up", start="2026-03-20T00:00:00Z", end="2026-03-20T01:00:00Z", step="15s")
client.vega.query.promql_instant(query="up")
client.vega.query.promql_series(match=["up"])

# 指标模型数据
client.vega.query.metric_model(ids="mm-1", body={...})
client.vega.query.metric_model_fields(ids="mm-1")
client.vega.query.metric_model_labels(ids="mm-1")

# 数据视图查询
client.vega.query.data_view(ids="dv-1", body={...})

# Trace — 已合并到 trace_models 命名空间（见 Trace Models 章节）
# client.vega.trace_models.trace("tm-1", "abc")

# 事件
client.vega.query.events(body={...})
client.vega.query.event(event_model_id="em-1", event_id="evt-1")

# Execute（vega-backend 统一查询）
client.vega.query.execute(tables=[...], filter_condition={...}, output_fields=[...], sort=[...], offset=0, limit=20)
```

### Tasks（统一命名空间）

SDK 使用单一 `tasks` 资源并以类型前缀区分方法，与 CLI 的统一 `task` 命令对齐：

```python
# Discover 任务
client.vega.tasks.list_discover(status="running")
client.vega.tasks.get_discover("task-1")
client.vega.tasks.wait_discover("task-1", timeout=300)  # 轮询直到终态

# Metric 任务
client.vega.tasks.get_metric("task-1")

# Event 任务 — 仅状态更新（无 list 端点）
```

### Health、Stats、Inspect

```python
# 服务健康检查
info = client.vega.health()
# → VegaServerInfo(server_name="VEGA Manager", server_version="1.0.0", ...)

# 平台统计 — 组合操作：调用 catalogs、resources、models、tasks 的 list
stats = client.vega.stats()
# → VegaPlatformStats(catalogs_total=6, resources_by_category={table: 42, ...}, ...)

# 聚合诊断 — 组合操作：health + stats + 活跃任务
# 内部并行化。子调用失败时返回部分结果。
report = client.vega.inspect(full=False)
# → VegaInspectReport(server_info=..., catalog_health=..., ...)
```

## CLI 层

所有命令位于 `kweaver vega` 下。默认输出 **Markdown** 格式。使用 `--format json` 供程序消费，`--format yaml` 作为备选。所有 list 命令支持 `--limit` 和 `--offset` 分页参数。

### 元数据

```bash
kweaver vega catalog list [--status healthy|degraded|unhealthy|offline|disabled] [--limit 20]
kweaver vega catalog get <id>
kweaver vega catalog health [<id...>] [--all]
kweaver vega catalog test-connection <id>
kweaver vega catalog discover <id> [--wait]
kweaver vega catalog resources <id> [--category table|index|...]

kweaver vega resource list [--catalog-id X] [--category table] [--status active] [--limit 20]
kweaver vega resource get <id>
kweaver vega resource data <id> -d '<body>'

kweaver vega connector-type list
kweaver vega connector-type get <type>
```

### 数据模型

```bash
kweaver vega metric-model list [--limit 20]
kweaver vega metric-model get <id>
kweaver vega metric-model fields <id>

kweaver vega event-model list [--limit 20]
kweaver vega event-model get <id>
kweaver vega event-model levels

kweaver vega trace-model list [--limit 20]
kweaver vega trace-model get <id>
kweaver vega trace-model fields <id>

kweaver vega data-view list [--limit 20]
kweaver vega data-view get <id>
kweaver vega data-view groups

kweaver vega data-dict list [--limit 20]
kweaver vega data-dict get <id>
kweaver vega data-dict items <id>

kweaver vega objective-model list [--limit 20]
kweaver vega objective-model get <id>
```

### 查询

```bash
kweaver vega query dsl [<index>] -d '<body>'
kweaver vega query dsl-count [<index>] -d '<body>'
kweaver vega query promql '<expr>' --start X --end Y --step 15s
kweaver vega query promql-instant '<expr>'
kweaver vega query promql-series --match '<selector>'
kweaver vega query metric-model <ids> -d '<body>'
kweaver vega query data-view <ids> -d '<body>'
kweaver vega query trace <trace-model-id> <trace-id>
kweaver vega query events -d '<body>'
kweaver vega query event <event-model-id> <event-id>
kweaver vega query execute -d '<request-body>'
kweaver vega query bench [<index>] -d '<body>' --count 10
```

注：`query bench` 仅限 CLI — 它是交互式基准测试工具（运行 N 次迭代，报告 p50/p95/p99），不属于 SDK 层抽象。

### 可观测性 — 状态

```bash
kweaver vega health
kweaver vega stats
kweaver vega inspect [--full]

kweaver vega task list [--type discover|metric|event] [--status running|pending|completed|failed]
kweaver vega task get <task-id> [--type discover|metric]
```

### 可观测性 — 诊断

```bash
kweaver vega trace show <trace-model-id> <trace-id>
kweaver vega trace spans <trace-model-id> <trace-id>
kweaver vega trace span <trace-model-id> <trace-id> <span-id>
kweaver vega trace related-logs <trace-model-id> <trace-id> <span-id>
```

### 输出格式

所有命令支持 `--format md|json|yaml`（默认：`md`）。

`kweaver vega inspect` 示例输出：

```markdown
## 服务

- VEGA Manager v1.0.0 (go1.22.0 linux/amd64)

## Catalog 健康状态

| 名称       | 类型     | 连接器     | 状态     | 最后检查时间        |
|------------|----------|-----------|----------|---------------------|
| prod-mysql | physical | mysql     | healthy  | 2026-03-20 10:30:00 |
| staging-os | physical | opensearch| degraded | 2026-03-20 10:28:12 |

## 资源概览

| 类别     | 数量 |
|----------|------|
| table    | 42   |
| index    | 15   |
| dataset  | 8    |
| metric   | 3    |
| 合计     | 68   |

## 活跃任务

- discover cat-1 — 运行中 (60%)
- metric-sync mm-3 — 等待中
```

## 错误处理

Vega 特有的错误继承现有 SDK 错误层次：

```python
class VegaError(KWeaverError):
    """所有 Vega 错误的基类。"""

class VegaConnectionError(VegaError):
    """Catalog 连接测试或健康检查失败。"""
    catalog_id: str
    connector_type: str

class VegaQueryError(VegaError):
    """查询执行失败（DSL、PromQL 等）。"""
    query_type: str  # "dsl" | "promql" | "execute"

class VegaDiscoverError(VegaError):
    """资源发现失败。"""
    catalog_id: str
    task_id: str
```

vega-backend 的 HTTP 错误遵循相同的 `rest.HTTPError` 模式和错误码。SDK 将 vega 错误码（如 `VegaBackend.InvalidRequestHeader.ContentType`）映射为对应的 Python/TS 异常。

## 熵减：泛型模型资源

6 个 Vega 资源（`metric_models`、`event_models`、`trace_models`、`data_views`、`data_dicts`、`objective_models`）共享完全相同的模式：对同一个 mdl-data-model 服务执行 `list()` + `get()`，仅路径和返回类型不同。用一个**泛型 `VegaModelResource`** 基类消除重复：

```python
class VegaModelResource(Generic[T]):
    """mdl-data-model 资源的泛型 list/get 基类。"""

    def __init__(self, http: HttpClient, path: str, parse_fn: Callable[[Any], T]) -> None:
        self._http = http
        self._path = path          # 如 "/api/mdl-data-model/v1/metric-models"
        self._parse = parse_fn

    def list(self, *, limit: int = 20, offset: int = 0, **params) -> list[T]: ...
    def get(self, id: str) -> T: ...
    def get_batch(self, ids: list[str]) -> list[T]: ...
```

有额外方法的资源（如 `metric_models.fields()`、`trace_models.field_info()`、`data_dicts.items()`）继承基类并只添加差异部分：

```python
class VegaMetricModelsResource(VegaModelResource[VegaMetricModel]):
    def __init__(self, http):
        super().__init__(http, "/api/mdl-data-model/v1/metric-models", _parse_metric_model)

    def fields(self, ids: str) -> list[dict]: ...
    def order_fields(self, ids: str) -> list[dict]: ...
```

CLI 命令同样使用共享的 `register_model_commands()` 工厂函数，每个模型的特有子命令以声明式方式添加。

减少量：
- SDK 资源文件：12 → 7（catalogs、resources、connector_types、**models**、query、tasks、inspect）
- CLI 文件：11 → 7（catalog、resource、connector_type、**model**、query、task、trace+inspect）
- 单元测试文件：参数化覆盖模型注册表，不再逐资源重复
- TypeScript：相同模式，`VegaModelResource<T>` 泛型类

## 项目结构

### Python

引入 `resources/vega/` 作为**子包** — 这是代码库中的新模式。这是有意为之的：Vega 有多个资源文件，如果与现有 KWeaver 资源平铺在 `resources/` 中会造成命名空间混乱。`vega/` 子包清晰地界定了 Vega 特有代码的范围。

```
packages/python/src/kweaver/
├── resources/vega/           # 新增子包
│   ├── __init__.py           # 导出 VegaNamespace
│   ├── _base.py              # VegaModelResource 泛型基类
│   ├── catalogs.py           # CatalogsResource（自定义 — 包含 health、discover、test_connection）
│   ├── resources.py          # ResourcesResource（自定义 — 包含 data 查询）
│   ├── connector_types.py    # ConnectorTypesResource（自定义 — 不同服务路径）
│   ├── models.py             # 所有 6 个模型资源，通过 VegaModelResource 子类实现
│   ├── query.py              # VegaQueryResource（DSL、PromQL、trace、events、execute）
│   ├── tasks.py              # 统一：discover + metric + event 任务
│   └── inspect.py            # health()、stats()、inspect() 方法
├── cli/vega/                 # 新增子包
│   ├── __init__.py
│   ├── main.py               # `kweaver vega` 命令组入口
│   ├── catalog.py            # catalog 子命令
│   ├── resource.py           # resource 子命令
│   ├── connector_type.py     # connector-type 子命令
│   ├── model.py              # 所有模型子命令（工厂注册）
│   ├── query.py              # query 子命令
│   ├── task.py               # task 子命令
│   ├── trace.py              # trace 诊断子命令
│   └── formatters.py         # md/json/yaml 输出格式化
├── types.py                  # 扩展 Vega* 类型
└── _client.py                # 扩展 self.vega: VegaNamespace
```

### TypeScript

现有 TS SDK 使用 `resources/` 存放资源类，`api/` 存放底层 API 函数。Vega 遵循相同的分层：

```
packages/typescript/src/
├── resources/vega/           # 新增子目录
│   ├── index.ts              # 导出 VegaNamespace
│   ├── base.ts               # VegaModelResource<T> 泛型基类
│   ├── catalogs.ts
│   ├── resources.ts
│   ├── connector-types.ts
│   ├── models.ts             # 所有 6 个模型资源
│   ├── query.ts
│   ├── tasks.ts
│   └── inspect.ts
├── api/vega/                 # 新增 — 底层 API 函数
│   ├── catalogs.ts
│   ├── resources.ts
│   ├── query.ts
│   └── models.ts
├── commands/vega/            # 新增子目录
│   ├── index.ts
│   ├── catalog.ts
│   ├── resource.ts
│   ├── connector-type.ts
│   ├── model.ts              # 工厂注册的模型命令
│   ├── query.ts
│   ├── task.ts
│   └── trace.ts
├── types/vega.ts             # Vega 类型接口
└── client.ts                 # 扩展 vega: VegaNamespace
```

## 能力矩阵

| 领域 | 能力 | SDK | CLI |
|------|------|-----|-----|
| **元数据** | Catalog 列表/详情/健康检查/测试连接/发现 | `vega.catalogs.*` | `vega catalog *` |
| | Resource 列表/详情/数据查询 | `vega.resources.*` | `vega resource *` |
| | Connector-Type 列表/详情 | `vega.connector_types.*` | `vega connector-type *` |
| **模型** | Metric-Model 列表/详情/字段 | `vega.metric_models.*` | `vega metric-model *` |
| | Event-Model 列表/详情/级别 | `vega.event_models.*` | `vega event-model *` |
| | Trace-Model 列表/详情/字段/调用链 | `vega.trace_models.*` | `vega trace-model *` |
| | Data-View 列表/详情/分组 | `vega.data_views.*` | `vega data-view *` |
| | Data-Dict 列表/详情/条目 | `vega.data_dicts.*` | `vega data-dict *` |
| | Objective-Model 列表/详情 | `vega.objective_models.*` | `vega objective-model *` |
| **查询** | DSL 搜索/计数/滚动 | `vega.query.dsl*()` | `vega query dsl*` |
| | PromQL 范围/即时/序列 | `vega.query.promql*()` | `vega query promql*` |
| | 指标模型数据 | `vega.query.metric_model()` | `vega query metric-model` |
| | 数据视图查询 | `vega.query.data_view()` | `vega query data-view` |
| | Trace 查询 | `vega.trace_models.trace()` | `vega query trace` |
| | 事件查询 | `vega.query.events()` | `vega query events` |
| | Execute 统一查询 | `vega.query.execute()` | `vega query execute` |
| **观测-状态** | Catalog 健康巡检 | `vega.catalogs.health_report()` | `vega catalog health --all` |
| | Discover 任务等待 | `vega.tasks.wait_discover()` | `vega catalog discover --wait` |
| | 任务监控 | `vega.tasks.*()` | `vega task list/get` |
| | 服务健康检查 | `vega.health()` | `vega health` |
| **观测-诊断** | 查询基准测试 | — | `vega query bench` |
| | Trace 详情 | `vega.trace_models.trace()` | `vega trace show` |
| | Trace 调用链 | `vega.trace_models.spans()` | `vega trace spans` |
| | 关联日志 | `vega.trace_models.related_logs()` | `vega trace related-logs` |
| | 平台统计 | `vega.stats()` | `vega stats` |
| | 聚合诊断 | `vega.inspect()` | `vega inspect` |
| **输出** | Markdown / JSON / YAML | — | `--format md\|json\|yaml` |

## 测试计划

测试遵循 kweaver-sdk 现有规范：**单元测试**（mock HTTP，快速）+ **e2e 测试**（真实 Vega 实例，真正的质量关卡）。Python 和 TypeScript 必须有等价覆盖。

### 测试基础设施

#### E2E 环境

E2E 测试需要运行中的 Vega 实例。通过环境变量配置（从 `~/.env.secrets` 自动加载）：

```bash
# 必需
KWEAVER_VEGA_URL=http://vega-backend:13014

# 复用已有认证（已在 ~/.env.secrets 中）
KWEAVER_BASE_URL=...
KWEAVER_TOKEN=...
```

**Python**：扩展 `tests/e2e/conftest.py`，将 `KWEAVER_VEGA_URL` 读入 e2e 环境注册表。添加 `vega_client` fixture（session 作用域），返回 `client.vega`，若 `KWEAVER_VEGA_URL` 未设置则自动跳过。

**TypeScript**：扩展 `test/e2e/setup.ts` 的 `getE2eEnv()`，包含从 `KWEAVER_VEGA_URL` 读取的 `vegaUrl`。

#### 共享 Fixtures（Python）

```python
# tests/e2e/conftest.py — 新增 fixtures

@pytest.fixture(scope="session")
def vega_client(kweaver_client) -> VegaNamespace:
    """Vega 命名空间，未配置 KWEAVER_VEGA_URL 时跳过。"""
    if not hasattr(kweaver_client, "vega") or kweaver_client.vega is None:
        pytest.skip("KWEAVER_VEGA_URL not configured")
    return kweaver_client.vega

@pytest.fixture(scope="module")
def any_catalog(vega_client) -> VegaCatalog:
    """第一个可用的 catalog，无数据时跳过。"""
    cats = vega_client.catalogs.list(limit=1)
    if not cats:
        pytest.skip("No catalogs available")
    return cats[0]

@pytest.fixture(scope="module")
def any_resource(vega_client, any_catalog) -> VegaResource:
    """任意 catalog 中第一个可用的 resource。"""
    resources = vega_client.resources.list(catalog_id=any_catalog.id, limit=1)
    if not resources:
        pytest.skip("No resources available")
    return resources[0]
```

### 单元测试

单元测试使用 mock HTTP 传输层（现有 `make_client` + `RequestCapture` 模式）。每个 SDK 方法必须有单元测试验证：
1. 正确的 HTTP 方法和端点路径
2. 查询参数 / 请求体序列化
3. 响应解析为类型化 Pydantic 模型

#### Python：`tests/unit/test_vega.py`

单个测试文件，利用参数化覆盖 6 个泛型模型资源：

```python
# ── 泛型模型资源（参数化）──────────────────────────────────────────

MODEL_RESOURCES = [
    ("metric_models",    "/api/mdl-data-model/v1/metric-models",    VegaMetricModel),
    ("event_models",     "/api/mdl-data-model/v1/event-models",     VegaEventModel),
    ("trace_models",     "/api/mdl-data-model/v1/trace-models",     VegaTraceModel),
    ("data_views",       "/api/mdl-data-model/v1/data-views",       VegaDataView),
    ("data_dicts",       "/api/mdl-data-model/v1/data-dicts",       VegaDataDict),
    ("objective_models", "/api/mdl-data-model/v1/objective-models",  VegaObjectiveModel),
]

@pytest.mark.parametrize("attr,path,model_cls", MODEL_RESOURCES)
def test_model_list(attr, path, model_cls, capture):
    handler = mock_list_response(path)
    client = make_vega_client(handler, capture)
    result = getattr(client.vega, attr).list()
    assert capture.last_request().url.path == path
    assert all(isinstance(r, model_cls) for r in result)

@pytest.mark.parametrize("attr,path,model_cls", MODEL_RESOURCES)
def test_model_get(attr, path, model_cls, capture):
    handler = mock_get_response(path)
    client = make_vega_client(handler, capture)
    result = getattr(client.vega, attr).get("id-1")
    assert f"{path}/id-1" in capture.last_request().url.path

# ── 自定义资源（逐个测试）──────────────────────────────────────────

def test_catalog_list(capture): ...
def test_catalog_get(capture): ...
def test_catalog_health_status(capture): ...
def test_catalog_health_report(capture): ...       # 验证组合操作：list → health_status
def test_catalog_test_connection(capture): ...
def test_catalog_discover(capture): ...
def test_catalog_resources(capture): ...

def test_resource_list(capture): ...
def test_resource_get(capture): ...
def test_resource_data(capture): ...

def test_connector_type_list(capture): ...
def test_connector_type_get(capture): ...

# 模型特有扩展
def test_metric_model_fields(capture): ...
def test_metric_model_order_fields(capture): ...
def test_trace_model_field_info(capture): ...
def test_trace_model_trace(capture): ...
def test_data_dict_items(capture): ...
def test_data_view_groups(capture): ...
def test_event_model_levels(capture): ...

# 查询
def test_query_dsl(capture): ...
def test_query_dsl_count(capture): ...
def test_query_dsl_scroll(capture): ...
def test_query_promql(capture): ...                 # 验证 form-encoded content-type
def test_query_promql_instant(capture): ...
def test_query_promql_series(capture): ...
def test_query_metric_model(capture): ...
def test_query_data_view(capture): ...
def test_query_events(capture): ...
def test_query_event(capture): ...
def test_query_execute(capture): ...

# 任务
def test_task_list_discover(capture): ...
def test_task_get_discover(capture): ...
def test_task_wait_discover_polls_until_complete(capture): ...
def test_task_get_metric(capture): ...

# 健康 / 统计 / 诊断
def test_health(capture): ...
def test_stats_composite(capture): ...              # 验证多个内部调用
def test_inspect_composite(capture): ...
def test_inspect_partial_failure(capture): ...      # 验证子调用失败时的部分结果
```

#### Python：`tests/unit/test_vega_cli.py`

CLI 测试使用 `CliRunner`（现有模式）。关注点：
1. 命令调用 → SDK 方法被正确调用
2. 输出格式：`--format md` 产生有效 Markdown 表格，`--format json` 产生有效 JSON

```python
# 模型命令参数化
@pytest.mark.parametrize("model_name", ["metric-model", "event-model", "trace-model", "data-view", "data-dict", "objective-model"])
def test_model_list_cli(model_name, cli_runner, mock_vega):
    result = cli_runner.invoke(["vega", model_name, "list"])
    assert result.exit_code == 0

# 格式测试
def test_catalog_list_format_json(cli_runner, mock_vega): ...
def test_catalog_list_format_md(cli_runner, mock_vega): ...
def test_inspect_output(cli_runner, mock_vega): ...
```

#### TypeScript：`test/vega.test.ts` 和 `test/vega-cli.test.ts`

镜像 Python 结构。使用 `withFetch()` mock 模式：

```typescript
// 参数化模型测试
for (const [attr, path] of MODEL_RESOURCES) {
  test(`vega ${attr} list`, async () => {
    await withFetch(mockListHandler(path), async () => {
      const client = new KWeaverClient({ vegaUrl: "http://localhost:13014", ... });
      const result = await client.vega[attr].list();
      assert.ok(Array.isArray(result));
    });
  });
}
```

### E2E 测试

E2E 测试针对真实 Vega 实例验证。它们是**真正的质量关卡** — 仅靠单元测试验证端点路径、认证头和响应解析是无意义的。

#### 测试组织

```
tests/e2e/
├── conftest.py                    # 扩展：vega_client、any_catalog、any_resource fixtures
├── layer/
│   ├── test_vega_metadata.py      # catalog、resource、connector-type 读取操作
│   ├── test_vega_models.py        # 所有 6 种模型类型 — 参数化
│   ├── test_vega_query.py         # DSL、PromQL、execute、data-view、metric-model 查询
│   └── test_vega_observability.py # health、stats、inspect、tasks、trace
└── integration/
    └── test_vega_lifecycle.py     # discover → 查询 → 验证（破坏性）
```

TypeScript：
```
test/e2e/
├── setup.ts                       # 扩展：vegaUrl、shouldSkipVega()
├── vega-metadata.test.ts
├── vega-models.test.ts
├── vega-query.test.ts
├── vega-observability.test.ts
└── vega-lifecycle.test.ts
```

#### Layer 测试（只读，`@pytest.mark.e2e`）

这些测试针对已有 Vega 数据进行只读操作。无数据时自动跳过。

**`test_vega_metadata.py`**：

```python
@pytest.mark.e2e
class TestVegaCatalogs:
    def test_list(self, vega_client):
        cats = vega_client.catalogs.list()
        assert isinstance(cats, list)
        if cats:
            assert isinstance(cats[0], VegaCatalog)

    def test_get(self, vega_client, any_catalog):
        cat = vega_client.catalogs.get(any_catalog.id)
        assert cat.id == any_catalog.id

    def test_health_status(self, vega_client, any_catalog):
        statuses = vega_client.catalogs.health_status([any_catalog.id])
        assert len(statuses) == 1
        assert statuses[0].health_status in ("healthy", "degraded", "unhealthy", "offline", "disabled")

    def test_health_report(self, vega_client):
        report = vega_client.catalogs.health_report()
        assert isinstance(report, VegaHealthReport)
        assert report.healthy_count + report.degraded_count + report.unhealthy_count + report.offline_count == len(report.catalogs)

    def test_resources(self, vega_client, any_catalog):
        resources = vega_client.catalogs.resources(any_catalog.id)
        assert isinstance(resources, list)

    def test_test_connection(self, vega_client, any_catalog):
        # test_connection 是安全的（只读探测）
        result = vega_client.catalogs.test_connection(any_catalog.id)
        assert result is not None

@pytest.mark.e2e
class TestVegaResources:
    def test_list(self, vega_client):
        resources = vega_client.resources.list(limit=5)
        assert isinstance(resources, list)

    def test_get(self, vega_client, any_resource):
        r = vega_client.resources.get(any_resource.id)
        assert r.id == any_resource.id
        assert r.category in ("table", "index", "dataset", "metric", "topic", "file", "fileset", "api", "logicview")

@pytest.mark.e2e
class TestVegaConnectorTypes:
    def test_list(self, vega_client):
        types = vega_client.connector_types.list()
        assert isinstance(types, list)
        assert len(types) > 0  # 至少存在内置类型
```

**`test_vega_models.py`** — 按模型类型参数化：

```python
MODEL_ATTRS = ["metric_models", "event_models", "trace_models", "data_views", "data_dicts", "objective_models"]

@pytest.mark.e2e
@pytest.mark.parametrize("attr", MODEL_ATTRS)
def test_model_list(vega_client, attr):
    result = getattr(vega_client, attr).list(limit=5)
    assert isinstance(result, list)

@pytest.mark.e2e
@pytest.mark.parametrize("attr", MODEL_ATTRS)
def test_model_get(vega_client, attr):
    items = getattr(vega_client, attr).list(limit=1)
    if not items:
        pytest.skip(f"No {attr} available")
    item = getattr(vega_client, attr).get(items[0].id)
    assert item.id == items[0].id

# 模型特有扩展
@pytest.mark.e2e
def test_metric_model_fields(vega_client):
    models = vega_client.metric_models.list(limit=1)
    if not models:
        pytest.skip("No metric models")
    fields = vega_client.metric_models.fields(models[0].id)
    assert isinstance(fields, list)

@pytest.mark.e2e
def test_data_dict_items(vega_client):
    dicts = vega_client.data_dicts.list(limit=1)
    if not dicts:
        pytest.skip("No data dicts")
    items = vega_client.data_dicts.items(dicts[0].id)
    assert isinstance(items, list)
```

**`test_vega_query.py`**：

```python
@pytest.mark.e2e
class TestVegaQuery:
    def test_execute(self, vega_client, any_resource):
        """针对已知资源的统一查询。"""
        result = vega_client.query.execute(
            tables=[{"resource_id": any_resource.id}],
            output_fields=["*"],
            limit=5,
        )
        assert isinstance(result, VegaQueryResult)

    def test_dsl_search(self, vega_client):
        """DSL 搜索 — 需要至少一个 index 资源。"""
        result = vega_client.query.dsl(body={"query": {"match_all": {}}, "size": 1})
        assert isinstance(result, VegaDslResult)

    def test_promql_instant(self, vega_client):
        """PromQL 即时查询 — 无 Prometheus 数据源时可能跳过。"""
        try:
            result = vega_client.query.promql_instant(query="up")
            assert isinstance(result, VegaPromqlResult)
        except VegaQueryError:
            pytest.skip("No PromQL-compatible data source")
```

**`test_vega_observability.py`**：

```python
@pytest.mark.e2e
class TestVegaHealth:
    def test_health(self, vega_client):
        info = vega_client.health()
        assert isinstance(info, VegaServerInfo)
        assert info.server_name
        assert info.server_version

    def test_stats(self, vega_client):
        stats = vega_client.stats()
        assert isinstance(stats, VegaPlatformStats)
        assert stats.catalogs_total >= 0

    def test_inspect(self, vega_client):
        report = vega_client.inspect()
        assert isinstance(report, VegaInspectReport)
        assert report.server_info.server_name

@pytest.mark.e2e
class TestVegaTasks:
    def test_list_discover(self, vega_client):
        tasks = vega_client.tasks.list_discover()
        assert isinstance(tasks, list)
```

#### 集成测试（破坏性，`@pytest.mark.e2e @pytest.mark.destructive`）

全生命周期测试，创建真实数据并端到端验证读取路径。

**`test_vega_lifecycle.py`**：

```python
@pytest.fixture(scope="module")
def vega_lifecycle(vega_client):
    """
    生命周期：
    1. 找到健康状态的 catalog
    2. 触发 discover
    3. 等待 discover 完成
    4. 验证已发现的资源
    5. 查询资源数据
    """
    cats = vega_client.catalogs.list(limit=10)
    healthy = [c for c in cats if c.health_status == "healthy"]
    if not healthy:
        pytest.skip("No healthy catalog for lifecycle test")

    catalog = healthy[0]

    # 触发 discover（破坏性 — 创建 discover 任务）
    task = vega_client.catalogs.discover(catalog.id)

    # 等待完成
    final = vega_client.tasks.wait_discover(task.id, timeout=120)

    # 列出已发现的资源
    resources = vega_client.catalogs.resources(catalog.id, limit=50)

    yield {
        "catalog": catalog,
        "task": final,
        "resources": resources,
    }

    # 清理：无需删除 catalog/resource（discover 是幂等的），
    # 但记录完成日志以便追溯
    import logging
    logging.getLogger(__name__).info(f"lifecycle fixture teardown: catalog={catalog.id}, task={final.id}")

@pytest.mark.e2e
@pytest.mark.destructive
class TestVegaLifecycle:
    def test_discover_completed(self, vega_lifecycle):
        assert vega_lifecycle["task"].status == "completed"

    def test_resources_discovered(self, vega_lifecycle):
        assert len(vega_lifecycle["resources"]) > 0

    def test_resource_data_query(self, vega_client, vega_lifecycle):
        resources = vega_lifecycle["resources"]
        # 找一个 table 资源来查询
        tables = [r for r in resources if r.category == "table"]
        if not tables:
            pytest.skip("No table resources discovered")
        result = vega_client.resources.data(tables[0].id, body={})
        assert result is not None
```

#### CLI E2E 测试

CLI e2e 测试验证完整调用链：CLI → SDK → HTTP → 真实 Vega：

```python
@pytest.mark.e2e
class TestVegaCLI:
    def test_health(self, cli_runner):
        result = cli_runner.invoke(["vega", "health"])
        assert result.exit_code == 0
        assert "VEGA" in result.output

    def test_catalog_list(self, cli_runner):
        result = cli_runner.invoke(["vega", "catalog", "list"])
        assert result.exit_code == 0

    def test_catalog_list_json(self, cli_runner):
        result = cli_runner.invoke(["vega", "catalog", "list", "--format", "json"])
        assert result.exit_code == 0
        data = json.loads(result.output)
        assert isinstance(data, list)

    def test_inspect(self, cli_runner):
        result = cli_runner.invoke(["vega", "inspect"])
        assert result.exit_code == 0
        assert "Catalog" in result.output

    def test_stats(self, cli_runner):
        result = cli_runner.invoke(["vega", "stats"])
        assert result.exit_code == 0
```

### 测试执行

```bash
# 单元测试（无需 Vega 实例）
make test                                    # 运行所有单元测试（Python + TS）

# E2E — 只读 layer（需要运行中的 Vega）
KWEAVER_VEGA_URL=http://vega:13014 make test-e2e

# E2E — 全生命周期（需要运行中的 Vega + 可写 catalog）
KWEAVER_VEGA_URL=http://vega:13014 pytest tests/e2e/ --run-destructive

# TypeScript E2E
KWEAVER_VEGA_URL=http://vega:13014 npm run test:e2e
```

### 覆盖率目标

| 层级 | 目标 | 说明 |
|------|------|------|
| Python 单元 | vega 资源 90%+ | 参数化测试自动覆盖所有模型类型 |
| Python e2e layer | 所有 list/get/health 操作 | 只读，可重复安全运行 |
| Python e2e 集成 | Discover → 查询生命周期 | 需要 `--run-destructive` |
| TypeScript 单元 | 与 Python 对齐 | 相同参数化模式 |
| TypeScript e2e | 与 Python 对齐 | 相同场景 |
| CLI 单元 | 所有命令，md 和 json 两种格式 | CliRunner / runCli |
| CLI e2e | health、catalog list、inspect、stats | 针对真实实例的冒烟测试 |

### 测试核心原则

1. **E2E 是真正的质量关卡** — 单元测试验证接线，e2e 验证现实。端点路径写错但单元测试通过，比没有测试更糟。
2. **参数化，不复制** — 6 个模型资源共享一套参数化测试集，不是 6 份复制粘贴的测试文件。
3. **优雅跳过而非强制失败** — 如果 Vega 实例没有指标模型，跳过 `test_metric_model_fields`，不要失败。
4. **仅使用外部端点** — SDK 必须使用 `/api/vega-backend/v1/` 路径，绝不使用 `/api/vega-backend/in/v1/` 内部路径。
5. **破坏性测试后清理** — 生命周期 fixtures 使用 yield + teardown，带时间戳的命名实现隔离。
