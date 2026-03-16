# 知识网络管理与查询

> **命令名说明：** TypeScript CLI 使用 `kweaver bkn …`，Python CLI 使用 `kweaver kn …`。
> 本文档以 TypeScript CLI 为主（`bkn`）；Python 用户将所有 `bkn` 替换为 `kn` 即可。

管理知识网络（KN），以及通过 ontology-query 查询对象、子图、属性和行动。

## 命令总览

### 管理（ontology-manager）

| 命令 | 说明 |
|------|------|
| `kweaver bkn list [options]` | 列出知识网络 |
| `kweaver bkn get <kn-id> [options]` | 查看网络详情 |
| `kweaver bkn stats <kn-id>` | 查看网络统计 |
| `kweaver bkn export <kn-id>` | 导出网络定义 |
| `kweaver bkn create [options]` | 创建网络 |
| `kweaver bkn update <kn-id> [options]` | 更新网络 |
| `kweaver bkn delete <kn-id> [--yes]` | 删除网络（默认需确认） |

### Schema 列表（ontology-manager）

| 命令 | 说明 |
|------|------|
| `kweaver bkn object-type list <kn-id>` | 列出对象类 |
| `kweaver bkn relation-type list <kn-id>` | 列出关系类 |
| `kweaver bkn action-type list <kn-id>` | 列出行动类 |

### 查询（ontology-query 只读）

| 命令 | 说明 |
|------|------|
| `kweaver bkn object-type query <kn-id> <ot-id> ['<json>'] [--limit n]` | 对象实例查询 |
| `kweaver bkn object-type properties <kn-id> <ot-id> '<json>'` | 对象属性查询 |
| `kweaver bkn subgraph <kn-id> '<json>'` | 子图查询 |
| `kweaver bkn action-type query <kn-id> <at-id> '<json>'` | 行动信息查询 |

### Action（有副作用）

| 命令 | 说明 |
|------|------|
| `kweaver bkn action-type execute <kn-id> <at-id> '<json>' [--wait]` | 执行行动 |
| `kweaver bkn action-execution get <kn-id> <execution-id>` | 获取执行状态 |
| `kweaver bkn action-log list/get/cancel ...` | 执行日志 |

### Python 独有：数据源与高层查询

| 命令 | 说明 |
|------|------|
| `kweaver ds connect/list/get/tables` | 数据源管理 |
| `kweaver query search <kn-id> "<query>"` | 语义搜索 |
| `kweaver query instances <kn-id> <ot-id>` | 对象实例 |
| `kweaver query subgraph <kn-id> --start-type ... --path ...` | 子图查询 |

### 通用 API 调用

```bash
kweaver call /api/ontology-manager/v1/knowledge-networks
kweaver call <path> -X POST -d '<json>' -H "Name: Value" -bd <domain>
```

## CLI 用法详解

### 连接数据库

```bash
kweaver ds connect --type mysql --host 10.0.1.100 --port 3306 \
  --database erp_prod --account readonly --password xxx
# -> 返回 datasource_id 和 tables 列表
```

### 创建并构建知识网络

```bash
# 创建知识网络
kweaver bkn create --name erp_prod --ds-id <datasource-id> \
  --tables products,inventory \
  --relations '[{"name":"产品_库存","from_table":"products","to_table":"inventory","from_field":"material_number","to_field":"material_code"}]'
# -> 返回 kn_id

# 触发构建
kweaver bkn build <kn-id>
# -> 等待构建完成，返回状态
```

### 查看结构与数据

```bash
# 列出所有知识网络
kweaver bkn list

# 按名称筛选
kweaver bkn list --name erp

# 查看网络详情
kweaver bkn get <kn-id>

# 导出 Schema（对象类型、关系类型、属性）
kweaver bkn export <kn-id>
```

### 查询知识网络

```bash
# 语义搜索
kweaver query search <kn-id> "高库存的产品"

# 精确查询对象实例
kweaver query instances <kn-id> <ot-id> \
  --condition '{"field":"status","operation":"eq","value":"active"}' --limit 20

# 子图查询
kweaver query subgraph <kn-id> --start <ot-id> \
  --condition '{"field":"category","operation":"eq","value":"电子"}' \
  --path inventory,suppliers
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

- 用户说"看看有哪些知识网络"：`kweaver bkn list`
- 用户说"查某个知识网络的结构"：`kweaver bkn export <id>`
- 用户说"查对象实例"：`kweaver query instances <kn-id> <ot-id>`
- 用户有模糊的业务问题：`kweaver query search <kn-id> "..."`

## 典型编排

（Python 用户：`bkn create` → `kn create`，`bkn build` → `kn build`，依此类推）

1. **从零构建**: `ds connect` -> `bkn create` -> `bkn build` -> `bkn export` -> `query search`
2. **探索已有**: `bkn list` -> `bkn export <id>` -> `query instances` / `query search`
3. **直接查询**: 已知 kn_id 时直接 `query search` 或 `query instances`
