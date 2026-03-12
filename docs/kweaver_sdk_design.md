# ADP Python SDK & Skill 设计文档

v0.2.0 | 2026-03-12

---

## 1 背景

ADP 平台通过多个微服务提供从数据接入到知识查询的全链路能力。但这些能力只通过 REST API 暴露，存在三个问题：

1. **Agent 不可直接使用** — Agent 需要的是意图级操作（"把这个库变成知识网络"），而非拼装 HTTP 请求。
2. **链路割裂** — 完成一个流程需跨多个服务、多步调用，调用方需理解服务边界和参数传递。
3. **无 Python 入口** — 当前只有前端 TypeScript 客户端，Agent 框架和数据工具链无法程序化使用。

---

## 2 功能目标

构建面向 Agent 的 ADP 技能层。第一个技能：**从数据库自动构建可查询的知识网络。**

设计上需容纳未来的其他技能，包括但不限于：

| 技能 | 数据来源 | 产出 |
|------|---------|------|
| **从数据库构建** (v0.1) | 数据库连接 | 知识网络 |
| 从文档构建 (规划) | 文件路径 / URL | 知识网络 |
| 查询知识 (规划) | 知识网络 ID + 自然语言 | 结构化结果 |
| 执行行动 (规划) | 行动类 + 实例 | 执行结果 |

因此 SDK 层的模块划分和 Skill 层的接口设计，都需要是可组合、可扩展的，而非只服务于单一流程。

---

## 3 设计思路与折衷

### 3.1 三层分离

```
┌───────────────────────────────────────────────┐
│  Skill 层（对外）                              │
│  Agent 看到的 Tool 定义，意图级粒度             │
│  不暴露 ADP 内部概念（DataView、kn_id...）      │
├───────────────────────────────────────────────┤
│  SDK 层（内部实现）                             │
│  Python 方法，1:1 映射 ADP 概念                 │
│  类型安全、跨服务编排、参数转换                  │
├───────────────────────────────────────────────┤
│  HTTP 层（传输）                               │
│  httpx / 认证 / 重试 / Header 注入             │
└───────────────────────────────────────────────┘
```

**对外 vs 内部的边界原则：**

- Agent 看到的（Skill Tool）：业务语义参数（数据库地址、表名、查询意图），不出现 `dataview_id`、`kn_id` 等 ADP 内部 ID。
- 开发者看到的（SDK）：ADP 概念的 Python 映射，需要理解 DataSource → DataView → ObjectType 的关系。
- 两者均不暴露 REST 层的嵌套结构（`bin_data`、`ResourceInfo`、`mapping_rules`）。

### 3.2 Skill 粒度选择

| 方案 | 优点 | 缺点 |
|------|------|------|
| 一个 Skill 覆盖全流程 | Agent 一次调用完成 | 参数太多，灵活性差 |
| 每个 REST 接口一个 Tool | 最大灵活性 | Agent 决策负担重，易出错 |
| **按用户意图分组（选定）** | 平衡灵活性和认知负担 | 需要设计合理的分组 |

选定方案：按用户意图分成少量 Tool。每个 Tool 内部可能编排多个 SDK 调用，但 Agent 只需表达意图。

### 3.3 其他折衷

| 决策 | 选择 | 理由 |
|------|------|------|
| SDK 参数风格 | 扁平化 | `primary_keys=["id"]` 优于 `ResourceInfo(type=..., id=...)` |
| 同步/异步 | 先同步 | 当前用例不需异步，后续按需加 |
| SDK 模块作为独立积木 | 是 | 未来"从文档构建"等新 Skill 可复用 `knowledge_networks`、`object_types` 等模块 |

---

## 4 架构设计

### 4.1 逻辑分层

```
Agent
 │ 自然语言
 ▼
┌─────────────────────────────────────────────────┐
│  Skill 层 — 对外 Tool 定义                       │
│                                                  │
│  ┌────────────┐ ┌────────────┐ ┌──────────────┐ │
│  │ connect_db │ │ build_kn   │ │ query_kn     │ │
│  │ (连接数据源)│ │(构建知识网络)│ │(查询知识网络) │ │
│  └─────┬──────┘ └─────┬──────┘ └──────┬───────┘ │
│        │              │               │          │
│  ┌─────┴──────────────┴───────────────┴───────┐ │
│  │  未来:  import_docs │ execute_action │ ...  │ │
│  └────────────────────────────────────────────┘ │
└──────────────────────┬──────────────────────────┘
                       │ Python 调用
┌──────────────────────▼──────────────────────────┐
│  SDK 层 — 内部模块（可独立使用，也被 Skill 编排）   │
│                                                  │
│  datasources │ dataviews │ knowledge_networks    │
│  object_types │ relation_types │ query           │
│  concept_groups │ action_types (预留)             │
└──────────────────────┬──────────────────────────┘
                       │ HTTP
┌──────────────────────▼──────────────────────────┐
│  HTTP 层 — httpx + AuthProvider                  │
│  data-connection │ mdl-data-model │ ontology-mgr │
│  ontology-query │ agent-retrieval                │
└─────────────────────────────────────────────────┘
```

### 4.2 核心流程：从数据库构建知识网络

```
用户: "把 10.0.1.100 的 ERP 库接进来"
 │
 ├─ Skill: connect_db ──────────────────────────────────────
 │   │  SDK: datasources.test() → datasources.create()
 │   │  SDK: datasources.list_tables()
 │   └─ 返回: datasource_id, 可用表列表
 │
 ├─ Skill: build_kn ────────────────────────────────────────
 │   │  SDK: dataviews.create()          ← 每张目标表
 │   │  SDK: knowledge_networks.create()
 │   │  SDK: object_types.create()       ← 每个视图
 │   │  SDK: relation_types.create()     ← 每对关联
 │   │  SDK: knowledge_networks.build().wait()
 │   └─ 返回: kn_id, 对象类/关系类摘要
 │
 └─ Skill: query_kn ────────────────────────────────────────
     │  SDK: query.semantic_search() / query.instances() / query.subgraph()
     └─ 返回: 查询结果
```

### 4.3 扩展示例：从文档构建（未来）

```
用户: "把 /docs/api-spec.pdf 导入知识网络"
 │
 ├─ Skill: import_docs ─────────────────────────────────────
 │   │  读取文件 → 解析结构 → 调用与 build_kn 相同的 SDK 模块
 │   │  SDK: knowledge_networks.create()
 │   │  SDK: object_types.create()   ← 从文档结构推断
 │   │  SDK: relation_types.create() ← 从文档语义推断
 │   └─ 复用 SDK 模块，只是数据来源不同
```

SDK 模块是积木，Skill 是积木的不同组合方式。新增 Skill 不需要改 SDK。

---

## 5 Skill 对外接口

Agent 看到的全部 Tool 定义。这是整个系统的**对外 API 边界**。

### 5.1 connect_db — 连接数据源

```yaml
name: connect_db
description: |
  连接一个数据库，验证连通性，返回可用的表和字段信息。
  不会创建知识网络，仅建立连接并探索结构。
parameters:
  type: object
  required: [db_type, host, port, database, account, password]
  properties:
    db_type:
      type: string
      enum: [mysql, maria, oracle, postgresql, sqlserver, doris, hive,
             clickhouse, mongodb, dameng, gaussdb, hologres, opengauss]
      description: "数据库类型"
    host:       { type: string }
    port:       { type: integer }
    database:   { type: string }
    account:    { type: string }
    password:   { type: string }
    schema:     { type: string, description: "Schema 名称（PostgreSQL/Oracle 等需要）" }
returns:
  datasource_id: string
  tables:
    - name: string
      columns: [{ name: string, type: string, comment: string }]
```

**内部编排：** `datasources.test()` → `datasources.create()` → `datasources.list_tables()`

### 5.2 build_kn — 构建知识网络

```yaml
name: build_kn
description: |
  从已连接的数据源构建知识网络。选择要纳入的表，定义对象间关系，
  自动完成数据视图创建、对象类建模、关系建模和索引构建。
parameters:
  type: object
  required: [datasource_id]
  properties:
    datasource_id: { type: string, description: "connect_db 返回的 ID" }
    network_name:  { type: string }
    tables:
      type: array
      items: { type: string }
      description: "要纳入的表名。为空则纳入全部。"
    relations:
      type: array
      items:
        type: object
        required: [name, from_table, to_table, from_field, to_field]
        properties:
          name:       { type: string }
          from_table: { type: string }
          to_table:   { type: string }
          from_field: { type: string }
          to_field:   { type: string }
      description: "关系定义。必须显式指定，不做自动推断。"
returns:
  kn_id: string
  kn_name: string
  object_types: [{ name: string, id: string, field_count: integer }]
  relation_types: [{ name: string, from: string, to: string }]
  status: ready | failed
```

**内部编排：**

1. `datasources.list_tables(datasource_id)` — 获取表结构
2. `dataviews.create()` × N — 每张目标表创建数据视图
3. `knowledge_networks.create()` — 创建知识网络
4. `object_types.create()` × N — 每个视图创建对象类（Skill 自动选取主键和显示键）
5. `relation_types.create()` × M — 根据 `relations` 参数创建关系（Skill 内部维护 表名→OT ID 的映射）
6. `knowledge_networks.build().wait()` — 触发索引构建并等待完成

### 5.3 query_kn — 查询知识网络

```yaml
name: query_kn
description: |
  查询知识网络中的数据。支持三种模式：
  - search: 语义搜索，不确定查什么时用
  - instances: 精确查询某类对象的实例
  - subgraph: 沿关系路径做关联查询
parameters:
  type: object
  required: [kn_id, mode]
  properties:
    kn_id: { type: string }
    mode:  { type: string, enum: [search, instances, subgraph] }
    # search 模式
    query: { type: string, description: "自然语言查询" }
    # instances 模式
    object_type: { type: string, description: "对象类名称或 ID" }
    conditions:  { type: object, description: "过滤条件 {field, op, value}" }
    limit:       { type: integer, default: 20 }
    # subgraph 模式
    start_object: { type: string, description: "起点对象类" }
    start_condition: { type: object }
    path: { type: array, items: { type: string }, description: "关系路径，如 [产品, 库存]" }
returns:
  data: array    # 查询结果
  summary: string  # 结果摘要
```

**内部编排：** 根据 `mode` 分别调用 `query.semantic_search()` / `query.instances()` / `query.subgraph()`

### 5.4 对话示例

```
用户: 帮我连上 10.0.1.100 的 MySQL 库 erp_prod，账号 readonly

Agent: [调用 connect_db]
       → 连接成功，发现 12 张表:
         products (8 字段), inventory (6 字段), suppliers (5 字段), ...
         需要把哪些表纳入知识网络？

用户: products、inventory、suppliers 三张表，产品和库存通过 material_number 关联

Agent: [调用 build_kn]
       → 已创建知识网络「erp_prod」:
         - 产品 (8 字段), 库存 (6 字段), 供应商 (5 字段)
         - 关系: 产品→库存 (material_number = material_code)
         索引构建完成，可以查询了。

用户: 产品 746-000031 的库存情况

Agent: [调用 query_kn, mode=subgraph]
       → 产品 746-000031 在 3 个仓库有库存:
         华东仓: 1200件, 华南仓: 800件, 华北仓: 350件
```

### 5.5 未来 Skill 预留

| Skill | 触发场景 | 依赖的 SDK 模块 |
|-------|---------|----------------|
| `import_docs` | "把这份文档导入知识网络" | knowledge_networks, object_types, relation_types + 文档解析 |
| `execute_action` | "为物料 X 发起采购订单" | query + **action_types** + 行动执行 |
| `compute_metric` | "产品 A 的 BOM 展开" | query.logic_properties |
| `manage_kn` | "删除/更新知识网络中的对象类" | knowledge_networks, object_types, relation_types, **concept_groups** |

新增 Skill 只需组合已有 SDK 模块 + 可能新增的模块，不改动已有 Skill 和 SDK。

---

## 6 SDK 内部模块

SDK 是 Skill 的实现基础，也可被开发者直接使用。以下按模块列出接口和关键参数映射。

### 6.1 datasources

对应服务: `data-connection`（dc-datasource）

| 方法 | HTTP | 路径 |
|------|------|------|
| `create(name, type, host, port, database, account, password, schema?, comment?)` | POST | `/api/data-connection/v1/datasource` |
| `test(type, host, port, database, account, password, schema?)` | POST | `/api/data-connection/v1/datasource/test` |
| `list(keyword?, type?)` | GET | `/api/data-connection/v1/datasource` |
| `get(id)` | GET | `/api/data-connection/v1/datasource/{id}` |
| `delete(id)` | DELETE | `/api/data-connection/v1/datasource/{id}` |
| `list_tables(id, keyword?, limit?, offset?)` | GET | `/api/data-connection/v1/metadata/data-source/{id}` |

SDK 扁平参数 → REST 嵌套结构:

```python
# SDK 调用
datasources.create(name="ERP库", type="mysql", host="10.0.1.100", port=3306,
                   database="erp", account="root", password="secret")

# → REST 请求体
{
    "name": "ERP库",
    "type": "mysql",
    "bin_data": {
        "host": "10.0.1.100",
        "port": 3306,
        "database_name": "erp",
        "connect_protocol": "jdbc",
        "account": "root",
        "password": "secret"
    }
}
```

```python
# SDK 调用
datasources.test(type="mysql", host="10.0.1.100", port=3306,
                 database="erp", account="root", password="secret")

# → REST 请求体
{
    "type": "mysql",
    "bin_data": {
        "host": "10.0.1.100",
        "port": 3306,
        "database_name": "erp",
        "connect_protocol": "jdbc",
        "account": "root",
        "password": "secret"
    }
}
```

**`connect_protocol` 推断规则：** SDK 根据 `type` 自动设置 `connect_protocol`。大多数数据库为 `"jdbc"`，`maxcompute` / `anyshare7` / `opensearch` 等为 `"https"`。

**支持的数据源类型：** `mysql`, `maria`, `oracle`, `postgresql`, `sqlserver`, `doris`, `hive`, `clickhouse`, `mongodb`, `dameng`, `gaussdb`, `hologres`, `opengauss`, `inceptor-jdbc`, `maxcompute`, `excel`, `anyshare7`, `tingyun`, `opensearch`

### 6.2 dataviews

对应服务: VEGA `mdl-data-model`

| 方法 | HTTP | 路径 |
|------|------|------|
| `create(name, datasource_id, table?, sql?, fields?)` | POST | `/api/mdl-data-model/v1/data-views` |
| `list(datasource_id?, name?, type?)` | GET | `/api/mdl-data-model/v1/data-views` |
| `get(id)` | GET | `/api/mdl-data-model/v1/data-views/{id}` |
| `delete(id)` | DELETE | `/api/mdl-data-model/v1/data-views/{id}` |

两种模式: `table="products"` (整表映射) 或 `sql="SELECT ..."` (自定义 SQL)。

SDK 内部转换为 `data_scope` + `query_type` 结构：

```python
# SDK 调用 — 整表映射
dataviews.create(name="products", datasource_id="ds_01", table="products")

# → REST 请求体
[{
    "name": "products",
    "type": "atomic",
    "query_type": "SQL",
    "data_source_id": "ds_01",
    "data_scope": [{
        "id": "node_0",
        "title": "products",
        "type": "source",
        "config": {"table": "products"},
        "input_nodes": [],
        "output_fields": []    # 自动从表结构继承
    }],
    "fields": []               # 自动从表结构继承
}]

# SDK 调用 — 自定义 SQL
dataviews.create(name="custom_view", datasource_id="ds_01",
                 sql="SELECT id, name FROM products WHERE status = 'active'")

# → REST 请求体
[{
    "name": "custom_view",
    "type": "custom",
    "query_type": "SQL",
    "data_source_id": "ds_01",
    "data_scope": [{
        "id": "node_0",
        "title": "custom_view",
        "type": "sql",
        "config": {"sql": "SELECT id, name FROM products WHERE status = 'active'"},
        "input_nodes": [],
        "output_fields": []
    }],
    "fields": []
}]
```

> **注意：** REST API 接受的是数组（支持批量创建），SDK 的 `create()` 单次创建一个视图，内部包装为单元素数组。

### 6.3 knowledge_networks

对应服务: `ontology-manager` + `agent-retrieval`

| 方法 | HTTP | 路径 |
|------|------|------|
| `create(name, description?, tags?)` | POST | `/api/ontology-manager/v1/knowledge-networks` |
| `list(name?)` | GET | `/api/ontology-manager/v1/knowledge-networks` |
| `get(id)` | GET | `/api/ontology-manager/v1/knowledge-networks/{id}` |
| `update(id, ...)` | PUT | `/api/ontology-manager/v1/knowledge-networks/{id}` |
| `delete(id)` | DELETE | `/api/ontology-manager/v1/knowledge-networks/{id}` |
| `build(id)` | POST | `/api/agent-retrieval/in/v1/kn/full_build_ontology` |
| `build_status(id)` | GET | `/api/agent-retrieval/in/v1/kn/full_ontology_building_status?kn_id={id}` |

**Build 机制：**

```python
# 触发构建
job = client.knowledge_networks.build(kn_id)

# → REST 请求体
{"kn_id": "kn_01"}

# → 返回 BuildJob 对象
```

`build()` 返回 `BuildJob`，支持 `.wait(timeout=300)` 阻塞等待和 `.poll()` 轮询。

**状态查询使用 `kn_id`（非 job_id）：** `GET .../full_ontology_building_status?kn_id=kn_01`，返回该知识网络最近构建任务的整体状态。

状态值: `running` → `completed | failed`。

### 6.4 object_types

对应服务: `ontology-manager`。路径前缀: `/api/ontology-manager/v1`

| 方法 | HTTP | 路径 |
|------|------|------|
| `create(kn_id, name, dataview_id, primary_keys, display_key, properties?)` | POST | `.../knowledge-networks/{kn_id}/object-types` |
| `list(kn_id)` | GET | `.../knowledge-networks/{kn_id}/object-types` |
| `get(kn_id, ot_id)` | GET | `.../knowledge-networks/{kn_id}/object-types/{ot_id}` |
| `update(kn_id, ot_id, ...)` | PUT | `.../knowledge-networks/{kn_id}/object-types/{ot_id}` |
| `delete(kn_id, ot_ids)` | DELETE | `.../knowledge-networks/{kn_id}/object-types/{ot_ids}` |

**核心参数映射：**

```python
# SDK 调用
client.object_types.create(
    kn_id="kn_01",
    name="产品",
    dataview_id="dv_01",
    primary_keys=["material_number"],       # 注意：数组，支持复合主键
    display_key="product_name",
    properties=[
        Property(name="material_number", indexed=True),
        Property(name="product_name", fulltext=True, vector=True),
    ],
)

# → REST 请求体
{
    "entries": [{
        "name": "产品",
        "data_source": {
            "type": "data_view",
            "id": "dv_01"
        },
        "primary_keys": ["material_number"],
        "display_key": "product_name",
        "data_properties": [
            {
                "name": "material_number",
                "display_name": "material_number",
                "index_config": {
                    "keyword_config": {"enabled": true},
                    "fulltext_config": {"enabled": false},
                    "vector_config": {"enabled": false}
                }
            },
            {
                "name": "product_name",
                "display_name": "product_name",
                "index_config": {
                    "keyword_config": {"enabled": false},
                    "fulltext_config": {"enabled": true},
                    "vector_config": {"enabled": true}
                }
            }
        ]
    }]
}
```

**SDK 便捷接口：** 同时支持 `primary_keys=["id"]`（规范形式）和 `primary_key="id"`（单主键快捷方式，内部转为数组）。`properties` 不传时自动从 DataView 继承全部字段。

**主键类型约束：** `primary_keys` 中的字段类型必须为 `integer`、`unsigned integer` 或 `string`。

> **注意：** REST API 通过 `entries` 数组支持批量创建。SDK 的 `create()` 单次创建一个对象类，内部包装为单元素数组并返回第一个结果。

### 6.5 relation_types

对应服务: `ontology-manager`。路径前缀同上。

| 方法 | HTTP | 路径 |
|------|------|------|
| `create(kn_id, name, source_ot_id, target_ot_id, ...)` | POST | `.../knowledge-networks/{kn_id}/relation-types` |
| `list(kn_id)` | GET | `.../knowledge-networks/{kn_id}/relation-types` |
| `get(kn_id, rt_id)` | GET | `.../knowledge-networks/{kn_id}/relation-types/{rt_id}` |
| `update(kn_id, rt_id, ...)` | PUT | `.../knowledge-networks/{kn_id}/relation-types/{rt_id}` |
| `delete(kn_id, rt_ids)` | DELETE | `.../knowledge-networks/{kn_id}/relation-types/{rt_ids}` |

**两种映射模式：**

**模式 1: 直接映射 (`direct`)** — 源对象和目标对象的属性直接关联：

```python
# SDK 调用
client.relation_types.create(
    kn_id="kn_01",
    name="产品_库存",
    source_ot_id="ot_products",
    target_ot_id="ot_inventory",
    mappings=[("material_number", "material_code")],   # [(源属性, 目标属性)]
)

# → REST 请求体
{
    "entries": [{
        "name": "产品_库存",
        "source_object_type_id": "ot_products",
        "target_object_type_id": "ot_inventory",
        "type": "direct",
        "mapping_rules": [
            {
                "source_property": {"name": "material_number"},
                "target_property": {"name": "material_code"}
            }
        ]
    }]
}
```

**模式 2: 视图映射 (`data_view`)** — 通过中间数据视图关联：

```python
# SDK 调用
client.relation_types.create(
    kn_id="kn_01",
    name="产品_供应商",
    source_ot_id="ot_products",
    target_ot_id="ot_suppliers",
    mapping_view_id="dv_product_supplier",
    source_mappings=[("product_id", "prod_id")],    # [(对象属性, 视图字段)]
    target_mappings=[("supplier_id", "sup_id")],    # [(对象属性, 视图字段)]
)

# → REST 请求体
{
    "entries": [{
        "name": "产品_供应商",
        "source_object_type_id": "ot_products",
        "target_object_type_id": "ot_suppliers",
        "type": "data_view",
        "mapping_rules": {
            "backing_data_source": {
                "type": "data_view",
                "id": "dv_product_supplier"
            },
            "source_mapping_rules": [
                {
                    "source_property": {"name": "product_id"},
                    "target_property": {"name": "prod_id"}
                }
            ],
            "target_mapping_rules": [
                {
                    "source_property": {"name": "supplier_id"},
                    "target_property": {"name": "sup_id"}
                }
            ]
        }
    }]
}
```

SDK 根据是否传 `mapping_view_id` 自动选择映射模式。

### 6.6 query

对应服务: `agent-retrieval`（语义搜索）+ `ontology-query`（实例查询）

| 方法 | HTTP | 路径 | 服务 |
|------|------|------|------|
| `semantic_search(kn_id, query, mode?, max_concepts?)` | POST | `/api/agent-retrieval/v1/kn/semantic-search` | agent-retrieval |
| `kn_search(kn_id, query, only_schema?)` | POST | `/api/agent-retrieval/in/v1/kn/kn_search` | agent-retrieval |
| `instances(kn_id, ot_id, condition?, limit?)` | POST | `/api/ontology-query/v1/knowledge-networks/{kn_id}/object-types/{ot_id}` | ontology-query |
| `subgraph(kn_id, paths)` | POST | `/api/agent-retrieval/in/v1/kn/query_instance_subgraph` | agent-retrieval |

**语义搜索：**

```python
# SDK 调用
result = client.query.semantic_search(
    kn_id="kn_01",
    query="哪些产品库存不足",
    mode="keyword_vector_retrieval",    # 默认值
    max_concepts=10,                    # 默认值
)

# → REST 请求体
{
    "kn_id": "kn_01",
    "query": "哪些产品库存不足",
    "mode": "keyword_vector_retrieval",
    "rerank_action": "default",
    "max_concepts": 10,
    "return_query_understanding": false
}
```

语义搜索支持三种模式: `keyword_vector_retrieval`（关键词+向量检索）、`agent_intent_planning`（意图规划）、`agent_intent_retrieval`（意图检索）。

**实例查询：**

```python
# SDK 调用
result = client.query.instances(kn_id="kn_01", ot_id="ot_products",
                                condition=Condition(field="status", operation="==", value="active"),
                                limit=20)

# → REST 请求
# POST /api/ontology-query/v1/knowledge-networks/kn_01/object-types/ot_products
# Header: X-HTTP-Method-Override: GET
{
    "condition": {"field": "status", "operation": "==", "value": "active", "value_from": "const"},
    "limit": 20,
    "need_total": true
}
```

> **分页机制：** 实例查询使用 search_after 游标分页（基于 OpenSearch）。SDK 封装为迭代器接口：
>
> ```python
> # 自动分页遍历
> for batch in client.query.instances_iter(kn_id, ot_id, limit=100):
>     for item in batch.data:
>         process(item)
>
> # 手动翻页
> page1 = client.query.instances(kn_id, ot_id, limit=20)
> page2 = client.query.instances(kn_id, ot_id, limit=20, search_after=page1.search_after)
> ```

查询条件 `Condition` 支持递归组合: `{field, operation, value}` 或 `{operation: "and"/"or", sub_conditions: [...]}`.

支持的操作符: `==`, `!=`, `<`, `>`, `<=`, `>=`, `in`, `range`, `like` 等。

### 6.7 concept_groups（预留）

对应服务: `ontology-manager`。用于组织对象类/关系类的分组。v0.1 暂不实现，但 SDK 模块结构中预留位置。

| 方法 | HTTP | 路径 |
|------|------|------|
| `create(kn_id, name)` | POST | `.../knowledge-networks/{kn_id}/concept-groups` |
| `list(kn_id)` | GET | `.../knowledge-networks/{kn_id}/concept-groups` |
| `add_object_types(kn_id, cg_id, ot_ids)` | POST | `.../concept-groups/{cg_id}/object-types` |

语义搜索的 `search_scope.concept_groups` 参数依赖此模块。

### 6.8 action_types（预留）

对应服务: `ontology-manager`。用于定义可执行的业务操作（如发起采购订单）。v0.1 暂不实现。

| 方法 | HTTP | 路径 |
|------|------|------|
| `create(kn_id, name, action_type, object_type_id, action_source, ...)` | POST | `.../knowledge-networks/{kn_id}/action-types` |
| `list(kn_id)` | GET | `.../knowledge-networks/{kn_id}/action-types` |

`execute_action` Skill（§5.5）依赖此模块。

---

## 7 API 设计

SDK 的 Python 公共接口规约。面向两类使用者：直接调用 SDK 的开发者，以及基于 SDK 编写新 Skill 的作者。

### 7.1 Client

```python
from kweaver import ADPClient
from kweaver._auth import TokenAuth, OAuth2Auth

# 最简
client = ADPClient(base_url="https://adp.example.com", token="Bearer eyJ...")

# 完整
client = ADPClient(
    base_url="https://adp.example.com",
    auth=OAuth2Auth(client_id="...", client_secret="...", token_endpoint="..."),
    account_id="user-001",
    account_type="user",
    business_domain="domain-001",        # 注入 x-business-domain（算子/执行服务必需）
    timeout=30.0,
)

# Resource 通过属性访问
client.datasources       # DataSourcesResource
client.dataviews          # DataViewsResource
client.knowledge_networks # KnowledgeNetworksResource
client.object_types       # ObjectTypesResource
client.relation_types     # RelationTypesResource
client.query              # QueryResource
```

`ADPClient` 本身是无状态的（不持有业务数据），可以安全地在多线程间共享。

### 7.2 方法签名约定

所有 Resource 方法遵循统一模式：

| 操作 | 方法名 | 返回值 | 说明 |
|------|--------|--------|------|
| 创建 | `create(...)` | 实体对象 | 必填参数为位置参数，可选参数为关键字参数 |
| 列表 | `list(...)` | `list[T]` | 过滤条件均为可选关键字参数 |
| 详情 | `get(id)` | 实体对象 | 不存在时抛 `NotFoundError` |
| 更新 | `update(id, ...)` | 实体对象 | 仅传需要更新的字段 |
| 删除 | `delete(id)` | `None` | 不存在时抛 `NotFoundError` |

```python
# 创建：必填在前，可选在后
client.object_types.create(
    kn_id,                                  # 必填，位置参数
    name="产品",                            # 必填，关键字
    dataview_id=view.id,                    # 必填，关键字
    primary_keys=["material_number"],       # 必填，关键字（数组）
    display_key="product_name",             # 必填，关键字
    properties=None,                        # 可选，不传则自动继承
)

# 单主键快捷方式
client.object_types.create(
    kn_id, name="产品", dataview_id=view.id,
    primary_key="material_number",          # 等价于 primary_keys=["material_number"]
    display_key="product_name",
)

# 列表：全部可选
client.datasources.list()
client.datasources.list(keyword="erp", type="mysql")
```

### 7.3 类型定义

全部使用 Pydantic v2 BaseModel。按职责分三类：

**实体类型** — API 返回的业务对象：

```python
class DataSource(BaseModel):
    id: str
    name: str
    type: str                        # mysql, postgresql, ...
    comment: str | None = None

class DataView(BaseModel):
    id: str
    name: str
    query_type: str                  # SQL, DSL, IndexBase
    fields: list[ViewField]

class ViewField(BaseModel):
    name: str
    type: str
    display_name: str | None = None
    comment: str | None = None

class KnowledgeNetwork(BaseModel):
    id: str
    name: str
    tags: list[str] = []
    comment: str | None = None
    statistics: KNStatistics | None = None

class KNStatistics(BaseModel):
    object_types_total: int = 0
    relation_types_total: int = 0
    action_types_total: int = 0
    concept_groups_total: int = 0

class ObjectType(BaseModel):
    id: str
    name: str
    kn_id: str
    dataview_id: str                 # 从 data_source.id 提取
    primary_keys: list[str]
    display_key: str
    incremental_key: str | None = None
    properties: list[DataProperty]
    status: ObjectTypeStatus | None = None

class DataProperty(BaseModel):
    name: str
    display_name: str | None = None
    type: str                        # varchar, integer, timestamp, ...
    comment: str | None = None
    indexed: bool = False            # 从 index_config.keyword_config 提取
    fulltext: bool = False           # 从 index_config.fulltext_config 提取
    vector: bool = False             # 从 index_config.vector_config 提取

class ObjectTypeStatus(BaseModel):
    index_available: bool = False
    doc_count: int = 0
    storage_size: int = 0
    update_time: int = 0

class RelationType(BaseModel):
    id: str
    name: str
    kn_id: str
    source_ot_id: str
    target_ot_id: str
    mapping_type: str                # direct | data_view
```

**参数类型** — 用户构造后传入 SDK 的结构：

```python
class Property(BaseModel):
    """创建 ObjectType 时指定属性的索引配置。"""
    name: str
    display_name: str | None = None
    type: str | None = None
    indexed: bool = False
    fulltext: bool = False
    vector: bool = False

class Condition(BaseModel):
    """查询过滤条件，支持递归组合。"""
    field: str | None = None
    operation: str               # ==, !=, >, <, <=, >=, like, in, range, and, or
    value: Any = None
    value_from: str = "const"
    sub_conditions: list["Condition"] | None = None

class PathNode(BaseModel):
    id: str                      # 对象类 ID
    condition: Condition | None = None
    limit: int = 100

class PathEdge(BaseModel):
    id: str                      # 关系类 ID
    source: str
    target: str

class SubgraphPath(BaseModel):
    object_types: list[PathNode]
    relation_types: list[PathEdge]
```

**结果类型** — 查询返回的结构：

```python
class SemanticSearchResult(BaseModel):
    """语义搜索结果。"""
    concepts: list[ConceptResult]
    hits_total: int
    query_understanding: dict | None = None

class ConceptResult(BaseModel):
    concept_type: str            # object_type, relation_type, action_type
    concept_id: str
    concept_name: str
    concept_detail: dict | None = None
    intent_score: float = 0.0
    match_score: float = 0.0
    rerank_score: float = 0.0
    samples: list[dict] = []

class KnSearchResult(BaseModel):
    """KN 搜索结果（内部接口）。"""
    object_types: list[dict] | None = None
    relation_types: list[dict] | None = None
    action_types: list[dict] | None = None
    nodes: list[dict] | None = None

class InstanceResult(BaseModel):
    """实例查询结果。"""
    data: list[dict]
    total_count: int | None = None
    search_after: list[Any] | None = None   # 翻页游标
    object_type: dict | None = None         # include_type_info=True 时返回

class SubgraphResult(BaseModel):
    entries: list[dict]

class BuildJob(BaseModel):
    kn_id: str
    def wait(self, timeout: float = 300, poll_interval: float = 2.0) -> "BuildStatus": ...
    def poll(self) -> "BuildStatus": ...

class BuildStatus(BaseModel):
    state: str                   # running | completed | failed
    state_detail: str | None = None
```

### 7.4 错误处理

```python
class ADPError(Exception):
    """所有 SDK 异常的基类。"""
    status_code: int | None      # HTTP 状态码，网络错误时为 None
    error_code: str | None       # ADP 业务错误码
    message: str                 # 人类可读的错误描述
    trace_id: str | None         # 服务端 trace ID，用于跨团队排查

class AuthenticationError(ADPError): ...  # 401
class AuthorizationError(ADPError): ...   # 403
class NotFoundError(ADPError): ...        # 404
class ValidationError(ADPError): ...      # 400
class ConflictError(ADPError): ...        # 409
class ServerError(ADPError): ...          # 5xx
class NetworkError(ADPError): ...         # 网络不可达（避免与内置 ConnectionError 冲突）
```

**Skill 层的错误转换：** Skill 捕获 `ADPError` 后转换为 Agent 可理解的结构化结果，而非直接抛异常。

```python
# Skill 内部
try:
    kn = client.knowledge_networks.create(name=name)
except AuthorizationError:
    return {"error": True, "message": "当前账号无权创建知识网络，请联系管理员"}
except ServerError as e:
    return {"error": True, "message": f"ADP 服务异常 (trace: {e.trace_id})，请稍后重试"}
```

### 7.5 幂等与重试

| 层 | 策略 |
|-----|------|
| HTTP 层 | 对 `5xx` 和网络错误自动重试，最多 3 次，指数退避。`4xx` 不重试。 |
| SDK 层 | 不做额外重试，将错误抛给调用方。 |
| Skill 层 | 对可重试错误（网络、5xx）可选择重试整个步骤，对不可重试错误（400、403）直接返回。 |

`POST` 创建类接口不幂等，SDK 不自动重试。如需幂等，调用方应先 `list()` 检查是否已存在。

---

## 8 安全与认证

### 8.1 认证模型

```
┌─────────┐     ┌─────────┐     ┌───────────┐
│  Agent  │────▶│  Skill  │────▶│ ADPClient │──── Bearer Token ─────▶ ADP 服务
│         │     │         │     │           │──── x-account-id ─────▶
└─────────┘     └─────────┘     └───────────┘──── x-account-type ───▶
                                             ──── x-business-domain ▶
```

SDK 通过 `AuthProvider` 接口管理认证，所有请求自动注入认证 Header。

```python
client = ADPClient(
    base_url="https://adp.example.com",
    auth=TokenAuth("Bearer eyJ..."),        # 最简方式
    account_id="user-001",                  # 注入 x-account-id
    account_type="user",                    # 注入 x-account-type
    business_domain="bd-001",               # 注入 x-business-domain（算子服务必需）
)
```

### 8.2 认证方式

| 方式 | 适用场景 | 实现 |
|------|---------|------|
| **静态 Token** | 开发调试、短期脚本 | `TokenAuth(token)` |
| **OAuth2 Client Credentials** | 服务间调用、生产部署 | `OAuth2Auth(client_id, secret, token_endpoint)` — 自动获取并缓存 token，过期前刷新 |
| **自定义** | 特殊认证体系 | 实现 `AuthProvider` 接口 |

```python
class AuthProvider(Protocol):
    def auth_headers(self) -> dict[str, str]: ...

class OAuth2Auth(AuthProvider):
    def __init__(self, client_id: str, client_secret: str, token_endpoint: str): ...
    # 内部: token 缓存 + 过期前 30s 自动刷新 + 线程安全
```

### 8.3 凭据安全

| 风险 | 措施 |
|------|------|
| 数据源密码泄露（日志/异常） | SDK 在日志和异常信息中自动脱敏 `password` 字段，仅显示 `***` |
| Token 泄露 | `AuthProvider` 不在 `__repr__` 中暴露 token |
| Skill 层传递密码 | `connect_db` Skill 接收密码后仅传给 SDK，不写入返回值和日志 |
| 请求日志 | `log_requests=True` 时自动过滤 `Authorization` Header 和 body 中的敏感字段 |

### 8.4 权限边界

SDK 本身不做权限校验（由 ADP 服务端完成），但需要处理权限错误:

```python
class AuthenticationError(ADPError): ...   # 401 — Token 无效或过期
class AuthorizationError(ADPError): ...    # 403 — 无权限操作此资源
```

Skill 层在收到 403 时向 Agent 返回可理解的错误信息（"当前账号无权创建知识网络，请联系管理员"），而非裸露的 HTTP 状态码。

---

## 9 包结构

```
kweaver-sdk/
├── pyproject.toml
├── src/kweaver/
│   ├── __init__.py              # 导出 ADPClient, tools
│   ├── _client.py               # ADPClient
│   ├── _http.py                 # httpx + 重试 + 日志脱敏
│   ├── _auth.py                 # AuthProvider, TokenAuth, OAuth2Auth
│   ├── _errors.py               # ADPError 层级
│   ├── types.py                 # Pydantic 模型
│   ├── resources/               # SDK 内部模块
│   │   ├── datasources.py
│   │   ├── dataviews.py
│   │   ├── knowledge_networks.py
│   │   ├── object_types.py
│   │   ├── relation_types.py
│   │   └── query.py
│   └── skills/                  # Skill 层（对外 Tool 定义 + 编排逻辑）
│       ├── __init__.py          # 导出所有 Tool 定义
│       ├── _base.py             # Skill 基类
│       ├── connect_db.py
│       ├── build_kn.py
│       └── query_kn.py
└── tests/
    ├── conftest.py              # 共享 fixture: mock client, test config
    ├── unit/
    │   ├── test_auth.py
    │   ├── test_datasources.py
    │   ├── test_dataviews.py
    │   ├── test_knowledge_networks.py
    │   ├── test_object_types.py
    │   ├── test_relation_types.py
    │   └── test_query.py
    ├── skills/
    │   ├── test_connect_db.py
    │   ├── test_build_kn.py
    │   └── test_query_kn.py
    └── integration/
        └── test_full_flow.py    # 端到端: 数据库 → 知识网络 → 查询
```

---

## 10 测试

### 10.1 分层测试策略

测试按架构分层组织，每层有明确的测试目标和隔离方式：

```
┌───────────────────────────────────────────┐
│  Skill 测试                               │  mock SDK，验证编排逻辑
├───────────────────────────────────────────┤
│  SDK 单元测试                              │  mock HTTP，验证参数转换
├───────────────────────────────────────────┤
│  集成测试                                  │  真实 ADP 实例，验证端到端
└───────────────────────────────────────────┘
```

| 层 | 隔离方式 | 验证什么 | 运行时机 |
|----|---------|---------|---------|
| SDK 单元测试 | mock httpx 响应 | 参数转换（扁平→嵌套）、响应解析、错误映射 | 每次提交 |
| Skill 测试 | mock SDK Resource | 编排顺序、参数传递、错误处理、返回值组装 | 每次提交 |
| 集成测试 | 真实 ADP 实例 | 端到端流程、服务兼容性 | CI 定时 / 发版前 |

### 10.2 SDK 单元测试

mock HTTP 层，验证 SDK 方法是否正确地将扁平参数转换为 REST 请求、将 REST 响应解析为类型化对象。

```python
import httpx
import pytest
from kweaver import ADPClient
from kweaver._http import MockTransport

def test_datasource_create_transforms_params():
    """验证 SDK 扁平参数正确转换为 REST 嵌套结构。"""
    requests = []

    def handler(request: httpx.Request) -> httpx.Response:
        requests.append(request)
        return httpx.Response(200, json=[{"id": "ds_01"}])

    client = ADPClient(
        base_url="https://mock",
        token="test",
        transport=MockTransport(handler),
    )

    ds = client.datasources.create(
        name="测试库", type="mysql",
        host="10.0.1.100", port=3306,
        database="erp", account="root", password="secret",
    )

    # 验证请求 body 结构
    body = requests[0].content
    assert body["bin_data"]["host"] == "10.0.1.100"
    assert body["bin_data"]["database_name"] == "erp"
    assert body["bin_data"]["connect_protocol"] == "jdbc"
    assert "password" in body["bin_data"]

    # 验证返回类型
    assert ds.id == "ds_01"


def test_object_type_create_wraps_in_entries():
    """验证 create 将参数包装为 entries 数组，primary_keys 为数组。"""
    ...


def test_object_type_primary_key_shortcut():
    """primary_key='id' 应自动转换为 primary_keys=['id']。"""
    ...


def test_object_type_create_auto_inherits_fields():
    """properties 不传时，SDK 应从 DataView 自动继承字段。"""
    ...


def test_relation_type_direct_mapping():
    """不传 mapping_view_id 时，生成 direct 类型的 mapping_rules。"""
    ...


def test_relation_type_dataview_mapping():
    """传 mapping_view_id 时，生成 data_view 类型的 mapping_rules。"""
    ...


def test_instances_query_sends_method_override_header():
    """实例查询应发送 X-HTTP-Method-Override: GET header。"""
    ...


def test_instances_query_returns_search_after():
    """实例查询结果应包含 search_after 游标用于翻页。"""
    ...


def test_401_raises_authentication_error():
    """服务端返回 401 时，SDK 应抛出 AuthenticationError。"""
    def handler(request):
        return httpx.Response(401, json={"error_code": "TOKEN_EXPIRED", "message": "token expired"})

    client = ADPClient(base_url="https://mock", token="bad", transport=MockTransport(handler))

    with pytest.raises(AuthenticationError) as exc:
        client.datasources.list()
    assert exc.value.error_code == "TOKEN_EXPIRED"


def test_password_not_in_logs(caplog):
    """日志中不应出现明文密码。"""
    ...
```

### 10.3 Skill 测试

mock 整个 SDK 层，只验证 Skill 的编排逻辑：调用了哪些 SDK 方法、顺序是否正确、中间结果是否正确传递。

```python
from unittest.mock import MagicMock
from kweaver.skills.build_kn import BuildKnSkill
from kweaver.types import DataSource, DataView, KnowledgeNetwork, ObjectType, Table, Column

def test_build_kn_full_flow():
    """验证 build_kn 按正确顺序编排 SDK 调用。"""
    mock_client = MagicMock()

    # 设置 mock 返回值
    mock_client.datasources.list_tables.return_value = [
        Table(name="products", columns=[Column(name="id", type="integer")]),
        Table(name="inventory", columns=[Column(name="seq", type="integer")]),
    ]
    mock_client.dataviews.create.side_effect = [
        DataView(id="dv_01", name="products", query_type="SQL", fields=[]),
        DataView(id="dv_02", name="inventory", query_type="SQL", fields=[]),
    ]
    mock_client.knowledge_networks.create.return_value = KnowledgeNetwork(
        id="kn_01", name="test", statistics=None,
    )
    mock_client.object_types.create.side_effect = [
        ObjectType(id="ot_01", name="products", kn_id="kn_01", dataview_id="dv_01",
                   primary_keys=["id"], display_key="id", properties=[]),
        ObjectType(id="ot_02", name="inventory", kn_id="kn_01", dataview_id="dv_02",
                   primary_keys=["seq"], display_key="seq", properties=[]),
    ]
    mock_client.knowledge_networks.build.return_value = MagicMock()

    skill = BuildKnSkill(client=mock_client)
    result = skill.run(
        datasource_id="ds_01",
        tables=["products", "inventory"],
        relations=[{"name": "prod_inv", "from_table": "products", "to_table": "inventory",
                     "from_field": "id", "to_field": "product_id"}],
    )

    # 验证编排顺序
    assert mock_client.dataviews.create.call_count == 2
    assert mock_client.knowledge_networks.create.call_count == 1
    assert mock_client.object_types.create.call_count == 2
    assert mock_client.relation_types.create.call_count == 1
    assert mock_client.knowledge_networks.build.call_count == 1

    # 验证参数传递: relation_types.create 收到的是 object_type ID 而非表名
    rt_call = mock_client.relation_types.create.call_args
    assert rt_call.kwargs["source_ot_id"] == "ot_01"
    assert rt_call.kwargs["target_ot_id"] == "ot_02"

    # 验证返回值
    assert result["status"] == "ready"
    assert len(result["object_types"]) == 2


def test_build_kn_handles_auth_error():
    """SDK 抛出 AuthorizationError 时，Skill 返回可读错误而非抛异常。"""
    mock_client = MagicMock()
    mock_client.datasources.list_tables.return_value = []
    mock_client.knowledge_networks.create.side_effect = AuthorizationError(
        status_code=403, error_code="FORBIDDEN", message="no permission", trace_id="t1"
    )

    skill = BuildKnSkill(client=mock_client)
    result = skill.run(datasource_id="ds_01")

    assert result["error"] is True
    assert "无权" in result["message"]


def test_build_kn_empty_tables_uses_all():
    """tables 参数为空时，应纳入 list_tables 返回的全部表。"""
    ...
```

### 10.4 集成测试

对真实 ADP 实例运行端到端流程。通过环境变量配置连接信息，CI 中定时执行。

```python
import os
import pytest
from kweaver import ADPClient

SKIP_REASON = "ADP_BASE_URL not set"

@pytest.fixture
def client():
    base_url = os.getenv("ADP_BASE_URL")
    token = os.getenv("ADP_TOKEN")
    if not base_url:
        pytest.skip(SKIP_REASON)
    return ADPClient(base_url=base_url, token=token, account_id=os.getenv("ADP_ACCOUNT_ID", "test"))


def test_full_flow_database_to_query(client):
    """端到端: 连接数据库 → 创建知识网络 → 查询。"""
    # 1. 连接（使用测试数据库）
    ds = client.datasources.create(
        name="sdk_integration_test",
        type=os.getenv("ADP_TEST_DB_TYPE", "mysql"),
        host=os.getenv("ADP_TEST_DB_HOST"),
        port=int(os.getenv("ADP_TEST_DB_PORT", "3306")),
        database=os.getenv("ADP_TEST_DB_NAME"),
        account=os.getenv("ADP_TEST_DB_USER"),
        password=os.getenv("ADP_TEST_DB_PASS"),
    )

    try:
        # 2. 发现表
        tables = client.datasources.list_tables(ds.id)
        assert len(tables) > 0

        # 3. 创建视图
        view = client.dataviews.create(name="test_view", datasource_id=ds.id, table=tables[0].name)

        # 4. 创建知识网络 + 对象类
        kn = client.knowledge_networks.create(name="sdk_test_kn")
        ot = client.object_types.create(
            kn_id=kn.id, name="test_ot",
            dataview_id=view.id,
            primary_keys=[tables[0].columns[0].name],
            display_key=tables[0].columns[0].name,
        )

        # 5. 构建
        client.knowledge_networks.build(kn.id).wait(timeout=120)

        # 6. 查询
        result = client.query.semantic_search(kn_id=kn.id, query="test")
        assert result is not None

    finally:
        # 清理（逆序删除）
        client.knowledge_networks.delete(kn.id)
        client.dataviews.delete(view.id)
        client.datasources.delete(ds.id)
```

### 10.5 测试配置

```ini
# pyproject.toml
[tool.pytest.ini_options]
testpaths = ["tests"]
markers = [
    "integration: 需要真实 ADP 实例（通过环境变量配置）",
]

# 默认只跑单元测试，集成测试需显式指定
addopts = "-m 'not integration'"
```

```bash
# 本地开发: 只跑单元测试
pytest

# CI / 发版前: 跑全部
pytest -m ""

# 只跑集成测试
ADP_BASE_URL=https://... ADP_TOKEN=... pytest -m integration
```

---

## 11 扩展路线

| 用例 | 新增 Skill | 新增 SDK 模块 | 依赖的已有模块 |
|------|-----------|--------------|--------------|
| 执行业务操作（发起 PO） | `execute_action` | `action_types` | query |
| BOM 展开 / 指标计算 | `compute_metric` | `query.logic_properties()` | query |
| 从文档构建知识网络 | `import_docs` | 文档解析模块 | knowledge_networks, object_types, relation_types |
| 管理知识网络 | `manage_kn` | `concept_groups` | knowledge_networks, object_types, relation_types |
| 算子管理 | `manage_operators` | `operators` resource | — |
| 外部 MCP 接入 | — | `mcp` resource | — |

---

## 附录 A: v0.1 → v0.2 变更记录

| 变更 | 原因 |
|------|------|
| `primary_key: str` → `primary_keys: list[str]`（保留 `primary_key` 快捷方式） | 与 ADP 实际 API 对齐，支持复合主键 |
| `list_tables` 路径修正为 `/api/data-connection/v1/metadata/data-source/{id}` | 与实际 data-connection 服务路径对齐 |
| `db_type` 枚举扩展为 19 种数据源 | 对齐 ADP ConnectorEnums 完整列表 |
| `query.search()` → `query.semantic_search()` + `query.kn_search()` | 区分两个不同的搜索接口，semantic_search 功能更完整 |
| `instances()` 路径修正为 ontology-query 服务 | 实际实例查询在 ontology-query 而非 agent-retrieval |
| 新增 search_after 游标分页 + `instances_iter()` | 对齐 ADP 基于 OpenSearch 的分页机制 |
| `ConnectionError` → `NetworkError` | 避免与 Python 内置 `ConnectionError` 冲突 |
| 新增 `business_domain` 参数 | 算子/执行服务（execution-factory）必需 x-business-domain header |
| 包名 `adp` → `kweaver` | 避免通用名冲突，与项目名 kweaver-sdk 一致 |
| 新增 `concept_groups`、`action_types` 预留模块（§6.7/§6.8） | 为 execute_action / manage_kn Skill 预留扩展点 |
| 补充 REST 请求体的 `entries` 数组包装 | 对齐 ontology-manager 批量创建 API 的实际结构 |
| 补充 DataView 创建时 `data_scope` 的完整结构 | 消除实现时的歧义 |
| 补充 RelationType 两种映射模式的完整参数映射 | 原文档只描述了 direct 模式 |
| 移除关系自动推断（"为空则根据同名字段自动推断"） | 推断逻辑不明确且 ADP 不提供此能力，要求显式指定 |
| `build_status` 明确使用 `kn_id` 查询（非 job_id） | 与 agent-retrieval 实际接口对齐 |
| HTTP 层服务列表更新 | 新增 ontology-query 服务，明确各服务职责 |
