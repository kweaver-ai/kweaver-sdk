# Action 执行

查询和执行知识网络中的 Action Type（有副作用）。TS CLI 通过 `bkn action-type`、`bkn action-execution`、`bkn action-log` 实现。

## 命令总览

| 命令 | 说明 |
|------|------|
| `kweaver bkn action-type list <kn-id>` | 列出 Action 类型 |
| `kweaver bkn action-type query <kn-id> <at-id> '<json>'` | 查询 Action 定义和参数 |
| `kweaver bkn action-type execute <kn-id> <at-id> '<json>'` | 执行 Action |
| `kweaver bkn action-execution get <kn-id> <execution-id>` | 获取执行状态 |
| `kweaver bkn action-log list <kn-id>` | 列出执行日志 |
| `kweaver bkn action-log get <kn-id> <log-id>` | 查看单条日志 |
| `kweaver bkn action-log cancel <kn-id> <log-id>` | 取消正在运行的执行 |

## 何时使用

- 查看 Action 定义：`action-type query`
- 执行 Action：`action-type execute`（有副作用，需用户明确请求）
- 查看执行记录：`action-log list` / `action-log get`
- 取消执行：`action-log cancel`

## 参数说明

### action-type query / execute

| 参数 | 说明 |
|------|------|
| `'<json>'` | 请求体。query 与 execute 均需传入，格式见 [json-formats.md#action-type](json-formats.md#action-type) |
| `--wait` | 默认，轮询直到执行完成 |
| `--no-wait` | 立即返回，不等待 |
| `--timeout N` | 轮询超时秒数，默认 300 |
| `--pretty` | 格式化输出 |
| `-bd` | 业务域 |

### action-log list

| 参数 | 说明 |
|------|------|
| `--limit N` | 返回条数 |
| `--need-total` | 是否返回总数 |
| `--action-type-id` | 按 Action 类型筛选 |
| `--status` | 按状态筛选 |
| `--trigger-type` | 按触发类型筛选 |
| `--search-after` | 游标分页 |

## JSON 请求体（action-type query / execute）

执行前用 `action-type query` 查看 Action 所需的实例身份字段。完整格式见 [json-formats.md#action-type](json-formats.md#action-type)。

### 最小结构

```json
{"_instance_identities": [{}]}
```

### 典型结构

```json
{
  "_instance_identities": [
    {"pod_ip": "1.2.3.4"},
    {"warehouse": "华东", "region": "上海"}
  ]
}
```

| 字段 | 必填 | 说明 |
|------|------|------|
| `_instance_identities` | 是 | 实例身份数组。每项为键值对，键由 Action 定义决定 |

## 用法示例

```bash
# 查询 Action 定义
kweaver bkn action-type query <kn-id> <at-id> '{"_instance_identities":[{}]}'

# 执行 Action（等待完成）
kweaver bkn action-type execute <kn-id> <at-id> '{"_instance_identities":[{"warehouse":"华东"}]}'

# 异步执行
kweaver bkn action-type execute <kn-id> <at-id> '{"_instance_identities":[{}]}' --no-wait

# 自定义超时
kweaver bkn action-type execute <kn-id> <at-id> '{"_instance_identities":[{}]}' --timeout 600

# 查看日志
kweaver bkn action-log list <kn-id>
kweaver bkn action-log list <kn-id> --limit 50 --action-type-id <at-id>
kweaver bkn action-log get <kn-id> <log-id>

# 取消执行
kweaver bkn action-log cancel <kn-id> <log-id>
```

## 关键约束

- Action 有**副作用**，仅在用户**明确请求**时执行
- 执行前向用户确认 Action 名称和参数
- 默认 `--wait` 轮询完成，最多 300 秒；`--no-wait` 立即返回
- 取消执行用 `action-log cancel`

## 端到端：执行 Action

```
action-type query -> action-type execute -> action-log list / action-log get
```

1. **查询 Action 定义**：`kweaver bkn action-type query <kn-id> <at-id> '{"_instance_identities":[{}]}'` → 查看参数、实例身份字段
2. **执行**：`kweaver bkn action-type execute <kn-id> <at-id> '<json>'` → 返回 `execution_id`、`status`、`result`
3. **查看日志**：`kweaver bkn action-log list <kn-id>` 或 `kweaver bkn action-log get <kn-id> <log-id>`
