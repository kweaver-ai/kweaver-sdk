# Vega 命令参考

Vega 可观测平台：Catalog 管理、数据资源查询、连接器类型、健康巡检。

## 概览

```bash
kweaver vega                         # 帮助信息
kweaver vega health                  # 服务健康检查
kweaver vega stats                   # Catalog 数量统计
kweaver vega inspect                 # 聚合诊断（health + catalog 数量 + 运行中的 discover 任务）
```

## Catalog

```bash
kweaver vega catalog list [--status healthy|degraded|unhealthy|offline|disabled] [--limit N] [--offset N]
kweaver vega catalog get <id>
kweaver vega catalog create --name <n> --connector-type <t> --connector-config <json> [--tags t1,t2] [--description s]
kweaver vega catalog update <id> [--name X] [--connector-type X] [--tags X] [--description X]
kweaver vega catalog delete <ids...> [-y]
kweaver vega catalog health <ids...> | --all
kweaver vega catalog test-connection <id>
kweaver vega catalog discover <id> [--wait]
kweaver vega catalog resources <id> [--category table|index|...] [--limit N]
```

### Catalog 注册（关键流程）

要通过 `vega sql` 查询 MySQL / PostgreSQL 等外部数据库，**必须先在 Vega 注册物理 Catalog**：

```bash
kweaver vega catalog create \
  --name "my_mysql" \
  --connector-type mysql \
  --connector-config '{"host":"<db-host>","port":3306,"username":"<user>","password":"<pass>","databases":["<db>"]}' \
  --pretty
```

- `connector-type` 可选值：`mysql` / `mariadb` / `postgresql` / `opensearch`
- `connector-config` 字段因类型而异，用 `kweaver vega connector-type get <type>` 查看 `field_config`
- 注册时后端会**测试连接**，密码错误或网络不通会被拒绝
- **注意**：`host` 需用 Vega 后端容器能访问的地址（通常是 Docker/K8s 内网 IP，而非公网 IP）

注册成功后，需**创建 Resource** 将物理表映射为 Vega 资源（`catalog discover` 可自动扫描；若 Redis 不可用则需手动创建）：

```bash
# 自动发现（需 Redis）
kweaver vega catalog discover <catalog-id> --wait

# 或手动创建
kweaver vega resource create \
  --catalog-id <catalog-id> \
  --name "my_table" \
  --category table \
  -d '{"source_identifier":"<db>.<table>"}'
```

## Resource

```bash
kweaver vega resource list [--catalog-id <id>] [--category table] [--status active] [--limit N] [--offset N]
kweaver vega resource get <id>
kweaver vega resource create --catalog-id <cid> --name <n> --category <cat> [-d <json>]
kweaver vega resource update <id> [--name X] [--status X] [--tags X] [-d json]
kweaver vega resource delete <ids...> [-y]
kweaver vega resource query <id> -d '<json-body>'   # POST .../resources/:id/data（结构化过滤、分页）
kweaver vega resource preview <id> [--limit N]
```

## 结构化查询（vega-backend）

`POST /api/vega-backend/v1/query/execute` — 单 Catalog 内多表 JOIN、过滤、排序、分页；**不经过** `vega-calculate-coordinator`（Trino）。

```bash
kweaver vega query execute -d '<json>'
```

请求体字段：

| 字段 | 说明 |
|------|------|
| `query_id` | 同一轮分页保持一致；首页 `offset=0` 可不传，后端生成 |
| `tables` | 必填。`[{ "resource_id": "...", "alias": "t1" }]` |
| `joins` | 可选。`type`: inner / left / right / full；`left_table_alias` / `right_table_alias`；`on`: `[{ "left_field", "right_field" }]`（**JOIN ON 使用 schema 中的字段名**，与 `resource get` 中 `schema_definition[].name` 一致） |
| `output_fields` | 可选，如 `["t1.col_a", "t2.col_b"]` |
| `filter_condition` | 可选，见下方 |
| `sort` | 可选，`[{ "field": "t1.col", "direction": "asc|desc" }]` |
| `offset` / `limit` | 分页；`limit` 最大 10000 |
| `need_total` | 是否返回 `total_count` |

**限制**：所有 `tables` 必须属于**同一** Catalog；跨 Catalog JOIN 会返回 501。

**filter_condition** 常用 `operation`：

- 比较：`==` / `eq`，`!=` / `not_eq`，`>` / `gt`，`>=` / `gte`，`<` / `lt`，`<=` / `lte`
- 集合：`in`，`not_in`（值为数组）
- 模糊：`like`，`not_like`（**仅当字段在 schema 中为 string 类型时**）
- 范围：`range`（数值或日期字段，值为 `[min, max]`）
- 空值：`null`，`not_null`
- 逻辑：`and` / `or`，子条件放在 `sub_conditions` 数组中

叶子条件通常含：`field`、`operation`、`value`、`value_from`（常量用 `"const"`）。

示例（单表）：

```bash
kweaver vega query execute -d '{"tables":[{"resource_id":"<res-id>"}],"limit":5,"need_total":true}'
```

示例（两表 JOIN + 过滤）：

```bash
kweaver vega query execute -d '{
  "tables": [
    {"resource_id":"<id-a>","alias":"a"},
    {"resource_id":"<id-b>","alias":"b"}
  ],
  "joins":[{"type":"inner","left_table_alias":"a","right_table_alias":"b","on":[{"left_field":"fk_col","right_field":"pk_col"}]}],
  "output_fields":["a.name","b.amount"],
  "filter_condition":{"field":"a.status","operation":"==","value":"active","value_from":"const"},
  "limit":10
}'
```

## SQL 查询（vega-backend）

`POST /api/vega-backend/v1/resources/query` — 在 **MySQL / MariaDB / PostgreSQL** 上执行 SQL，或在 **OpenSearch** 上执行 DSL；由 vega-backend 直连数据源并可用 sqlglot 做方言转换。**不依赖** Etrino / Trino。

```bash
kweaver vega sql -d '<json>'
kweaver vega sql --help
```

请求体字段：

| 字段 | 说明 |
|------|------|
| `query` | 必填。SQL 字符串，或 OpenSearch 的 DSL 对象 |
| `resource_type` | 必填。`mysql` \| `mariadb` \| `postgresql` \| `opensearch` |
| `stream_size` | 可选，流式批次 100–10000，默认 10000 |
| `query_timeout` | 可选，秒，1–3600，默认 60 |
| `query_id` | 可选，游标会话 |

SQL 中**应使用**占位符 `{{.<资源ID>}}` 或 `{{<资源ID>}}`，**资源 ID** 为 Vega 资源 id（与 `vega resource get` 一致）；后端会替换为该资源的物理表标识（`SourceIdentifier`），并**通过资源所属 Catalog 的 connector 连接数据库**。

> **重要**：占位符是 vega-backend 识别使用哪个 Catalog connector 的依据。不含占位符的裸 SQL（即便传了 `catalog_id`）可能因全局默认 connector 未配置而失败（`connector config is incomplete`）。**推荐始终使用 `{{resource_id}}` 占位符。**

示例（占位符）：

```bash
kweaver vega sql -d '{
  "resource_type":"mysql",
  "query":"SELECT supplier_name, city FROM {{<your_resource_id>}} LIMIT 5"
}'
```

（将 `<your_resource_id>` 换为 `vega resource get` 返回的资源 id。）

统计聚合示例：

```bash
kweaver vega sql -d '{
  "resource_type":"mysql",
  "query":"SELECT city, COUNT(*) AS cnt FROM {{<resource_id>}} GROUP BY city ORDER BY cnt DESC"
}'
```

响应含 `columns`、`entries`、`total_count`、`stats`（含 `has_more`、`search_after` 等，用于流式/分页）。

## 三种查询方式对照

| 方式 | 命令 / 路径 | 适用场景 |
|------|-------------|----------|
| 结构化查询 | `vega query execute` | 单 Catalog 内表/JOIN、统一 filter DSL、offset 分页 |
| 直连 SQL | `vega sql` | 复杂 SQL、聚合、或 `{{.<资源ID>}}` / `{{<资源ID>}}` 占位符 |
| 资源数据 API | `vega resource query <id> -d {...}` | 按单个 resource 拉数（filter、sort、search_after） |
| Dataview + `--sql` | `dataview query ... --sql` | 走 **mdl-uniquery + Trino**，需 Etrino / coordinator |

## Connector Type

```bash
kweaver vega connector-type list
kweaver vega connector-type get <type>
```

## 公共参数

所有子命令支持：

- `-bd, --biz-domain <s>` — 业务域（默认 `bd_public`）
- `--pretty` — 格式化 JSON 输出（默认开启）

## 端到端示例

```bash
# 巡检
kweaver vega inspect
kweaver vega catalog health --all

# ── 注册外部数据库为 Catalog ──
kweaver vega connector-type list                     # 查看可用连接器
kweaver vega connector-type get mysql                # 查看 MySQL 连接参数
kweaver vega catalog create --name "my_db" \
  --connector-type mysql \
  --connector-config '{"host":"172.19.0.9","port":3306,"username":"user","password":"pass","databases":["mydb"]}'

# ── 创建 Resource（手动 / 或 discover 自动扫描）──
kweaver vega resource create --catalog-id <catalog-id> \
  --name "orders" --category table \
  -d '{"source_identifier":"mydb.orders"}'

# 查看 catalog 下的资源
kweaver vega catalog list
kweaver vega catalog resources <catalog-id> --category table

# 预览资源数据
kweaver vega resource preview <resource-id> --limit 5

# 查询资源数据（结构化 body）
kweaver vega resource query <resource-id> -d '{"limit":10,"offset":0}'

# 结构化多表查询
kweaver vega query execute -d '{"tables":[{"resource_id":"<id>"}],"limit":20}'

# 直连 SQL（必须用 {{resource_id}} 占位符路由到正确的 connector）
kweaver vega sql -d '{"resource_type":"mysql","query":"SELECT * FROM {{<resource-id>}} LIMIT 10"}'
```
