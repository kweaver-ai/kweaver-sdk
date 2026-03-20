# BKN 完备读取操作与可观测能力设计

**Date:** 2026-03-20
**Status:** Draft

---

## 1 背景

BKN（Business Knowledge Network）是 KWeaver 的本体引擎，通过 `bkn-backend`（端口 13014）和 `ontology-query`（端口 13018）两个微服务提供 50+ REST 端点。当前 kweaver-sdk 已覆盖核心的 CRUD 和查询操作，但存在两类缺口：

1. **读取操作不完整** — Concept Groups、Jobs/Tasks、Action Schedules、Relation Type Paths 等 BKN 原生能力在 SDK/CLI 中完全缺失；已有的 Object Type / Relation Type / Action Type 读取也缺少深度内省（mapping rules、完整属性配置等）。
2. **可观测能力薄弱** — 当前仅有基础的 `log_requests` 开关和错误 trace_id 捕获，缺少客户端 metrics、审计日志、trace 传播、schema diff 等生产级可观测手段。

本文档设计补齐这两类能力所需的 SDK Resource、CLI 命令和可观测基础设施。

---

## 2 设计原则

沿用现有四层架构（Skill → CLI → SDK → HTTP），新增能力遵守：

| 原则 | 说明 |
|------|------|
| 面向意图，而非端点 | SDK 方法按用户/Agent 的操作意图设计，不是 REST 端点的 1:1 翻译（见 §2.2） |
| CLI 按场景编排 | CLI 命令面向完整工作流，可编排多个 SDK 调用，对 AI Agent 友好（JSON 输出 + 语义化命令名） |
| 可观测零侵入 | Metrics / audit / trace 通过 HTTP 层 middleware 实现，Resource 层无感知 |
| 渐进式启用 | 所有可观测能力默认关闭，通过 `KWeaverClient` 构造参数或 CLI flag 开启 |
| 与 Vega 共享基础设施 | Middleware、输出格式化、CLI 全局 flag 等公共能力设计一次，双方复用 |

### 2.2 SDK API 设计层次

SDK 不是 REST 的透明代理。API 按三个层次设计，越高层离用户意图越近：

```
Layer 3 — 意图方法（面向场景）
  inspect(), diff(), clone(), build(wait=True)
  调用方不需要知道底层有几个 REST 端点

Layer 2 — 领域方法（面向实体生命周期）
  create(), get(), list(), update(), delete()
  比 REST 更智能：幂等创建、名称解析、自动补全字段

Layer 1 — HTTP 原语（面向调试）
  _http.request()，仅通过 debug=True 暴露
```

**已有先例**（当前代码库已在实践这些模式）：

| 模式 | 已有实现 | 说明 |
|------|---------|------|
| 幂等创建 | `knowledge_networks.create()` 捕获"已存在"错误 | Layer 2：调用方不必先 `list()` 再判断 |
| 异步轮询 | `BuildJob.wait()`, `ActionExecution.wait()` | Layer 3：隐藏 poll 循环 |
| 自动发现 | `datasources.list_tables()` 自动触发 `scan_metadata()` | Layer 3：一个调用完成"确保元数据就绪 + 返回表列表" |
| 名称解析 | CLI `action execute` 按 name 查找 action | Layer 2：用户用名称，SDK 解析为 ID |
| 多步编排 | CLI `bkn create` = 创建 dataview + KN + OT + build | Layer 3：一个命令完成完整的 KN 搭建 |
| 字段自动补全 | `object_types.create()` 自动从 dataview 填充 `data_properties` | Layer 2：减少调用方的认知负担 |

**新增能力应遵循同样的模式**，而非退化为 CRUD wrapper。具体体现：

| 新增方法 | 层次 | 超越 CRUD 的部分 |
|---------|------|----------------|
| `inspect(kn_id)` | L3 | 并发调用 health + stats + jobs，聚合为一站式报告 |
| `diff(kn_id, from_file)` | L3 | 自动 export 当前状态（如无 `to_file`），本地解析 + 对比 |
| `import_bkn(file)` | L2 | 上传 + 返回结构化 summary（含 created/updated/failed 分类） |
| `jobs.wait()` | L3 | 指数退避轮询，超时抛异常，调用方只关心最终结果 |
| `concept_groups.create()` | L2 | 支持 `object_type_names=["Pod", "Node"]`（名称解析，非只接受 ID） |

**Agent 友好设计要点**：
- 方法名是动词 + 名词，语义自解释（`inspect` 而非 `get_aggregated_status`）
- 返回类型是结构化 Pydantic model，Agent 可直接解析字段
- 错误信息包含足够上下文让 Agent 自主重试或调整（trace_id、error_code、建议操作）
- `list()` 返回值自带 total_count，Agent 不需要额外请求判断是否有下一页

### 2.1 与 Vega 设计的一致性约定

BKN 和 Vega 同属 kweaver-sdk 扩展，共享同一个 `KWeaverClient`、`HttpClient`、CLI 入口。以下明确公共 vs 独立的边界：

| 层面 | 公共（设计一次，双方复用） | 独立（各自设计） |
|------|--------------------------|-----------------|
| **类型系统** | 统一用 Pydantic `BaseModel`（与现有代码一致） | 各自定义领域类型（`BKNInspectReport` vs `VegaInspectReport`） |
| **HTTP Middleware** | metrics / audit / trace / debug / dry-run 在 `_middleware/` 实现，对所有 HttpClient 实例生效 | — |
| **CLI 全局 flag** | `--debug` / `--dry-run` / `--audit-log` / `--format`（默认 md） / `--vega-url` 统一在 `cli/main.py` 定义 | — |
| **CLI 约定** | 动词、名词、分页、删除确认、异步等待等统一规则（见 `sdk-observability-infra.md` §6.5） | — |
| **输出格式化** | `cli/_helpers.py` 的 `output(data, format="md")` 函数，支持 md/json/yaml | 各命令组的 Markdown 表格模板不同 |
| **错误层级** | `KWeaverError` 基类 + 通用子类（401/403/404/5xx） | `BKNError(KWeaverError)` 和 `VegaError(KWeaverError)` 各自扩展 |
| **`make_client()`** | 一个函数，同时读取 `KWEAVER_VEGA_URL` 和可观测 flag | — |
| **Namespace** | BKN resources 平铺在 `client.*`（BKN 是主服务，共用 `base_url`）；Vega 用 `client.vega.*` 子命名空间（独立 `vega_url`） | 各自的 Resource 类 |
| **`inspect()` 模式** | 复合方法 pattern：并发调用 + 部分失败容忍 + 返回聚合报告 | 报告内容和类型各自不同 |

> **关键差异说明**：BKN resources 不使用子命名空间是因为 BKN（ontology-manager + ontology-query）与 KWeaver 主平台共用同一个 `base_url`，请求通过路径前缀 `/api/ontology-manager/v1/` 和 `/api/ontology-query/v1/` 区分。而 Vega 有独立的 `vega_url`，需要单独的 `HttpClient` 实例，因此用 `client.vega.*` 隔离。

---

## 3 读取操作：缺失实体

### 3.1 Concept Groups（概念组）

BKN 端点（`bkn-backend`）：

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/knowledge-networks/:kn_id/concept-groups` | 创建 |
| GET | `/knowledge-networks/:kn_id/concept-groups` | 列表 |
| GET | `/knowledge-networks/:kn_id/concept-groups/:cg_id` | 详情 |
| PUT | `/knowledge-networks/:kn_id/concept-groups/:cg_id` | 更新 |
| DELETE | `/knowledge-networks/:kn_id/concept-groups/:cg_id` | 删除 |
| POST | `/knowledge-networks/:kn_id/concept-groups/:cg_id/object-types` | 添加成员 |
| DELETE | `/knowledge-networks/:kn_id/concept-groups/:cg_id/object-types/:ot_ids` | 移除成员 |

**SDK — `ConceptGroupsResource`**

新增文件 `packages/python/src/kweaver/resources/concept_groups.py`：

```python
class ConceptGroupsResource:
    def create(
        self, kn_id: str, *, name: str,
        object_type_ids: list[str] | None = None,    # 直接关联（按 ID）
        object_type_names: list[str] | None = None,   # 按名称解析后关联
    ) -> ConceptGroup: ...
    def list(self, kn_id: str, *, offset: int = 0, limit: int = 20) -> list[ConceptGroup]: ...
    def get(self, kn_id: str, cg_id: str) -> ConceptGroup: ...
    def update(self, kn_id: str, cg_id: str, *, name: str | None = None) -> ConceptGroup: ...
    def delete(self, kn_id: str, cg_ids: list[str]) -> None: ...
    def add_members(self, kn_id: str, cg_id: str, *, object_type_ids: list[str]) -> None: ...
    def remove_members(self, kn_id: str, cg_id: str, *, object_type_ids: list[str]) -> None: ...
```

> `create()` 支持 `object_type_names` 是 Layer 2 的体现：内部先 `object_types.list()` 解析名称到 ID，再一次性创建 + 添加成员。Agent 和用户可以用自然的名称而非记忆 ID。

**CLI — `kweaver bkn concept-group`**

```bash
# 不带子命令 = 数据总览（见 sdk-observability-infra.md §6.3）
kweaver bkn concept-group                                     # = list（使用 kweaver use 上下文）
kweaver bkn concept-group list [<kn_id>] [--limit 20] [--offset 0]
kweaver bkn concept-group get [<kn_id>] <cg_id>
kweaver bkn concept-group create [<kn_id>] --name <name>
kweaver bkn concept-group update [<kn_id>] <cg_id> --name <name>
kweaver bkn concept-group delete [<kn_id>] <cg_ids> [--yes, -y]
kweaver bkn concept-group add-members [<kn_id>] <cg_id> <ot_id1,ot_id2,...>
kweaver bkn concept-group remove-members [<kn_id>] <cg_id> <ot_id1,ot_id2,...>
```

> `[<kn_id>]` 为可选位置参数，省略时从 `kweaver use` 上下文读取。所有 BKN 命令同理（下同）。

**类型定义**（`kweaver/types.py`）：

```python
class ConceptGroup(BaseModel):
    id: str
    name: str
    kn_id: str
    branch: str = "main"
    object_type_ids: list[str] = []
    creator: str | None = None
    updater: str | None = None
    create_time: str | None = None
    update_time: str | None = None
```

### 3.2 Jobs & Tasks（后台任务）

BKN 端点（`bkn-backend`）：

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/knowledge-networks/:kn_id/jobs` | 创建 |
| GET | `/knowledge-networks/:kn_id/jobs` | 列表 |
| GET | `/knowledge-networks/:kn_id/jobs/:job_id/tasks` | 获取任务列表 |
| DELETE | `/knowledge-networks/:kn_id/jobs/:job_ids` | 删除 |

**SDK — `JobsResource`**

新增文件 `packages/python/src/kweaver/resources/jobs.py`：

```python
class JobsResource:
    def create(self, kn_id: str, *, type: str, params: dict[str, Any] | None = None) -> Job: ...
    def list(self, kn_id: str, *, status: str | None = None, offset: int = 0, limit: int = 20) -> list[Job]: ...
    def get_tasks(self, kn_id: str, job_id: str) -> list[Task]: ...
    def delete(self, kn_id: str, job_ids: list[str]) -> None: ...
    def wait(self, kn_id: str, job_id: str, *, timeout: float = 300, interval: float = 2.0) -> Job: ...
```

`wait()` 轮询 job 状态直到终态（completed / failed），复用现有 build polling 模式。使用指数退避策略：初始间隔 `interval`，每次翻倍，上限 30 秒。避免长任务下产生过多无用请求。

**CLI — `kweaver bkn job`**

```
kweaver bkn job                                               # = list
kweaver bkn job list [<kn_id>] [--status running|completed|failed] [--limit 20] [--offset 0]
kweaver bkn job tasks [<kn_id>] <job_id>
kweaver bkn job delete [<kn_id>] <job_ids> [--yes, -y]
kweaver bkn job wait [<kn_id>] <job_id> [--timeout 300]
```

**类型定义**：

```python
class Job(BaseModel):
    id: str
    kn_id: str
    type: str
    status: str              # pending | running | completed | failed
    progress: float | None = None
    creator: str | None = None
    create_time: str | None = None
    update_time: str | None = None

class Task(BaseModel):
    id: str
    job_id: str
    name: str
    status: str
    error: str | None = None
    create_time: str | None = None
    update_time: str | None = None
```

### 3.3 Action Schedules（定时任务）

BKN 端点（`bkn-backend`）：

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/knowledge-networks/:kn_id/action-schedules` | 创建 |
| GET | `/knowledge-networks/:kn_id/action-schedules` | 列表 |
| GET | `/knowledge-networks/:kn_id/action-schedules/:id` | 详情 |
| PUT | `/knowledge-networks/:kn_id/action-schedules/:id` | 更新 |
| PUT | `/knowledge-networks/:kn_id/action-schedules/:id/status` | 启用/禁用 |
| DELETE | `/knowledge-networks/:kn_id/action-schedules/:ids` | 删除 |

**SDK — `ActionSchedulesResource`**

新增文件 `packages/python/src/kweaver/resources/action_schedules.py`：

```python
class ActionSchedulesResource:
    def create(self, kn_id: str, *, action_type_id: str, cron: str, params: dict | None = None) -> ActionSchedule: ...
    def list(self, kn_id: str, *, offset: int = 0, limit: int = 20) -> list[ActionSchedule]: ...
    def get(self, kn_id: str, schedule_id: str) -> ActionSchedule: ...
    def update(self, kn_id: str, schedule_id: str, *, cron: str | None = None, enabled: bool | None = None, params: dict | None = None) -> ActionSchedule: ...
    def delete(self, kn_id: str, schedule_ids: list[str]) -> None: ...
```

**CLI — `kweaver bkn action-schedule`**

```
kweaver bkn action-schedule                                   # = list
kweaver bkn action-schedule list [<kn_id>] [--limit 20] [--offset 0]
kweaver bkn action-schedule get [<kn_id>] <schedule_id>
kweaver bkn action-schedule create [<kn_id>] --action-type <at_id> --cron "0 */6 * * *"
kweaver bkn action-schedule update [<kn_id>] <schedule_id> [--cron <expr>] [--enabled/--disabled]
kweaver bkn action-schedule delete [<kn_id>] <schedule_ids> [--yes, -y]
```

**类型定义**：

```python
class ActionSchedule(BaseModel):
    id: str
    kn_id: str
    action_type_id: str
    cron: str
    enabled: bool = True
    params: dict[str, Any] = {}
    last_run_time: str | None = None
    next_run_time: str | None = None
    creator: str | None = None
    create_time: str | None = None
    update_time: str | None = None
```

### 3.4 Relation Type Paths（多跳关系路径）

BKN 端点：

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/knowledge-networks/:kn_id/relation-type-paths` | 查询关系路径 |

**SDK** — 扩展现有 `KnowledgeNetworksResource`：

```python
class KnowledgeNetworksResource:
    # ... existing methods ...

    def relation_type_paths(
        self,
        kn_id: str,
        *,
        source_ot_id: str | None = None,
        target_ot_id: str | None = None,
        max_depth: int = 3,
        branch: str = "main",
    ) -> list[RelationTypePath]: ...
```

**CLI**：

```
kweaver bkn relation-type-paths [<kn_id>] [--source-ot <ot_id>] [--target-ot <ot_id>] [--depth 3]
```

**类型定义**：

```python
class RelationTypePath(BaseModel):
    path: list[RelationTypePathStep]   # 有序步骤

class RelationTypePathStep(BaseModel):
    relation_type_id: str
    relation_type_name: str
    source_ot_id: str
    target_ot_id: str
    direction: str                     # direct | bidirectional
```

### 3.5 BKN Import（知识网络导入）

BKN 端点：

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/bkns` | 上传 tar 包导入 |
| GET | `/bkns/:kn_id` | 导出 tar 包（已实现） |

**SDK** — 扩展现有 `KnowledgeNetworksResource`：

```python
class KnowledgeNetworksResource:
    # ... existing methods ...

    def import_bkn(
        self,
        file: str | Path | BinaryIO,
        *,
        overwrite: bool = False,
    ) -> BKNImportResult: ...
```

**CLI**：

```
kweaver bkn import <file.tar|file.tgz> [--overwrite]
```

**类型定义**：

```python
class BKNImportResult(BaseModel):
    kn_id: str
    kn_name: str
    summary: BKNImportSummary

class BKNImportSummary(BaseModel):
    total: int
    created: int
    updated: int
    unchanged: int
    failed: int
    changes: list[BKNDefinitionChange] = []

class BKNDefinitionChange(BaseModel):
    type: str             # object_type | relation_type | action_type | concept_group
    id: str
    name: str
    action: str           # created | updated | unchanged | failed
```

### 3.6 Health & Resources

BKN 端点（两个模块均有）：

| 方法 | 路径 | 模块 | 说明 |
|------|------|------|------|
| GET | `/health` | both | 健康检查 |
| GET | `/resources` | bkn-backend | 资源列表 |

**SDK** — 新增 `SystemResource`（或扩展 HttpClient）：

```python
class SystemResource:
    def health(self) -> list[ServiceHealth]: ...
    def resources(self, *, type: str | None = None) -> list[dict[str, Any]]: ...
```

两个模块的 health 端点路径不同（一个在 `bkn-backend`，一个在 `ontology-query`），SDK 同时请求并汇总。

**实现说明**：BKN 两个模块（`bkn-backend` 和 `ontology-query`）共用同一个 `base_url`，通过路径前缀区分（`/api/ontology-manager/v1/` 和 `/api/ontology-query/v1/`）。因此 `SystemResource` 使用同一个 `HttpClient`，通过不同路径前缀分别请求两个模块的 `/health` 端点，再合并结果。不需要持有多个 `HttpClient` 实例。

**CLI**：

```
kweaver health                         # 聚合入口：BKN + Vega（如已配置 vega_url）健康状态
kweaver health --bkn                   # 仅 BKN 服务
kweaver health --vega                  # 仅 Vega 服务
```

> `kweaver health` 是顶层聚合命令，`kweaver vega health` 保留为 Vega 独立入口。两者的 Vega 部分输出一致。

**类型定义**：

```python
class ServiceHealth(BaseModel):
    service: str           # bkn-backend | ontology-query
    status: str            # healthy | unhealthy
    version: str | None = None
    go_version: str | None = None
    arch: str | None = None
```

---

## 4 读取操作：深度增强

### 4.1 扩展 `get()` 返回完整属性（非新增 describe）

> **简化决策**：不新增 `describe()` 方法。BKN 的 GET 端点本身就返回完整对象（含 data_properties、mapping_rules 等），当前 SDK 的 `get()` 只是没有解析这些字段。正确做法是扩展现有返回类型，用 Optional 字段兼容，避免 API 表面积膨胀。

**Object Type** — 扩展 `ObjectType` 类型，`get()` 方法不变：

```python
class DataPropertyDetail(BaseModel):
    name: str
    display_name: str | None = None
    type: str                   # string | integer | float | boolean | datetime | enum
    indexed: bool = False
    full_text: bool = False
    vector: bool = False
    required: bool = False
    default_value: Any = None
    enum_values: list[str] | None = None
    mapped_field: str | None = None   # 数据源字段映射

class ObjectType(BaseModel):   # 扩展现有类型
    # ... existing fields ...
    data_properties: list[DataPropertyDetail] = []   # NEW — 解析已有的 API 响应字段
```

**Relation Type** — 扩展 `RelationType`：

```python
class MappingRule(BaseModel):
    source_field: str
    target_field: str
    operator: str | None = None

class RelationType(BaseModel):   # 扩展现有类型
    # ... existing fields ...
    mapping_type: str | None = None    # direct | data_view — NEW
    mappings: list[MappingRule] = []   # NEW
```

**Action Type** — 扩展 `ActionType`：

```python
class ActionSource(BaseModel):
    type: str                      # internal | external
    url: str | None = None
    method: str | None = None

class ActionParam(BaseModel):
    name: str
    type: str
    required: bool = False
    default: Any = None
    description: str | None = None

class ActionType(BaseModel):   # 扩展现有类型
    # ... existing fields ...
    source: ActionSource | None = None       # NEW
    parameters: list[ActionParam] = []       # NEW
```

**CLI** — 现有 `get` 命令的 `-v` flag 展示完整字段（`-v` 控制字段详细度，`--format` 控制渲染格式，两者正交。见 `sdk-observability-infra.md` §6.5）：

```
kweaver bkn object-type get <kn_id> <ot_id> -v    # md 格式，含 data_properties 完整配置
kweaver bkn relation-type get <kn_id> <rt_id> -v   # md 格式，含 mapping rules
kweaver bkn action-type get <kn_id> <at_id> -v     # md 格式，含 source, parameters
```

### 4.4 跨类型统一搜索

当前 `query kn-search` 已支持跨 OT/RT/AT 搜索。增加 CLI 端的 `--type` 过滤和详细统计：

```
kweaver query kn-search <kn_id> <query> [--type object_type|relation_type|action_type] [--limit 10]
```

### 4.5 KN 详细统计

扩展现有 `kweaver bkn stats`：

```
kweaver bkn stats [<kn_id>] --detailed
```

输出增加每个 Object Type 的实例数量、索引状态、最近更新时间：

```json
{
  "kn_id": "kn-123",
  "object_types": 5,
  "relation_types": 3,
  "action_types": 2,
  "concept_groups": 1,
  "details": [
    {"type": "object_type", "id": "ot-1", "name": "Pod", "instance_count": 1523, "indexed": true, "last_sync": "2026-03-20T10:30:00Z"},
    {"type": "object_type", "id": "ot-2", "name": "Node", "instance_count": 42, "indexed": true, "last_sync": "2026-03-20T10:30:00Z"}
  ]
}
```

---

## 5 可观测能力

### 5.1 公共基础设施（独立文档）

> Metrics、Audit Log、Trace 传播、Debug、Dry-run 等可观测 middleware 是 HTTP 层公共能力，对 BKN 和 Vega 请求均生效。详细设计见 **`2026-03-20-sdk-observability-infra.md`**。
>
> BKN 文档不重复定义这些 middleware 的类型和实现细节，仅列出 BKN 视角的使用方式。

BKN 相关的使用方式：

```python
client = KWeaverClient(
    auth=ConfigAuth(),
    debug=True,                              # 打印 BKN 请求/响应 + curl
    audit_log="~/.kweaver/audit.jsonl",      # 记录所有 API 调用
    metrics=True,                            # 采集延迟/错误率
    trace_propagation=True,                  # 注入 traceparent → BKN OTEL
)
```

```bash
kweaver --debug bkn object-type list <kn_id>
kweaver --dry-run bkn concept-group create <kn_id> --name test
kweaver --audit-log ./audit.jsonl bkn list
```

### 5.2 Schema Diff（BKN 特有）

利用 BKN 已有的 checksum 机制（`BKNChecksumDiff`、`BKNDefinitionChange`），提供本地 schema 对比能力：

```
kweaver bkn diff [<kn_id>] --from <old.tar> --to <new.tar>
kweaver bkn diff [<kn_id>] --from <old.tar>                 # --to 默认为当前线上状态（自动 export）
```

输出：

```
Schema Diff: k8s-network

  ADDED:
    + object_type: Deployment (ot-new1)
    + relation_type: deployment_manages_pod (rt-new1)

  MODIFIED:
    ~ object_type: Pod (ot-123)
      - data_property added: restart_count (integer)
      - data_property removed: legacy_status

  REMOVED:
    - action_type: deprecated_action (at-old1)

  UNCHANGED: 4 object_types, 1 relation_type, 1 action_type
```

**SDK**：

```python
class KnowledgeNetworksResource:
    def diff(
        self,
        kn_id: str,
        *,
        from_file: str | Path | BinaryIO | None = None,
        to_file: str | Path | BinaryIO | None = None,
    ) -> BKNDiff: ...

class BKNDiff(BaseModel):
    added: list[BKNDefinitionChange]
    modified: list[BKNDefinitionChange]
    removed: list[BKNDefinitionChange]
    unchanged_count: int
```

**实现**：自行解析 tar 包中的 CHECKSUM 文件做对比（不依赖外部 `bkn-specification` SDK，保持零依赖原则；tar 和 JSON 解析仅使用 Python 标准库）。若缺少本地 tar，先调用 `export()` 获取当前状态。

---

## 6 KWeaverClient 接口变更

```python
class KWeaverClient:
    # ... existing __init__ params ...

    # New resource accessors
    @property
    def concept_groups(self) -> ConceptGroupsResource: ...
    @property
    def jobs(self) -> JobsResource: ...
    @property
    def action_schedules(self) -> ActionSchedulesResource: ...
    @property
    def system(self) -> SystemResource: ...

    # Observability params (详见 sdk-observability-infra.md)
    # metrics, audit_log, trace_propagation, debug, dry_run
```

### 错误类型

与 Vega 保持一致，新增 `BKNError` 基类：

```python
class BKNError(KWeaverError):
    """Base for all BKN errors."""

# 当前不细分子类；未来可按需扩展：
# class BKNSchemaConflictError(BKNError): ...
# class BKNImportError(BKNError): ...
```

---

## 7 文件变更清单

### 新增文件

| 文件 | 说明 |
|------|------|
| `resources/concept_groups.py` | ConceptGroupsResource |
| `resources/jobs.py` | JobsResource |
| `resources/action_schedules.py` | ActionSchedulesResource |
| `resources/system.py` | SystemResource (health, resources) |
| `cli/health.py` | health 命令 |

> Middleware 文件（`_middleware/*.py`）、`cli/audit.py` 等属于公共可观测基础设施，在 `sdk-observability-infra.md` 中定义。

### 修改文件

| 文件 | 变更 |
|------|------|
| `types.py` | 扩展 ObjectType/RelationType/ActionType 字段 + 新增 ConceptGroup, Job, Task, ActionSchedule, ServiceHealth, BKNImportResult, BKNDiff 等类型 |
| `_client.py` | 新增 resource accessor（concept_groups, jobs, action_schedules, system） |
| `resources/knowledge_networks.py` | 新增 `relation_type_paths()`, `import_bkn()`, `diff()`, `inspect()` |
| `resources/object_types.py` | 扩展 `get()` 返回类型解析 data_properties 完整字段 |
| `resources/relation_types.py` | 扩展 `get()` 返回类型解析 mapping_type + mappings |
| `resources/action_types.py` | 扩展 `get()` 返回类型解析 source + parameters |
| `cli/main.py` | 注册 health 命令和全局 flag |
| `cli/kn.py` | 新增 concept-group, job, action-schedule, relation-type-paths, import, diff, inspect 子命令 |

---

## 8 实施阶段

### Phase 1 — 补齐实体读取 + 深度解析

- ConceptGroupsResource + CLI
- JobsResource + CLI
- 扩展 OT/RT/AT 的 `get()` 返回类型解析完整字段
- `inspect()` 复合方法 + CLI
- 对应类型定义和单元测试

**验收**：`kweaver bkn concept-group list` / `kweaver bkn job list` / `kweaver bkn object-type get -v` 展示完整 data_properties。

### Phase 2 — 高级读取

- ActionSchedulesResource + CLI
- BKN Import + Schema Diff
- Relation Type Paths
- Health / Resources
- 多格式输出（`--format md|json|yaml`）

**验收**：`kweaver bkn import k8s.tar` 成功导入；`kweaver bkn diff kn-123 --from old.tar` 展示变更。

> 可观测基础设施（middleware 链、debug、audit、metrics、trace）属于公共能力，在 `sdk-observability-infra.md` 中独立排期，不在 BKN 阶段中重复。

---

## 9 折衷与决策记录

| 决策 | 选择 | 备选 | 理由 |
|------|------|------|------|
| 深度属性读取 | 扩展 `get()` 返回类型 | 新增 `describe()` 方法 | BKN GET 端点已返回完整数据，SDK 只需解析更多字段，无需新方法 |
| 可观测 middleware | 拆到独立文档 | 在 BKN 文档中定义 | 公共能力，BKN/Vega 共用，避免重复设计 |
| 错误类型 | 新增 `BKNError(KWeaverError)` 基类 | 复用通用 `KWeaverError` + `error_code` | 与 Vega 保持一致（Vega 已设计 `VegaError` 层级）；`BKNError` 基类为将来细化（如 `SchemaConflictError`）留入口，不增加当前实现复杂度 |
| Schema diff 实现位置 | SDK 本地对比 | 服务端 diff API | BKN 无 diff 端点；利用已有 CHECKSUM 机制在本地完成 |
| Watch / Bench | 暂不设计 | 在文档中保留 | P4 优先级，增加文档负担；需要时再单独设计 |
| BKN 文件组织 | 平铺在 `resources/` | `resources/bkn/` 子包 | 新增文件仅 4 个，不需要子包隔离；Vega 12 个文件才需要子包 |

---

## 10 聚合诊断入口（借鉴 Vega `inspect` 模式）

Vega 设计中提供了 `health()` → `stats()` → `inspect()` 三级诊断，其中 `inspect` 是复合方法，并发调用多个子接口汇总成一站式报告。BKN 应采用相同模式。

### SDK

在 `KnowledgeNetworksResource` 上新增复合方法：

```python
class KnowledgeNetworksResource:
    # ... existing methods ...

    def inspect(self, kn_id: str, *, full: bool = False) -> BKNInspectReport:
        """One-shot diagnosis: health + stats + schema summary + active jobs.

        Parallelized internally. Returns partial results if a sub-call fails.
        """
        ...
```

```python
class BKNInspectReport(BaseModel):
    model_config = {"extra": "ignore"}
    kn: KnowledgeNetwork
    health: list[ServiceHealth] = []     # bkn-backend + ontology-query
    stats: KNStatistics = Field(default_factory=KNStatistics)
    object_type_summary: list[dict[str, Any]] = []
    active_jobs: list[Job] = []          # running/pending jobs
    # active_schedules: Phase 2（ActionSchedulesResource 实现后追加）
```

### CLI

```bash
kweaver bkn                            # 不带子命令 = inspect（数据总览，见 §6.3）
kweaver bkn inspect [<kn_id>] [--full]
```

> `kweaver bkn`（不带子命令）等价于 `kweaver bkn inspect`，展示当前 KN 的完整概览。这是用户最常做的事——"看看现在什么状况"。

默认输出 Markdown 表格，`--format json` 输出 JSON：

```markdown
## Service Health

| Service         | Status  | Version |
|-----------------|---------|---------|
| bkn-backend     | healthy | 6.0.0   |
| ontology-query  | healthy | 6.0.0   |

## Knowledge Network: k8s-topology

| Metric          | Value |
|-----------------|-------|
| Object Types    | 5     |
| Relation Types  | 3     |
| Action Types    | 2     |
| Concept Groups  | 1     |

## Object Types

| Name    | Instances | Indexed | Last Sync           |
|---------|-----------|---------|---------------------|
| Pod     | 1,523     | yes     | 2026-03-20 10:30:00 |
| Node    | 42        | yes     | 2026-03-20 10:30:00 |
| Service | 186       | yes     | 2026-03-20 10:28:12 |

## Active Jobs

(none)
```

---

## 11 CLI 多格式输出

`--format` 是全局 flag（定义在 `sdk-observability-infra.md` §6.1），所有 BKN 和 Vega 命令共享：

```
kweaver [--format md|json|yaml] <command> ...
```

| 格式 | 用途 | 默认 |
|------|------|------|
| `md` | 人类阅读，Markdown 表格 | **默认** |
| `json` | 程序消费、AI Agent 解析 | 显式 `--format json` |
| `yaml` | 配置式阅读 | 显式 `--format yaml`（需 `pip install kweaver[yaml]`） |

> 不做 TTY 自动检测。默认始终是 `md`。Agent 需要 JSON 时显式传 `--format json`——显式优于隐式。

### 实现

在 `cli/_helpers.py` 中新增 formatter：

```python
def output(data: Any, *, format: str = "md") -> None:
    """Output data in the requested format."""
    if format == "json":
        click.echo(json.dumps(data, indent=2, ensure_ascii=False))
    elif format == "yaml":
        try:
            import yaml
        except ImportError:
            raise click.UsageError("YAML output requires: pip install kweaver[yaml]")
        click.echo(yaml.dump(data, allow_unicode=True))
    else:  # md
        click.echo(_to_markdown_table(data))
```

---

## 12 TypeScript 对等设计

BKN 新增能力同时在 Python 和 TypeScript SDK 中实现，保持功能对等：

### 文件结构

```
packages/typescript/src/
├── resources/
│   ├── concept-groups.ts       # NEW
│   ├── jobs.ts                 # NEW
│   ├── action-schedules.ts     # NEW
│   ├── system.ts               # NEW
│   ├── knowledge-networks.ts   # MODIFIED: +relation_type_paths, +import_bkn, +diff, +inspect
│   ├── object-types.ts         # MODIFIED: 扩展返回类型
│   ├── relation-types.ts       # MODIFIED: 扩展返回类型
│   └── action-types.ts         # MODIFIED: 扩展返回类型
├── commands/
│   ├── bkn/
│   │   ├── concept-group.ts    # NEW
│   │   ├── job.ts              # NEW
│   │   ├── action-schedule.ts  # NEW
│   │   └── inspect.ts          # NEW
│   └── health.ts               # NEW
└── types/
    └── bkn.ts                  # NEW: ConceptGroup, Job, Task, ActionSchedule, etc.
```

> Middleware（`middleware/*.ts`）和 `commands/audit.ts` 属于公共可观测基础设施，在 `sdk-observability-infra.md` 中定义。

### TypeScript 类型定义

```typescript
interface ConceptGroup {
  id: string;
  name: string;
  kn_id: string;
  branch?: string;
  object_type_ids?: string[];
}

interface Job {
  id: string;
  kn_id: string;
  type: string;
  status: "pending" | "running" | "completed" | "failed";
  progress?: number;
}

interface BKNInspectReport {
  kn: KnowledgeNetwork;
  health: ServiceHealth[];
  stats: KNStatistics;
  object_type_summary: Array<{
    id: string;
    name: string;
    instance_count: number;
    indexed: boolean;
    last_sync?: string;
  }>;
  active_jobs: Job[];
}
```

---

## 13 Capability Matrix

| 领域 | 能力 | SDK 方法 | 层次 | CLI 命令 | 阶段 |
|------|------|---------|------|---------|------|
| **Schema 读取** | Concept Group 管理（含名称解析创建） | `concept_groups.*` | L2 | `bkn concept-group *` | P1 |
| | OT/RT/AT 完整属性解析 | `object_types.get()` (扩展) | L2 | `bkn object-type get -v` | P1 |
| | Relation Type Paths | `knowledge_networks.relation_type_paths()` | L2 | `bkn relation-type-paths` | P2 |
| **任务管理** | Job 列表/任务/轮询等待 | `jobs.*` | L2/L3 | `bkn job *` | P1 |
| | Action Schedule 管理 | `action_schedules.*` | L2 | `bkn action-schedule *` | P2 |
| **数据交换** | BKN Import | `knowledge_networks.import_bkn()` | L2 | `bkn import` | P2 |
| | Schema Diff | `knowledge_networks.diff()` | L3 | `bkn diff` | P2 |
| **诊断** | Health check | `system.health()` | L2 | `health` | P2 |
| | KN 一站式诊断 | `knowledge_networks.inspect()` | L3 | `bkn inspect` | P1 |
| | Platform stats | `knowledge_networks.stats()` (enhanced) | L3 | `bkn stats --detailed` | P1 |
| **输出** | 多格式 | — | — | `--format md\|json\|yaml` | P2 |
| **可观测** | Debug / Audit / Metrics / Trace | 见 `sdk-observability-infra.md` | — | 公共能力 | 独立排期 |

---

## 14 测试计划

测试分三层：单元测试（mock HTTP）、CLI 集成测试（CliRunner）、e2e 测试（真实 BKN 环境）。

### 14.1 单元测试（`tests/test_*.py`）

使用 httpx `MockTransport` 注入固定响应，验证 SDK Resource 方法的参数构造、响应解析和错误处理。每个新增 Resource 一个测试文件。

| 测试文件 | 覆盖范围 |
|---------|---------|
| `test_concept_groups.py` | list/get/create/update/delete/add_members/remove_members |
| `test_jobs.py` | list/get_tasks/delete/wait（含超时场景） |
| `test_action_schedules.py` | list/get/create/update(含 enabled 切换)/delete |
| `test_relation_type_paths.py` | 路径查询返回解析 |
| `test_import_bkn.py` | 文件上传构造、import summary 解析 |
| `test_full_get.py` | OT/RT/AT get 的完整属性解析（data_properties、mappings、source/params） |
| `test_inspect.py` | 复合方法的并发调用 mock、部分失败降级 |
| `test_system.py` | health 多服务汇总、resources 列表 |
| `test_schema_diff.py` | checksum 对比逻辑、added/modified/removed 分类 |

> 可观测 middleware 单元测试（metrics/audit/trace/debug/dry-run）属于公共基础设施，在 `sdk-observability-infra.md` 中定义。

### 14.2 CLI 集成测试（`tests/test_cli_*.py`）

使用 Click `CliRunner` + mock transport，验证命令行参数解析、输出格式和退出码。

```python
def test_concept_group_list(cli_runner, mock_transport):
    result = cli_runner.invoke(cli, ["bkn", "concept-group", "list", "kn-123"])
    assert result.exit_code == 0
    data = json.loads(result.output)
    assert isinstance(data, list)

def test_inspect_markdown_output(cli_runner, mock_transport):
    result = cli_runner.invoke(cli, ["bkn", "inspect", "kn-123", "--format", "md"])
    assert result.exit_code == 0
    assert "## Service Health" in result.output

def test_debug_flag(cli_runner, mock_transport):
    result = cli_runner.invoke(cli, ["--debug", "bkn", "list"])
    assert "REQUEST" in result.output
    assert "RESPONSE" in result.output

def test_dry_run_blocks_write(cli_runner, mock_transport):
    result = cli_runner.invoke(cli, ["--dry-run", "bkn", "concept-group", "create", "kn-123", "--name", "test"])
    assert result.exit_code == 0
    assert "[DRY RUN]" in result.output

def test_format_json_yaml(cli_runner, mock_transport):
    for fmt in ["json", "yaml"]:
        result = cli_runner.invoke(cli, ["bkn", "list", "--format", fmt])
        assert result.exit_code == 0
```

### 14.3 E2E 测试（`tests/e2e/`）

对真实 BKN 环境执行，遵循现有 e2e 模式（`conftest.py` 从 `~/.env.secrets` 加载凭据，`@pytest.mark.e2e` 标记，读写分离）。

#### 新增 e2e 测试文件

```
tests/e2e/layer/
├── test_concept_group.py    # NEW
├── test_job.py              # NEW
├── test_action_schedule.py  # NEW
├── test_full_get.py         # NEW — OT/RT/AT 完整属性解析
├── test_inspect.py          # NEW
└── test_health.py           # NEW

tests/e2e/integration/
└── test_bkn_import_export.py  # NEW — 导入导出往返测试
```

#### E2E 测试用例

**Layer 测试（单 Resource 验证）**：

```python
# test_concept_group.py
pytestmark = pytest.mark.e2e

def test_concept_group_list(kweaver_client, kn_with_data):
    """SDK: list concept groups."""
    kn = kn_with_data["kn"]
    cgs = kweaver_client.concept_groups.list(kn.id)
    assert isinstance(cgs, list)

@pytest.mark.destructive
def test_concept_group_lifecycle(kweaver_client, kn_with_data):
    """SDK: create → get → add members → remove members → delete."""
    kn = kn_with_data["kn"]
    ot = kn_with_data["ot"]
    cg = kweaver_client.concept_groups.create(kn.id, name="test-cg")
    assert cg.name == "test-cg"

    fetched = kweaver_client.concept_groups.get(kn.id, cg.id)
    assert fetched.id == cg.id

    kweaver_client.concept_groups.add_members(kn.id, cg.id, object_type_ids=[ot.id])
    updated = kweaver_client.concept_groups.get(kn.id, cg.id)
    assert ot.id in updated.object_type_ids

    kweaver_client.concept_groups.remove_members(kn.id, cg.id, object_type_ids=[ot.id])
    kweaver_client.concept_groups.delete(kn.id, [cg.id])

# test_full_get.py
def test_object_type_get_full_properties(kweaver_client, kn_with_data):
    """SDK: get() returns full data property metadata."""
    kn = kn_with_data["kn"]
    ot = kn_with_data["ot"]
    result = kweaver_client.object_types.get(kn.id, ot.id)
    assert len(result.data_properties) > 0
    for dp in result.data_properties:
        assert dp.name
        assert dp.type

def test_relation_type_get_mappings(kweaver_client, kn_with_data):
    """SDK: get() returns mapping rules."""
    kn = kn_with_data["kn"]
    rts = kweaver_client.relation_types.list(kn.id)
    if not rts:
        pytest.skip("No relation types")
    result = kweaver_client.relation_types.get(kn.id, rts[0].id)
    assert result.mapping_type in ("direct", "data_view", None)

# test_job.py
def test_job_list(kweaver_client, kn_with_data):
    """SDK: list jobs (may be empty)."""
    kn = kn_with_data["kn"]
    jobs = kweaver_client.jobs.list(kn.id)
    assert isinstance(jobs, list)

# test_inspect.py
def test_inspect(kweaver_client, kn_with_data):
    """SDK: inspect returns aggregated report."""
    kn = kn_with_data["kn"]
    report = kweaver_client.knowledge_networks.inspect(kn.id)
    assert report.kn.id == kn.id
    assert len(report.health) > 0
    assert report.stats.object_types >= 0

# test_health.py
def test_health(kweaver_client):
    """SDK: health check returns at least one service."""
    health = kweaver_client.system.health()
    assert len(health) > 0
    assert all(h.status in ("healthy", "unhealthy") for h in health)
```

**Integration 测试（跨 Resource 流程）**：

```python
# test_bkn_import_export.py
pytestmark = [pytest.mark.e2e, pytest.mark.destructive]

def test_export_import_roundtrip(kweaver_client, kn_with_data, tmp_path):
    """Export a KN, import it under a new name, verify schema parity."""
    kn = kn_with_data["kn"]

    # Export
    tar_path = tmp_path / "export.tar"
    kweaver_client.knowledge_networks.export(kn.id, output=str(tar_path))
    assert tar_path.exists()

    # Import
    result = kweaver_client.knowledge_networks.import_bkn(str(tar_path))
    assert result.summary.failed == 0
    assert result.summary.total > 0

    # Diff — should show no changes (same content)
    diff = kweaver_client.knowledge_networks.diff(
        result.kn_id, from_file=str(tar_path)
    )
    assert len(diff.added) == 0
    assert len(diff.removed) == 0
```

**CLI E2E 测试**：

```python
# test_cli_bkn.py — 在 e2e/layer/ 目录下
def test_cli_concept_group_list(cli_runner_e2e, kn_with_data):
    """CLI: kweaver bkn concept-group list."""
    kn = kn_with_data["kn"]
    result = cli_runner_e2e.invoke(cli, ["bkn", "concept-group", "list", kn.id])
    assert result.exit_code == 0

def test_cli_inspect(cli_runner_e2e, kn_with_data):
    """CLI: kweaver bkn inspect with markdown output."""
    kn = kn_with_data["kn"]
    result = cli_runner_e2e.invoke(cli, ["bkn", "inspect", kn.id, "--format", "md"])
    assert result.exit_code == 0
    assert "Service Health" in result.output

def test_cli_health(cli_runner_e2e):
    """CLI: kweaver health."""
    result = cli_runner_e2e.invoke(cli, ["health"])
    assert result.exit_code == 0
```

### 14.4 可观测功能 E2E 验证

可观测 middleware 不需要对外部服务做 e2e，但需要验证端到端集成行为：

```python
# tests/e2e/layer/test_observability.py
pytestmark = pytest.mark.e2e

def test_debug_mode_outputs_curl(kweaver_client_debug, kn_with_data, capsys):
    """debug=True should print curl-equivalent commands."""
    kn = kn_with_data["kn"]
    kweaver_client_debug.knowledge_networks.get(kn.id)
    captured = capsys.readouterr()
    assert "curl" in captured.err.lower() or "REQUEST" in captured.err

def test_audit_log_written(tmp_path, kweaver_client_factory, kn_with_data):
    """audit_log path should contain JSONL entries after SDK calls."""
    audit_path = tmp_path / "audit.jsonl"
    client = kweaver_client_factory(audit_log=str(audit_path))
    kn = kn_with_data["kn"]
    client.knowledge_networks.list()
    client.knowledge_networks.get(kn.id)
    lines = audit_path.read_text().strip().splitlines()
    assert len(lines) >= 2
    import json
    entry = json.loads(lines[0])
    assert "method" in entry
    assert "status_code" in entry
    assert "duration_ms" in entry

def test_metrics_collector(kweaver_client_factory, kn_with_data):
    """metrics=True should accumulate request counts and latencies."""
    client = kweaver_client_factory(metrics=True)
    kn = kn_with_data["kn"]
    client.knowledge_networks.list()
    client.object_types.list(kn.id)
    summary = client.metrics.summary()
    assert summary.total_requests >= 2
    assert summary.total_errors == 0

def test_trace_propagation_header(kweaver_client_factory, kn_with_data):
    """trace_propagation=True should send traceparent header (verified via debug log)."""
    client = kweaver_client_factory(trace_propagation=True, debug=True)
    kn = kn_with_data["kn"]
    # The debug output should include traceparent header
    client.knowledge_networks.get(kn.id)
    # Verification: audit log or debug output contains traceparent
```

### 14.5 Conftest 扩展

在 `tests/e2e/conftest.py` 中新增 fixture：

```python
@pytest.fixture(scope="session")
def kweaver_client_factory(kweaver_env):
    """Factory fixture: create KWeaverClient with custom options."""
    def _make(**kwargs):
        return KWeaverClient(
            base_url=kweaver_env["base_url"],
            auth=PasswordAuth(...),
            **kwargs,
        )
    return _make

@pytest.fixture(scope="session")
def kweaver_client_debug(kweaver_client_factory):
    return kweaver_client_factory(debug=True)
```

### 14.6 测试矩阵

| 新增能力 | 单元测试 | CLI 测试 | E2E Layer | E2E Integration |
|---------|---------|---------|-----------|-----------------|
| ConceptGroupsResource | `test_concept_groups.py` | `test_cli_concept_group.py` | `test_concept_group.py` | — |
| JobsResource | `test_jobs.py` | `test_cli_job.py` | `test_job.py` | — |
| ActionSchedulesResource | `test_action_schedules.py` | `test_cli_action_schedule.py` | `test_action_schedule.py` | — |
| OT/RT/AT 完整属性解析 | `test_full_get.py` | — | `test_full_get.py` | — |
| Relation Type Paths | `test_relation_type_paths.py` | `test_cli_rtp.py` | — | — |
| BKN Import/Export | `test_import_bkn.py` | `test_cli_import.py` | — | `test_bkn_import_export.py` |
| Schema Diff | `test_schema_diff.py` | `test_cli_diff.py` | — | `test_bkn_import_export.py` |
| Inspect | `test_inspect.py` | `test_cli_inspect.py` | `test_inspect.py` | — |
| Health/Resources | `test_system.py` | `test_cli_health.py` | `test_health.py` | — |
| 多格式输出 | — | `test_cli_format.py` | — | — |

> 可观测 middleware 测试（metrics/audit/trace/debug/dry-run）在 `sdk-observability-infra.md` 中定义。
