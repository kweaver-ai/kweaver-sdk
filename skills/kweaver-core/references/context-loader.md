# Context Loader 命令参考

MCP JSON-RPC 协议的分层检索。需要先配置 KN 上下文。

## 配置

```bash
kweaver context-loader config set --kn-id kn-123 [--name myconfig]
kweaver context-loader config use myconfig
kweaver context-loader config list
kweaver context-loader config show
kweaver context-loader config remove myconfig
```

## MCP 内省

```bash
kweaver context-loader tools           # 可用工具列表
kweaver context-loader resources       # 可用资源列表
kweaver context-loader resource <uri>  # 读取资源
kweaver context-loader templates       # 资源模板
kweaver context-loader prompts         # 可用 prompt
kweaver context-loader prompt <name> [--args '<json>']
```

## Layer 1 — Schema 搜索

```bash
kweaver context-loader kn-search "Pod" [--only-schema]
kweaver context-loader kn-schema-search "Pod" [--max 10]
```

## Layer 2 — 实例查询

```bash
# 条件查询
kweaver context-loader query-object-instance '{"ot_id": "ot-1", "condition": {"operation": "and", "sub_conditions": [{"field": "name", "operation": "==", "value_from": "const", "value": "web-pod"}]}, "limit": 5}'

# 子图查询
kweaver context-loader query-instance-subgraph '{"relation_type_paths": [{"start_ot_id": "ot-1", "paths": [{"rt_id": "rt-1", "direction": "positive"}]}]}'
```

## Layer 3 — 逻辑属性 & Action

```bash
# 获取逻辑属性
kweaver context-loader get-logic-properties '{"ot_id": "ot-1", "query": "status", "_instance_identities": [{"id": "123"}], "properties": ["status", "cpu"]}'

# 获取 Action 信息
kweaver context-loader get-action-info '{"at_id": "at-1", "_instance_identity": {"id": "123"}}'
```

## JSON 格式

### condition

```json
{
  "operation": "and",
  "sub_conditions": [
    {"field": "name", "operation": "==", "value_from": "const", "value": "Pod-1"},
    {"field": "status", "operation": "in", "value_from": "const", "value": ["Running", "Pending"]}
  ]
}
```

支持的 operation：`==`, `!=`, `>`, `<`, `>=`, `<=`, `in`, `not_in`, `like`, `not_like`，以及逻辑组合 `and` / `or`（配合 `sub_conditions`）。

> 完整的「属性类型 → 可用操作符」对照表、`exist`/`not_exist` 用法、SQL 视图与 OpenSearch 兼容性差异，见 [`bkn.md` 的 object-type query 条件过滤一节](bkn.md#object-type-query-条件过滤)。实际可用操作符以对象类 `data_properties` 中各属性的 `condition_operations` 字段为准。
>
> **常见错误**：
> - `match` / `contain` / `prefix` 等仅 OpenSearch 索引模式可用，SQL 视图数据源会返回 500；做文本模糊匹配优先 `like`。
> - `eq`、`gt`、`lt`、`gte`、`lte` 不是合法操作符，请用 `==`、`>`、`<`、`>=`、`<=`。
> - **string** 字段更常用 `like` / `in`；**keyword** 字段为不分词关键字，不要使用 `like`。
> - `like` / `not_like` 不支持通配符 `%` / `_`，`value` 直接写普通子串。
> - `exist` / `not_exist` 不需要 `value` 字段。
