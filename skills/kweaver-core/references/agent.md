# Agent 对话

与 Decision Agent 进行非交互式多轮对话。

## CLI 命令表

| 命令 | 说明 |
|------|------|
| `kweaver agent list [--keyword <text>]` | 列出已发布 Agent |
| `kweaver agent chat <agent-id> -m "<message>" [--conversation-id <id>]` | 发送单轮消息 |

## 默认策略

1. 先用 `kweaver agent list` 查看可用 Agent
2. 首轮：`kweaver agent chat <agent-id> -m "..."` （不传 conversation-id）
3. 从返回中记录 `conversation_id`，默认不向用户展示
4. 续聊：`kweaver agent chat <agent-id> -m "..." --conversation-id <id>`

## SDK Skill 用法

### discover_agents — 发现 Agent

```python
from kweaver.skills import DiscoverAgentsSkill
skill = DiscoverAgentsSkill(client)

# 列出已发布的 Agent
result = skill.run(mode="list")
result = skill.run(mode="list", keyword="供应链")
# -> { agents: [{ id, name, description, status }] }

# 查看 Agent 详情
result = skill.run(mode="detail", agent_name="供应链助手")
```

### chat_agent — 与 Agent 对话

```python
from kweaver.skills import ChatAgentSkill
skill = ChatAgentSkill(client)

# 首次提问（自动创建会话）
result = skill.run(mode="ask", agent_name="供应链助手", question="华东仓库库存情况")
# -> { answer, conversation_id, references }

# 续接已有会话（多轮对话）
result = skill.run(
    mode="ask", agent_name="供应链助手",
    question="和上个月相比呢？",
    conversation_id="<上一轮返回的 conversation_id>",
)

# 流式输出（Skill 内部收集所有 chunk 后返回完整结果）
result = skill.run(mode="ask", agent_name="供应链助手", question="详细分析", stream=True)

# 列出与某个 Agent 的历史会话
result = skill.run(mode="sessions", agent_name="供应链助手")

# 查看某次会话的完整消息记录
result = skill.run(mode="history", conversation_id="<id>", limit=50)
```

## 关键约束

- CLI `agent chat` 始终用 `-m` 指定消息，不要进入交互模式
- 首轮不传 `--conversation-id`；续聊必须传
- `agent_name` 可以替代 `agent_id` 使用（SDK 自动按名称查找）
- 不要向用户暴露 `conversation_id` 等内部 ID，除非用户明确要求

## 典型编排

1. **发现 Agent**: discover_agents(list) → discover_agents(detail) → chat_agent(ask)
2. **多轮对话**: chat_agent(ask) → chat_agent(ask, conversation_id=...) 续接
3. **回顾历史**: chat_agent(sessions) → chat_agent(history, conversation_id=...)
