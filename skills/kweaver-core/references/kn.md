# 知识网络管理与查询

管理知识网络（KN），以及查询对象实例、子图、语义搜索。

## CLI 命令总览

### 管理

| 命令 | 说明 |
|------|------|
| `kweaver kn list [--name <filter>]` | 列出知识网络 |
| `kweaver kn get <kn-id>` | 查看网络详情 |
| `kweaver kn export <kn-id>` | 导出网络定义（对象类型、关系类型、属性） |
| `kweaver kn build <kn-id> [--no-wait] [--timeout N]` | 触发全量构建 |
| `kweaver kn delete <kn-id>` | 删除网络（需确认） |

### 查询

| 命令 | 说明 |
|------|------|
| `kweaver query search <kn-id> "<query>" [--max-concepts N]` | 语义搜索 |
| `kweaver query instances <kn-id> <ot-id> [--condition '<json>'] [--limit N]` | 对象实例查询 |
| `kweaver query kn-search <kn-id> "<query>" [--only-schema]` | KN schema 搜索 |

### 通用 API 调用

```bash
kweaver call /api/ontology-manager/v1/knowledge-networks
kweaver call /api/ontology-query/v1/knowledge-networks/<kn-id>/object-types/<ot-id> -X POST -d '<json>'
```

## SDK Skill 用法

### connect_db — 连接数据库

```python
from kweaver.skills import ConnectDbSkill
result = ConnectDbSkill(client).run(
    db_type="mysql", host="10.0.1.100", port=3306,
    database="erp_prod", account="readonly", password="xxx",
)
# -> { datasource_id, tables: [{ name, columns }] }
```

### build_kn — 构建知识网络

```python
from kweaver.skills import BuildKnSkill
result = BuildKnSkill(client).run(
    datasource_id="<id>", network_name="erp_prod",
    tables=["products", "inventory"],
    relations=[{"name": "产品_库存", "from_table": "products", "to_table": "inventory",
                "from_field": "material_number", "to_field": "material_code"}],
)
# -> { kn_id, kn_name, object_types, relation_types, status }
```

### load_kn_context — 查看结构与数据

```python
from kweaver.skills import LoadKnContextSkill
skill = LoadKnContextSkill(client)

# 列出所有知识网络
result = skill.run(mode="overview")

# 查看 Schema
result = skill.run(mode="schema", kn_name="erp_prod", include_samples=True, sample_size=3)

# 浏览实例
result = skill.run(mode="instances", kn_name="erp_prod", object_type="products", limit=10)
```

### query_kn — 查询知识网络

```python
from kweaver.skills import QueryKnSkill
skill = QueryKnSkill(client)

# 语义搜索
result = skill.run(kn_id="<id>", mode="search", query="高库存的产品")

# 精确查询
result = skill.run(kn_id="<id>", mode="instances", object_type="products",
                   conditions={"field": "status", "operation": "eq", "value": "active"}, limit=20)

# 子图查询
result = skill.run(kn_id="<id>", mode="subgraph", start_object="products",
                   start_condition={"field": "category", "operation": "eq", "value": "电子"},
                   path=["inventory", "suppliers"])
```

## Condition 语法

```json
// 单条件
{"field": "name", "operation": "like", "value": "高血压"}

// 组合条件
{"operation": "and", "sub_conditions": [
  {"field": "name", "operation": "like", "value": "高血压"},
  {"field": "severity", "operation": "eq", "value": "重度"}
]}
```

操作符：`eq`、`neq`、`gt`、`gte`、`lt`、`lte`、`in`、`not_in`、`like`、`not_like`、`exist`、`not_exist`、`match`。

## 默认策略

- 用户说"看看有哪些知识网络"：`kweaver kn list` 或 `skill.run(mode="overview")`
- 用户说"查某个知识网络的结构"：`kweaver kn export <id>` 或 `skill.run(mode="schema", kn_name="...")`
- 用户说"查对象实例"：`kweaver query instances` 或 `skill.run(mode="instances")`
- 用户有模糊的业务问题：`kweaver query search` 或 `skill.run(mode="search")`

## 典型编排

1. **从零构建**: connect_db → build_kn → load_kn_context(schema) → query_kn
2. **探索已有**: load_kn_context(overview) → load_kn_context(schema) → query_kn
3. **直接查询**: 已知 kn_id 时直接 query_kn
