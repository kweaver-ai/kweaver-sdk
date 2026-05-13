# Context Loader 命令参考

MCP JSON-RPC 协议的分层检索。

## Help 优先工作流

排查参数或让 agent 自动选择命令时，先读 CLI help。以下 help 路径只打印本地文案，不触发登录、配置读取或网络请求：

```bash
kweaver context-loader --help
kweaver context-loader help <subcommand>
kweaver context-loader <subcommand> --help
kweaver context-loader <subcommand> -h
```

`context-loader --help` 采用 `USAGE` / `COMMANDS` / `FLAGS` / `LEARN MORE` 风格：顶层只列命令名和一句话描述，不展示 `<kn-id>`、JSON body 等具体参数。具体参数、JSON shape 和示例统一查看 `context-loader <subcommand> --help`。顶层命令按任务优先级分组展示：`SCHEMA DISCOVERY COMMANDS`、`INSTANCE QUERY COMMANDS`、`INSTANCE ENRICHMENT AND ACTION COMMANDS`、`ADVANCED MCP COMMANDS`、`DEPRECATED CONFIGURATION COMMANDS`。

推荐流程：

1. `search-schema`：发现 Schema 概念。
2. `query-*`：使用发现到的 Schema ID 查询实例。
3. `get-*` / `find-skills`：增强实例信息或检查动作。
4. `tool-call`：仅用于 raw MCP 调试或当前没有专用 CLI wrapper 的工具。

## KN 选择

运行时子命令接受 `<kn-id>` 作为**第一个位置参数**（与 `kweaver bkn …` 风格一致），MCP endpoint 自动从当前平台派生为 `<base-url>/api/agent-retrieval/v1/mcp`，无需任何持久化配置。也支持全局 `--kn-id <id>` / `-k <id>` flag。

```bash
kweaver context-loader tools <kn-id>
kweaver context-loader search-schema <kn-id> "Pod"
# 或者
kweaver context-loader tools --kn-id <kn-id>
```

## 配置（已废弃）

> **Deprecated**: `context-loader config` 子命令仍保留向后兼容，但每次调用打印 deprecation 警告，未来版本将移除。stateless 模式（`--token`）下整个 `config` 子命令组（`set` / `use` / `list` / `remove` / `show`）都直接被拒绝。
>
> 当运行时子命令省略 `<kn-id>` 且未提供 `--kn-id` flag时，会回退到此处保存的 `current` 条目（仅为兼容历史用法）。新代码请直接传 `<kn-id>`。

```bash
kweaver context-loader config set --kn-id kn-123 [--name myconfig]
kweaver context-loader config use myconfig
kweaver context-loader config list
kweaver context-loader config show
kweaver context-loader config remove myconfig
```

## Schema discovery — Schema 搜索

推荐使用 `search-schema`，它调用 MCP `search_schema`，支持 `object_types`、`relation_types`、`action_types`、`metric_types`。`--concept-groups` 会写入 `search_scope.concept_groups`，用于按 BKN 概念分组 ID 限定 Schema 发现范围；它只作用于概念层发现，不是实例数据过滤条件。

```bash
kweaver context-loader help search-schema
kweaver context-loader search-schema <kn-id> "Pod"
kweaver context-loader search-schema <kn-id> "利润率" --scope object,metric --concept-groups finance --max 10 --brief --no-rerank
kweaver context-loader search-schema <kn-id> "Pod" --format toon
```

参数映射：`--format` -> `response_format`，`--scope` -> `search_scope`，`--concept-groups a,b` -> `search_scope.concept_groups: ["a","b"]`，`--max` -> `max_concepts`，`--brief` -> `schema_brief: true`，`--no-rerank` -> `enable_rerank: false`。

**search-schema 参数与默认值**

| 项 | 必填 | 默认值 | 说明 |
|----|:----:|--------|------|
| `<query>` | 是 | 无 | 自然语言 Schema 搜索文本 |
| `<kn-id>` 或 `--kn-id <kn-id>` | 推荐必填 | 省略时回退 deprecated saved config（若存在） | 新用法建议显式传 KN ID |
| `--format json\|toon` | 否 | `json` | SDK/CLI 会默认发送 `response_format: "json"` |
| `--scope object,relation,action,metric` | 否 | 不发送，使用服务端默认 | 限定 Schema 类型搜索范围 |
| `--concept-groups <ids>` / `--concept-group <ids>` | 否 | 不发送，不限制 concept group | 写入 `search_scope.concept_groups` |
| `--max <n>` / `-n <n>` | 否 | 不发送，使用服务端默认 | 最大概念数 |
| `--brief` | 否 | 不发送 | 指定时发送 `schema_brief: true` |
| `--no-rerank` | 否 | 不发送，使用服务端默认 | 指定时发送 `enable_rerank: false` |
| `--pretty` | 否 | 启用 | CLI JSON 输出默认 pretty print |

Deprecated 兼容命令仍保留给老脚本，但**全部走 Context Loader 公共 HTTP endpoint**（`/api/agent-retrieval/v1/kn/kn_search` 与 `/semantic-search`），不再触碰已被移除的 MCP `kn_search` / `kn_schema_search`，也不承诺获得 `search_schema` 的新能力（例如 `concept_groups`）：

```bash
kweaver context-loader kn-search <kn-id> "Pod" [--only-schema]
kweaver context-loader kn-schema-search <kn-id> "Pod" [--max 10]
```

> SDK 层同样走 HTTP：TS `client.bkn.knSearch(...)`、Python `client.query.kn_search(...)` / `client.query.kn_schema_search(...)` 均已 deprecated。`ContextLoaderResource` 不再暴露 `kn_search` / `kn_schema_search` 方法；新接入的 Schema 发现请使用 `searchSchema` / `search_schema` / `callTool`。

## Instance query — 实例查询

```bash
# 条件查询
kweaver context-loader query-object-instance <kn-id> '{"ot_id": "ot-1", "condition": {"operation": "and", "sub_conditions": [{"field": "name", "operation": "==", "value_from": "const", "value": "web-pod"}]}, "limit": 5}'

# 子图查询
kweaver context-loader query-instance-subgraph <kn-id> '{"relation_type_paths": [{"start_ot_id": "ot-1", "paths": [{"rt_id": "rt-1", "direction": "positive"}]}]}'
```

## Instance enrichment and actions — 实例增强与动作

这组命令对应 Layer 3 风格的能力，用于围绕已选实例获取逻辑属性、动作信息或相关 Skill。

```bash
# 获取逻辑属性
kweaver context-loader get-logic-properties <kn-id> '{"ot_id": "ot-1", "query": "status", "_instance_identities": [{"id": "123"}], "properties": ["status", "cpu"]}'

# 获取 Action 信息
kweaver context-loader get-action-info <kn-id> '{"at_id": "at-1", "_instance_identity": {"id": "123"}}'
```

### find-skills — 召回对象类下的 Skill

按对象类（可选缩小到具体实例）召回挂载的 Skill。对应 MCP tool `find_skills`，0.7.0 起可用。

```bash
# 仅按对象类召回（top_k 默认 10）
kweaver context-loader find-skills <kn-id> ot_drug

# 加自然语言查询和 top_k
kweaver context-loader find-skills <kn-id> ot_drug --query "treatment" --top-k 5

# 缩小到具体实例 + 切到 toon 输出
kweaver context-loader find-skills <kn-id> ot_drug \
  --instance-identities '[{"drug_id": "DRUG_001"}]' \
  --format toon
```

**CLI 参数**

| 参数 | 必填 | 说明 |
|------|:----:|------|
| `<object_type_id>` | ✅ | 位置参数，对象类 id |
| `--query / -q <text>` | | 自然语言查询，缩小召回范围 |
| `--top-k / -n <N>` | | 1..20，默认 10 |
| `--instance-identities / -i '<json-array>'` | | 实例身份数组（来自 Layer 2 `_instance_identity`） |
| `--format / -f json\|toon` | | 输出格式，默认 `json` |

**返回结构**

```json
{
  "entries": [
    { "skill_id": "sk_xxx", "name": "Skill 1", "description": "..." }
  ],
  "message": "..."
}
```

**SDK 等价**

```ts
// TypeScript
const result = await client.contextLoader.findSkills({
  object_type_id: "ot_drug",
  skill_query: "treatment",
  top_k: 5,
  // instance_identities: [{ drug_id: "DRUG_001" }],
  // response_format: "json",
});
```

```python
# Python
result = client.context_loader.find_skills(
    "ot_drug",
    skill_query="treatment",
    top_k=5,
    # instance_identities=[{"drug_id": "DRUG_001"}],
    # response_format="json",
)
```

**校验规则（client side）**

- `object_type_id` 必填，空字符串直接抛错。
- `top_k`（若提供）必须在 `[1, 20]`，否则抛错；不传时由服务端按默认 10 处理。
- `instance_identities`（若提供）必须是数组，每个元素是普通对象（复用 `validateInstanceIdentities`）。
- `response_format` 仅接受 `"json"` / `"toon"`。

## Advanced MCP interface — MCP 调试与直通

这组命令是对 context-loader MCP 协议层接口的直接封装，主要用于调试、探索服务端能力，以及在没有专用 CLI wrapper 时作为 escape hatch。日常任务优先使用上面的 `search-schema`、实例查询和实例增强与动作命令。

下面所有示例中的 `<kn-id>` 也可以省略以回退到 deprecated 的 saved config（见上节）。

```bash
kweaver context-loader tools <kn-id>                       # 可用工具列表
kweaver context-loader resources <kn-id>                   # 可用资源列表
kweaver context-loader resource <kn-id> <uri>              # 读取资源
kweaver context-loader templates <kn-id>                   # 资源模板
kweaver context-loader prompts <kn-id>                     # 可用 prompt
kweaver context-loader prompt <kn-id> <name> [--args '<json>']
kweaver context-loader tool-call <kn-id> <name> --args '<json>'  # 直接调用任意 MCP tool
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
