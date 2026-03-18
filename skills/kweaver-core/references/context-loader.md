# Context Loader 分层检索

通过 MCP 协议对知识网络进行分层检索：Schema 搜索、实例查询、子图查询、逻辑属性与 Action 信息。

## 命令总览

### 配置

| 命令 | 说明 |
|------|------|
| `kweaver context-loader config set --kn-id <id> [--name <name>]` | 添加/更新 KN 配置 |
| `kweaver context-loader config use <name>` | 切换当前配置 |
| `kweaver context-loader config list` | 列出所有配置 |
| `kweaver context-loader config show` | 显示当前配置（knId + mcpUrl） |
| `kweaver context-loader config remove <name>` | 删除配置 |

### MCP 内省

| 命令 | 说明 |
|------|------|
| `kweaver context-loader tools` | 列出可用工具 |
| `kweaver context-loader resources` | 列出资源 |
| `kweaver context-loader resource <uri>` | 读取资源 |
| `kweaver context-loader templates` | 列出资源模板 |
| `kweaver context-loader prompts` | 列出 prompts |
| `kweaver context-loader prompt <name> [--args json]` | 获取 prompt |

### 检索（Layer 1–3）

| 命令 | 说明 |
|------|------|
| `kweaver context-loader kn-search <query> [--only-schema]` | Layer 1：语义搜索 Schema |
| `kweaver context-loader kn-schema-search <query> [--max N]` | Layer 1：发现候选概念 |
| `kweaver context-loader query-object-instance '<json>'` | Layer 2：查询对象实例 |
| `kweaver context-loader query-instance-subgraph '<json>'` | Layer 2：查询实例子图 |
| `kweaver context-loader get-logic-properties '<json>'` | Layer 3：获取逻辑属性值 |
| `kweaver context-loader get-action-info '<json>'` | Layer 3：获取 Action 信息 |

## 何时使用

- 需要从知识网络做语义检索、实例查询时，先 `config set --kn-id <id>`
- 与 MCP 客户端、Agent 集成时使用 context-loader 的 JSON-RPC 接口

## JSON 入参格式

完整结构见 [json-formats.md#context-loader](json-formats.md#context-loader)。

### query-object-instance

```json
{
  "ot_id": "<object-type-id>",
  "condition": {"operation": "and", "sub_conditions": []},
  "limit": 10
}
```

| 字段 | 必填 | 说明 |
|------|------|------|
| `ot_id` | 是 | 对象类 ID |
| `condition` | 是 | 过滤条件，见 [Condition](json-formats.md#condition) |
| `limit` | 否 | 返回条数，默认 20 |

### query-instance-subgraph

```json
{
  "relation_type_paths": [
    {
      "object_types": [{"id": "<ot-id>", "condition": {"operation": "and", "sub_conditions": []}}],
      "relation_types": [{"relation_type_id": "<rt-id>", "source_object_type_id": "<ot1>", "target_object_type_id": "<ot2>"}]
    }
  ]
}
```

| 字段 | 必填 | 说明 |
|------|------|------|
| `relation_type_paths` | 是 | 路径数组，每项含 `object_types`、`relation_types` |

### get-logic-properties

```json
{
  "ot_id": "<object-type-id>",
  "query": "用户查询文本",
  "_instance_identities": [{"<key>": "<value>"}],
  "properties": ["prop1", "prop2"],
  "additional_context": "可选"
}
```

| 字段 | 必填 | 说明 |
|------|------|------|
| `ot_id` | 是 | 对象类 ID |
| `query` | 是 | 查询文本 |
| `_instance_identities` | 是 | 实例身份数组 |
| `properties` | 是 | 属性名数组 |
| `additional_context` | 否 | 额外上下文 |

### get-action-info

```json
{
  "at_id": "<action-type-id>",
  "_instance_identity": {"<key>": "<value>"}
}
```

| 字段 | 必填 | 说明 |
|------|------|------|
| `at_id` | 是 | Action 类型 ID |
| `_instance_identity` | 是 | 实例身份对象 |

## 用法示例

```bash
# 配置
kweaver context-loader config set --kn-id d5iv6c9818p72mpje8pg
kweaver context-loader config set --kn-id xyz123 --name project-a
kweaver context-loader config use project-a

# Layer 1
kweaver context-loader kn-search "高血压 治疗 药品" --only-schema --pretty
kweaver context-loader kn-schema-search "products" --max 10

# Layer 2
kweaver context-loader query-object-instance '{"ot_id":"disease","condition":{"operation":"and","sub_conditions":[]},"limit":10}'
kweaver context-loader query-instance-subgraph '{"relation_type_paths":[{"object_types":[{"id":"ot1","condition":{"operation":"and","sub_conditions":[]}}],"relation_types":[]}]}'

# Layer 3
kweaver context-loader get-logic-properties '{"ot_id":"ot1","query":"...","_instance_identities":[{}],"properties":["p1"]}'
kweaver context-loader get-action-info '{"at_id":"at1","_instance_identity":{}}'
```

## 默认策略

- 使用前必须先 `config set --kn-id <id>`
- 多 KN 场景用 `config set --name` 命名，用 `config use` 切换
