# Resource 命令参考（resource / res）

平台 **vega-backend** 服务暴露的资源对象（HTTP：`/api/vega-backend/v1/resources`）。支持 `table`（原子表）和 `logicview`（逻辑视图）两种类型。

## 命令

```bash
kweaver resource list [--datasource-id <id>] [--type <table|logicview>] [--limit <n>] [-bd value] [--pretty]
kweaver resource find --name <name> [--exact] [--datasource-id <id>] [--wait] [--no-wait] [--timeout <ms>] [-bd value] [--pretty]
kweaver resource get <id> [-bd value] [--pretty]
kweaver resource query <id> [--limit <n>] [--offset <n>] [--need-total] [-bd value] [--pretty]
kweaver resource delete <id> [-y] [-bd value]
```

别名：`res`（如 `kweaver res list`）。

**`query`**：从 vega-backend 资源获取数据行，走 `POST /api/vega-backend/v1/resources/{id}/data`（服务端以 GET 语义处理）。

### 参数说明

| 选项 | 含义 |
|------|------|
| `--datasource-id` | 按 catalog（数据源）ID 过滤（`catalog_id`） |
| `--type` | 资源类型：`table` 或 `logicview` |
| `--limit` | 返回条数上限；`list` 默认 30，`query` 默认 50 |
| `--offset` | 仅 **`query`**：分页偏移量（默认 0） |
| `--need-total` | 仅 **`query`**：同时返回总条数 |
| `--name` | 仅 **`find`**：服务端按名称模糊搜索；加 `--exact` 在客户端再做精确过滤 |
| `--exact` | 仅 **`find`**：在搜索结果上再按名称精确匹配 |
| `--wait` / `--no-wait` | 仅 **`find`**：是否轮询直到出现或超时 |
| `--timeout` | 仅 **`find`**：轮询总等待时间（毫秒，默认 30000） |
| `-bd` / `--biz-domain` | 业务域；默认来自 `kweaver config show` |

### `list` 与 `find`

| 子命令 | 作用 |
|--------|------|
| **`list`** | 列出资源，可按数据源 / 类型 / 条数筛选；默认 limit=30 |
| **`find`** | 按名称查找：默认模糊；`--exact` 精确；`--wait` 轮询等待就绪 |

## 端到端示例

```bash
# 列出某数据源下的资源
kweaver resource list --datasource-id <ds-uuid> --pretty

# 按名称模糊搜索
kweaver resource find --name BOM --pretty

# 精确名称 + 数据源 + 不等待
kweaver resource find --name 产品信息 --exact --datasource-id <ds-uuid> --no-wait --pretty

# 精确名称 + 轮询等待
kweaver resource find --name orders --exact --datasource-id <ds-uuid> --wait --pretty

# 获取资源详情（含 schema_definition）
kweaver resource get <resource-id> --pretty

# 分页查询数据
kweaver resource query <resource-id> --limit 20 --offset 0 --need-total --pretty
```

## 与 BKN 的关系

资源通过 Object Type 的 `data_source` 段绑定到知识网络，类型固定为 `resource`：

```json
{ "type": "resource", "id": "<resource-id>" }
```

`kweaver bkn object-type create` 的 `--resource-id` 参数即为此处的资源 ID。
