# Agent 对话

与 Decision Agent 进行非交互式多轮对话。TS CLI 通过 `agent` 命令组实现。

## 命令总览

| 命令 | 说明 |
|------|------|
| `kweaver agent list [options]` | 列出已发布 Agent |
| `kweaver agent chat <agent-id> -m "<message>"` | 发送单轮消息 |
| `kweaver agent sessions <agent-id>` | 列出与某个 Agent 的历史会话 |
| `kweaver agent history <conversation-id>` | 查看某次会话的完整消息记录 |

## 何时使用

- 用户说"有哪些 Agent"：`agent list`
- 用户说"跟 Agent 对话"：`agent chat`
- 用户说"看看历史会话"：`agent sessions` / `agent history`

## 参数说明

### agent list

| 参数 | 说明 |
|------|------|
| `--name` | 按名称过滤 |
| `--offset N` | 偏移，默认 0 |
| `--limit N` | 条数，默认 50 |
| `--category-id` | 按分类过滤 |
| `--custom-space-id` | 自定义空间 |
| `--is-to-square` | 是否 to-square |
| `--verbose, -v` | 完整 JSON |
| `-bd` | 业务域 |

### agent chat

| 参数 | 说明 |
|------|------|
| `-m, --message` | 消息内容（必填） |
| `--conversation-id, -cid` | 续聊时传入会话 ID |
| `--version` | 版本，默认 v0 |
| `--stream` / `--no-stream` | 流式输出 |
| `--verbose` | 打印请求详情 |
| `-bd` | 业务域 |

### agent sessions / history

| 参数 | 说明 |
|------|------|
| `--limit N` | 返回条数 |
| `-bd` | 业务域 |
| `--pretty` | 格式化 JSON |

## 用法示例

```bash
# 列出
kweaver agent list
kweaver agent list --name "供应链" --limit 20

# 首轮对话
kweaver agent chat <agent-id> -m "华东仓库库存情况如何？"

# 续聊（从首轮返回中记录 conversation_id）
kweaver agent chat <agent-id> -m "和上个月相比呢？" --conversation-id <conversation-id>

# 历史
kweaver agent sessions <agent-id>
kweaver agent sessions <agent-id> --limit 10
kweaver agent history <conversation-id> --limit 50
```

## 关键约束

- `agent chat` 必须用 `-m` 指定消息，非交互模式
- 首轮不传 `--conversation-id`；续聊必须传
- 不要向用户暴露 `conversation_id` 等内部 ID，除非用户明确要求

## 默认策略

1. `kweaver agent list` 查看可用 Agent
2. 首轮：`kweaver agent chat <agent-id> -m "..."` （不传 conversation-id）
3. 从返回中记录 `conversation_id`，默认不向用户展示
4. 续聊：`kweaver agent chat <agent-id> -m "..." --conversation-id <id>`
5. 历史：`agent sessions <agent-id>` -> `agent history <conversation-id>`

## 端到端：Agent 多轮对话

```
agent list -> agent chat (首轮) -> agent chat --conversation-id (续聊)
agent sessions -> agent history
```

1. **发现 Agent**：`kweaver agent list` 或 `kweaver agent list --name "供应链"` → 获取 `agent-id`
2. **首轮对话**：`kweaver agent chat <agent-id> -m "华东仓库库存情况如何？"` → 返回 `answer`、`conversation_id`、`references`，记录 `conversation_id` 供续聊
3. **续聊**：`kweaver agent chat <agent-id> -m "和上个月相比呢？" --conversation-id <conversation-id>`
4. **查看历史**：`kweaver agent sessions <agent-id>` → `kweaver agent history <conversation-id> --limit 50`
