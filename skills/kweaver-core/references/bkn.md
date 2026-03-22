# BKN 命令参考

知识网络管理：schema CRUD、构建、导出、推送/拉取。

## 概览

```bash
kweaver bkn list                     # 列出知识网络
kweaver bkn get <kn_id> [--stats] [--export]
```

## 知识网络

```bash
kweaver bkn list [--name <n>] [--name-pattern <p>] [--tag <t>] [--sort update_time] [--direction desc] [--offset 0] [--limit 50] [-v]
kweaver bkn get <kn_id> [--stats] [--export]
kweaver bkn stats <kn_id>
kweaver bkn export <kn_id>
kweaver bkn create [options]                         # 创建空知识网络（或 --body-file）
kweaver bkn create-from-ds <ds_id> --name <name> [--tables <t1,t2>] [--build/--no-build] [--timeout 300]
kweaver bkn update <kn_id> [--name <n>] [--description <d>] [--tag <t> ...]
kweaver bkn build <kn_id> [--wait/--no-wait] [--timeout 300]
kweaver bkn delete <kn_id> [--yes]
kweaver bkn validate <directory>                        # 验证本地 BKN 目录（不上传）
kweaver bkn push <directory> [--branch main]            # 上传 BKN 目录为 tar
kweaver bkn pull <kn_id> [<directory>] [--branch main]  # 下载 BKN tar 并解压
```

## Object Type

```bash
kweaver bkn object-type list <kn_id>
kweaver bkn object-type get <kn_id> <ot_id>                # -v 显示完整 data_properties
kweaver bkn object-type create <kn_id> --name <n> --dataview-id <dv> --primary-key <pk> --display-key <dk> [--property '<json>' ...]
kweaver bkn object-type update <kn_id> <ot_id> [--name <n>] [--display-key <dk>]
kweaver bkn object-type delete <kn_id> <ot_ids> [--yes/-y]
kweaver bkn object-type query <kn_id> <ot_id> ['<json>']   # 查询实例（默认 limit=30，支持 --limit/--search-after）
kweaver bkn object-type properties <kn_id> <ot_id> '<json>' # 查询实例属性
```

## object-type query 条件过滤

`query` 的 JSON body 支持 `condition` 字段，用于服务端过滤，避免全量拉取后本地筛选。

### 语法

```jsonc
// 单条件（limit 默认 30，可省略）
{"limit": 30, "condition": {"field": "quantity", "operation": ">", "value": 4000}}

// 多条件组合（AND）
{"limit": 30, "condition": {
  "operation": "and",
  "sub_conditions": [
    {"field": "quantity", "operation": ">", "value": 4000},
    {"field": "status", "operation": "==", "value": "active"}
  ]
}}

// OR 组合
{"limit": 30, "condition": {
  "operation": "or",
  "sub_conditions": [
    {"field": "category", "operation": "==", "value": "A"},
    {"field": "category", "operation": "==", "value": "B"}
  ]
}}
```

### 支持的 operation

| 类型 | operation | SQL 视图兼容 |
|------|-----------|:----------:|
| 比较 | `==`, `!=`, `>`, `>=`, `<`, `<=` | ✅ |
| 范围 | `in`, `not_in` | ✅ |
| 文本 | `like`, `not_like` | ✅ |
| 逻辑组合 | `and`, `or`（配合 `sub_conditions` 数组） | ✅ |
| 范围（索引） | `range`, `out_range` | ⚠️ 仅 OpenSearch |
| 文本（索引） | `contain`, `not_contain`, `prefix`, `regex` | ⚠️ 仅 OpenSearch |
| 全文搜索 | `match`, `match_phrase`, `multi_match` | ❌ SQL 视图报 500 |
| 空值/存在 | `exist`, `not_exist`, `null`, `not_null`, `empty`, `not_empty` | ⚠️ 仅 OpenSearch |

> **重要**：大部分数据源（MySQL / PostgreSQL）通过 SQL 视图查询。上表"SQL 视图兼容"列为 ✅ 的操作符可安全使用；标 ⚠️ 或 ❌ 的仅在 OpenSearch 索引模式下可用，SQL 视图下会返回 400 或 500 错误。
>
> **常见错误**：`eq`、`gt`、`lt`、`gte`、`lte` **不是合法操作符**，会返回 400 InvalidParameter。正确写法是 `==`、`>`、`<`、`>=`、`<=`。

### 分页与大数据量查询

对于数据量大的对象类型（如 BOM），单次查询返回数据可能非常大。建议：

- **设置合理的 limit**：数据量大的对象类型（BOM、物料等）建议 `limit` 不超过 30
- **使用 `search_after` 游标分页**：首次查询返回 `search_after` 字段，传入下一次查询实现翻页

```bash
# 首次查询
kweaver bkn object-type query <kn-id> <ot-id> '{"limit":20}'
# 返回 {"datas": [...], "search_after": ["val1","val2","val3"]}

# 翻页：将上次返回的 search_after 传入
kweaver bkn object-type query <kn-id> <ot-id> '{"limit":20,"search_after":["val1","val2","val3"]}'
```

### 示例

```bash
# 数量大于 4000 的产品
kweaver bkn object-type query <kn-id> <ot-id> '{"limit":30,"condition":{"field":"quantity","operation":">","value":4000}}'

# 名称模糊匹配"手机"且价格 >= 1000
kweaver bkn object-type query <kn-id> <ot-id> '{"limit":30,"condition":{"operation":"and","sub_conditions":[{"field":"name","operation":"like","value":"%手机%"},{"field":"price","operation":">=","value":1000}]}}'

# 状态为 active 或 pending（用 in）
kweaver bkn object-type query <kn-id> <ot-id> '{"limit":30,"condition":{"field":"status","operation":"in","value":["active","pending"]}}'
```

> **注意**：不支持 `{"field": {">": value}}` 这种简写语法，必须使用 `{"field": ..., "operation": ..., "value": ...}` 结构。

## Relation Type

```bash
kweaver bkn relation-type list <kn_id>
kweaver bkn relation-type get <kn_id> <rt_id>
kweaver bkn relation-type create <kn_id> --name <n> --source <ot_id> --target <ot_id> [--mapping src:tgt ...]
kweaver bkn relation-type update <kn_id> <rt_id> [--name <n>]
kweaver bkn relation-type delete <kn_id> <rt_ids> [--yes/-y]
```

## Search

```bash
kweaver bkn search <kn_id> <query> [--max-concepts <n>] [--mode <mode>]   # 语义搜索
```

## Subgraph

```bash
kweaver bkn subgraph <kn_id> '<json>'   # 子图查询
```

## Action Type / Log / Execution

```bash
kweaver bkn action-type list <kn_id>
kweaver bkn action-type query <kn_id> <at_id> '<json>'
kweaver bkn action-type execute <kn_id> <at_id> '<json>'   # 有副作用，执行前确认
kweaver bkn action-execution get <kn_id> <execution_id> [--wait/--no-wait] [--timeout 300]
kweaver bkn action-log list <kn_id> [--offset 0] [--limit 20] [--sort create_time] [--direction desc]
kweaver bkn action-log get <kn_id> <log_id>
kweaver bkn action-log cancel <kn_id> <log_id> [--yes/-y]
```

## 端到端示例

```bash
# 接入数据源 → 创建 KN → 查询
kweaver ds connect mysql db.example.com 3306 erp --account root --password pass
kweaver bkn create-from-ds <ds_id> --name "erp-kn" --build
kweaver bkn object-type list <kn_id>
kweaver bkn search <kn_id> "订单"
```
