# 查询（语义搜索、实例、子图）

对知识网络进行语义搜索、对象实例查询和子图查询。TS CLI 通过 `bkn search`、`bkn object-type query`、`bkn subgraph` 实现。

## 命令总览

| 命令 | 说明 |
|------|------|
| `kweaver bkn search <kn-id> <query>` | 语义搜索（agent-retrieval API） |
| `kweaver bkn object-type query <kn-id> <ot-id> ['<json>']` | 对象实例查询 |
| `kweaver bkn subgraph <kn-id> '<json>'` | 子图查询 |
| `kweaver context-loader kn-search <query>` | KN Schema 搜索（需先 config set） |

## 何时使用

- 模糊业务问题：`bkn search`
- 精确按条件查对象：`bkn object-type query`
- 按关系路径展开：`bkn subgraph`
- 查 Schema 概念：`context-loader kn-search`

## 参数说明

### bkn search

| 参数 | 说明 |
|------|------|
| `--max-concepts N` | 最大返回概念数，默认 10 |
| `--mode <mode>` | 搜索模式，默认 `keyword_vector_retrieval` |
| `--pretty` | 格式化 JSON 输出 |
| `-bd, --biz-domain` | 业务域，默认 bd_public |

### bkn object-type query

| 参数 | 说明 |
|------|------|
| `['<json>']` | 请求体，必须包含 `limit` 和 `condition`，见 [JSON 格式](json-formats.md#object-type-query) |
| `--limit N` | 覆盖 body 中的 limit |
| `--search-after '<json-array>'` | 游标分页，JSON 数组 |
| `--pretty` | 格式化输出 |
| `-bd` | 业务域 |

### bkn subgraph

| 参数 | 说明 |
|------|------|
| `'<json>'` | 请求体，必须包含 `relation_type_paths`，见 [JSON 格式](json-formats.md#subgraph) |
| `--pretty` | 格式化输出 |
| `-bd` | 业务域 |

## 用法示例

```bash
# 语义搜索
kweaver bkn search <kn-id> "高库存的产品"
kweaver bkn search <kn-id> "高血压治疗方案" --max-concepts 20 --pretty

# 对象实例（limit 必填，condition 可空查全部）
kweaver bkn object-type query <kn-id> <ot-id> '{"limit":50,"condition":{"operation":"and","sub_conditions":[]}}'
kweaver bkn object-type query <kn-id> <ot-id> --limit 20
kweaver bkn object-type query <kn-id> <ot-id> '{"limit":50,"condition":{"field":"status","operation":"eq","value":"active"}}'

# 子图查询
kweaver bkn subgraph <kn-id> '{"relation_type_paths":[{"object_types":[{"id":"<ot-id>","condition":{"operation":"and","sub_conditions":[]}}],"relation_types":[{"relation_type_id":"<rt-id>","source_object_type_id":"<ot1>","target_object_type_id":"<ot2>"}]}]}'

# KN Schema 搜索（需先 config set --kn-id）
kweaver context-loader kn-search "products" --only-schema
```

## 默认策略

- 模糊业务问题：`bkn search`
- 精确查对象：`bkn object-type query`，条件复杂时参考 [Condition 格式](json-formats.md#condition)
- 子图：`bkn subgraph` 需构造 `relation_type_paths`，见 [json-formats.md#subgraph](json-formats.md#subgraph)

## 端到端：Schema 探索与查询

```
bkn list -> bkn get --export -> bkn search / bkn object-type query / bkn subgraph
```

1. **列出知识网络**：`kweaver bkn list` 或 `kweaver bkn list --name-pattern erp` → 获取 `kn-id`
2. **查看 Schema**：`kweaver bkn get <kn-id> --export` 或 `kweaver bkn export <kn-id>` → 了解对象类型、关系类型、属性，获取 `ot-id`、`rt-id`
3. **语义搜索**：`kweaver bkn search <kn-id> "高库存的产品"`
4. **对象实例**：`kweaver bkn object-type query <kn-id> <ot-id> '{"limit":50,"condition":{"operation":"and","sub_conditions":[]}}'`
5. **子图查询**：`kweaver bkn subgraph <kn-id> '<json>'`，JSON 格式见 [json-formats.md#subgraph](json-formats.md#subgraph)
6. **KN Schema 搜索**：`kweaver context-loader config set --kn-id <id>` 后 `kweaver context-loader kn-search "products" --only-schema`
