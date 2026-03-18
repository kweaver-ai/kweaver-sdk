# CLI JSON 格式说明

kweaver CLI 中需要传入 JSON 的参数格式、字段语义、Shell 引号规则与常见错误。

---

## Shell 引号规则

- **用单引号包裹整个 JSON**，避免 shell 解析 `$`、`"`、空格等
- 内部键值必须用**双引号**，不能用单引号
- 跨行时可用 heredoc 或 `\` 续行，但推荐单行

```bash
# 正确
--condition '{"field":"name","operation":"eq","value":"test"}'

# 错误：双引号会被 shell 吃掉
--condition "{"field":"name","operation":"eq","value":"test"}"   # 错误

# 错误：JSON 内部用单引号
--condition '{"field":'name',"operation":"eq"}'   # 错误
```

---

## Condition（过滤条件）

用于 `bkn object-type query`、`bkn subgraph`、`call -d`、`context-loader` 等。

### 单条件

```json
{
  "field": "name",
  "operation": "eq",
  "value": "高血压"
}
```

| 字段 | 必填 | 说明 |
|------|------|------|
| `field` | 是 | 属性名（对象类的 data_property 或 logic_property） |
| `operation` | 是 | 操作符，见下表 |
| `value` | 否 | 比较值。`exist`/`not_exist` 不需要 |

### 操作符

| 操作符 | 说明 | value 类型 |
|--------|------|------------|
| `eq` | 等于 | string/number/boolean |
| `neq` | 不等于 | 同上 |
| `gt` | 大于 | number |
| `gte` | 大于等于 | number |
| `lt` | 小于 | number |
| `lte` | 小于等于 | number |
| `in` | 在列表中 | array |
| `not_in` | 不在列表中 | array |
| `like` | 模糊匹配（SQL LIKE） | string |
| `not_like` | 不匹配 | string |
| `exist` | 存在 | 无 |
| `not_exist` | 不存在 | 无 |
| `match` | 全文匹配 | string |

### 组合条件

```json
{
  "operation": "and",
  "sub_conditions": [
    {"field": "name", "operation": "like", "value": "高血压"},
    {"field": "severity", "operation": "eq", "value": "重度"}
  ]
}
```

| 字段 | 必填 | 说明 |
|------|------|------|
| `operation` | 是 | `and` 或 `or` |
| `sub_conditions` | 是 | 子条件数组，可嵌套组合 |

### 空条件（查全部）

```json
{"operation": "and", "sub_conditions": []}
```

### 易错点

- `field` 必须是对象类中存在的属性名，拼写错误会返回空或报错
- `value` 类型要与 `operation` 匹配：`in`/`not_in` 用数组，`eq` 用标量
- `sub_conditions` 必须是数组，不能是对象

---

## Object-type query（对象实例查询）

用于 `kweaver bkn object-type query <kn-id> <ot-id> '<json>'`。第三参数为 JSON 字符串，或省略时用 `--limit` 指定。

### 最小结构

```json
{
  "limit": 10,
  "condition": {"operation": "and", "sub_conditions": []}
}
```

### 完整结构

```json
{
  "limit": 50,
  "condition": {
    "operation": "and",
    "sub_conditions": [
      {"field": "status", "operation": "eq", "value": "active"},
      {"field": "name", "operation": "like", "value": "高血压"}
    ]
  },
  "search_after": ["cursor-value-1", "cursor-value-2"]
}
```

| 字段 | 必填 | 说明 |
|------|------|------|
| `limit` | 是 | 返回条数，≥1。可用 `--limit N` 覆盖 |
| `condition` | 是 | 过滤条件，见 [Condition](#condition)。查全部用 `{"operation":"and","sub_conditions":[]}` |
| `search_after` | 否 | 游标分页，JSON 数组。可用 `--search-after '<json-array>'` 传入 |

### 易错点

- `limit` 必填，否则 CLI 报 `Missing limit`
- `--search-after` 必须是 JSON 数组字符串，传对象会报错
- `condition` 的 `field` 必须是对象类中存在的属性名

---

## Subgraph（子图查询）

用于 `kweaver bkn subgraph <kn-id> '<json>'`。

### 最小结构

```json
{"relation_type_paths": []}
```

### 完整结构

```json
{
  "relation_type_paths": [
    {
      "object_types": [
        {"id": "<ot-id>", "condition": {"operation": "and", "sub_conditions": []}, "limit": 100}
      ],
      "relation_types": [
        {
          "relation_type_id": "<rt-id>",
          "source_object_type_id": "<ot-id>",
          "target_object_type_id": "<ot-id>"
        }
      ]
    }
  ]
}
```

| 字段 | 必填 | 说明 |
|------|------|------|
| `relation_type_paths` | 是 | 路径数组。每项包含 `object_types` 和 `relation_types` |
| `object_types` | 是 | 对象类节点数组，每项含 `id`、`condition`、可选 `limit` |
| `relation_types` | 是 | 关系类边数组，每项含 `relation_type_id`、`source_object_type_id`、`target_object_type_id` |

### 易错点

- `relation_type_paths` 必须是数组，不能是对象
- `id`、`relation_type_id` 等需从 `bkn object-type list`、`bkn relation-type list` 获取
- `condition` 格式同 [Condition](#condition)

---

## Relations（KN 表关系，平台 API / body-file）

TS CLI `bkn create` 不直接支持 `--relations`。以下格式用于平台 API 或 `--body-file` 导入场景。

### 单条关系

```json
{
  "name": "产品_库存",
  "from_table": "products",
  "to_table": "inventory",
  "from_field": "material_number",
  "to_field": "material_code"
}
```

| 字段 | 必填 | 说明 |
|------|------|------|
| `name` | 是 | 关系名称（中文或英文） |
| `from_table` | 是 | 源表名，必须在 `--tables` 中 |
| `to_table` | 是 | 目标表名，必须在 `--tables` 中 |
| `from_field` | 是 | 源表关联字段 |
| `to_field` | 是 | 目标表关联字段 |

### 多条关系

```json
[
  {"name":"产品_库存","from_table":"products","to_table":"inventory","from_field":"material_number","to_field":"material_code"},
  {"name":"库存_供应商","from_table":"inventory","to_table":"suppliers","from_field":"supplier_id","to_field":"id"}
]
```

### Shell 传参（平台支持时）

若通过 `kweaver call` 或平台 API 创建带数据源的 KN，relations 作为请求体字段传入。TS CLI `bkn create` 使用 `--name`、`--body-file` 等元数据参数。

### 易错点

- `from_table`/`to_table` 必须与 `--tables` 中的表名完全一致
- 字段名必须与数据库表结构一致
- 不要漏掉任意一个必填字段

---

## Action-type（Action 查询与执行）

用于 `kweaver bkn action-type query <kn-id> <at-id> '<json>'` 和 `kweaver bkn action-type execute <kn-id> <at-id> '<json>'`。

### 最小结构

```json
{"_instance_identities": [{}]}
```

### 完整结构

```json
{
  "_instance_identities": [
    {"warehouse": "华东", "region": "上海"},
    {"pod_ip": "1.2.3.4", "port": 8080}
  ]
}
```

| 字段 | 必填 | 说明 |
|------|------|------|
| `_instance_identities` | 是 | 实例身份数组。每项为键值对，键由 Action 定义决定（如 `warehouse`、`pod_ip`） |

### 易错点

- 键名必须与 Action 定义一致，执行前用 `action-type query` 查看
- 类型要匹配：字符串用 `"..."`，数字用裸数字，布尔用 `true`/`false`
- 无参数时传 `'{"_instance_identities":[{}]}'`

---

## Call 请求体（POST/PUT）

用于 `kweaver call <url> -d '<json>'`。`<url>` 为完整 URL。

### 对象实例查询（ontology-query API）

```json
{
  "limit": 10,
  "condition": {"operation": "and", "sub_conditions": []}
}
```

### 子图查询（ontology-query API）

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

具体格式以目标 API 文档为准。

### 易错点

- `-d` 必须是合法 JSON，否则服务端返回 400
- `kweaver call` 第一个参数为完整 URL，非相对路径

---

## Context Loader 查询体

用于 `kweaver context-loader query-object-instance`、`query-instance-subgraph`、`get-logic-properties`、`get-action-info`。

### query-object-instance

```json
{
  "ot_id": "disease",
  "condition": {"operation": "and", "sub_conditions": []},
  "limit": 10
}
```

| 字段 | 必填 | 说明 |
|------|------|------|
| `ot_id` | 是 | 对象类 ID（非 object_type_id） |
| `condition` | 是 | 过滤条件，见 [Condition](#condition) |
| `limit` | 否 | 返回条数，默认 20 |

### query-instance-subgraph

```json
{
  "relation_type_paths": [
    {
      "object_types": [{"id": "<ot-id>", "condition": {"operation": "and", "sub_conditions": []}, "limit": 100}],
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
  "ot_id": "<ot-id>",
  "query": "用户查询",
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
| `_instance_identity` | 是 | 实例身份对象（单例，非数组） |

### 易错点

- `ot_id` 不是 `object_type_id`；`_instance_identity` 与 `_instance_identities` 区分单复数

---

## 常见报错

| 报错 | 可能原因 |
|------|----------|
| `400 Bad Request` | JSON 格式错误、字段名错误、类型不匹配 |
| `404 Not Found` | `kn-id`、`ot-id`、`at-id` 不存在 |
| `403 Forbidden` | 无权限 |
| 空结果 | `condition` 过严、`field` 拼写错误 |
| Shell 解析错误 | 引号使用不当，改用单引号包裹 JSON |
