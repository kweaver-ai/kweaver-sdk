# Agent 对话

与 Decision Agent 进行非交互式多轮对话。

## CLI 命令总览

| 命令 | 说明 |
|------|------|
| `kweaver agent list [--keyword <text>] [--offset N] [--limit N]` | 列出已发布 Agent |
| `kweaver agent get <agent-id> [--verbose]` | 查看 Agent 详情（名称、描述、状态、绑定 KN） |
| `kweaver agent chat <agent-id> -m "<message>" [--conversation-id <id>]` | 发送单轮消息 |
| `kweaver agent sessions <agent-id>` | 列出与某个 Agent 的历史会话 |
| `kweaver agent history <conversation-id> [--limit N]` | 查看某次会话的完整消息记录 |

## CLI 用法详解

### 发现 Agent

```bash
# 列出已发布的 Agent（与 bkn list 一致：--offset 默认 0，--limit 默认 50）
kweaver agent list

# 按关键词筛选
kweaver agent list --keyword "供应链"

# 分页
kweaver agent list --offset 0 --limit 20
```

### 查看 Agent 详情

```bash
# 查看 Agent 基本信息
kweaver agent get <agent-id>

# 查看完整信息（含 system_prompt、capabilities、model 配置）
kweaver agent get <agent-id> --verbose
```

### 首轮对话

```bash
kweaver agent chat <agent-id> -m "华东仓库库存情况如何？"
# -> 返回 answer, conversation_id, references
```

### 续聊（带 conversation-id）

```bash
# 从首轮返回中记录 conversation_id，续聊时传入
kweaver agent chat <agent-id> -m "和上个月相比呢？" --conversation-id <conversation-id>
```

### 查看历史会话

```bash
# 列出与某个 Agent 的历史会话
kweaver agent sessions <agent-id>

# 查看某次会话的完整消息记录
kweaver agent history <conversation-id> --limit 50
```

## 关键约束

- CLI `agent chat` 始终用 `-m` 指定消息，不要进入交互模式
- 首轮不传 `--conversation-id`；续聊必须传
- 不要向用户暴露 `conversation_id` 等内部 ID，除非用户明确要求

## 默认策略

1. 先用 `kweaver agent list` 查看可用 Agent
2. 用 `kweaver agent get <id>` 查看 Agent 详情和绑定的知识网络
3. 首轮：`kweaver agent chat <agent-id> -m "..."` （不传 conversation-id）
4. 从返回中记录 `conversation_id`，默认不向用户展示
5. 续聊：`kweaver agent chat <agent-id> -m "..." --conversation-id <id>`

## 典型编排

1. **发现 Agent**: `agent list` -> `agent get <id>` -> `agent chat <id> -m "..."`
2. **多轮对话**: `agent chat` (首轮) -> `agent chat --conversation-id` (续聊)
3. **回顾历史**: `agent sessions <id>` -> `agent history <conversation-id>`
