# KWeaver SDK

让 AI 智能体（Claude Code、GPT、自定义 Agent 等）通过 Skill 访问 KWeaver / ADP 平台的知识网络与 Decision Agent。

## 这个项目解决什么问题

KWeaver (ADP) 平台提供了知识网络构建、语义搜索、Decision Agent 对话等能力，但这些能力藏在复杂的 REST API 背后。本 SDK 将它们封装为 **6 个 Skill**，每个 Skill 是一个 `run(**kwargs) -> dict` 的简单调用，智能体无需了解底层 API 细节即可完成操作。

## 前置条件

1. **Python >= 3.10**
2. **ADP 平台账号** — 需要 `base_url` 和 `token`（Bearer Token）
3. 安装 SDK：

```bash
pip install -e .
```

## 接入步骤

### 第 1 步：配置环境变量

在 `~/.env.secrets` 或你的环境中设置：

```bash
export ADP_BASE_URL="https://your-adp-instance.com"
export ADP_TOKEN="Bearer ory_at_xxxxx"
export ADP_BUSINESS_DOMAIN="bd_public"   # 可选，按需设置
```

### 第 2 步：初始化 Client

```python
import os
from kweaver import ADPClient

client = ADPClient(
    base_url=os.environ["ADP_BASE_URL"],
    token=os.environ["ADP_TOKEN"],
    business_domain=os.environ.get("ADP_BUSINESS_DOMAIN"),
)
```

### 第 3 步：使用 Skill

所有 Skill 遵循相同模式：`Skill(client).run(**kwargs) -> dict`。

出错时不抛异常，而是返回 `{"error": True, "message": "..."}`，智能体可以直接将 message 展示给用户。

---

## 6 个 Skill

### 1. discover_agents — 发现平台上的 Agent

> "有哪些 Agent？" / "供应链助手是做什么的？"

```python
from kweaver.skills import DiscoverAgentsSkill
skill = DiscoverAgentsSkill(client)

# 列出已发布的 Agent
result = skill.run(mode="list")
result = skill.run(mode="list", keyword="供应链")
# -> {"agents": [{"id": "...", "name": "供应链助手", "description": "...", "status": "published", ...}]}

# 查看某个 Agent 的详情
result = skill.run(mode="detail", agent_name="供应链助手")
# -> {"agent": {"name": "供应链助手", "knowledge_networks": [...], "capabilities": [...], ...}}
```

### 2. chat_agent — 与 Agent 对话

> "问一下供应链助手，华东仓库库存情况如何？"

```python
from kweaver.skills import ChatAgentSkill
skill = ChatAgentSkill(client)

# 首次提问（自动创建会话）
result = skill.run(mode="ask", agent_name="供应链助手", question="华东仓库库存情况如何？")
# -> {
#     "answer": "华东仓库当前库存充足...",
#     "conversation_id": "conv_xxx",
#     "references": [{"source": "库存表", "content": "1200件", "score": 0.95}]
# }

# 多轮对话 — 传入上一轮返回的 conversation_id
result = skill.run(
    mode="ask", agent_name="供应链助手",
    question="和上个月相比呢？",
    conversation_id=result["conversation_id"],
)
```

也支持 `agent_id=` 直接传 ID，以及 `stream=True` 流式。

### 3. load_kn_context — 浏览知识网络结构与数据

> "有哪些知识网络？" / "erp_prod 里有什么表？" / "看看 products 的数据"

```python
from kweaver.skills import LoadKnContextSkill
skill = LoadKnContextSkill(client)

# 列出所有知识网络
result = skill.run(mode="overview")
# -> {"knowledge_networks": [{"id": "kn_01", "name": "erp_prod", "object_type_count": 5, ...}]}

# 查看 schema（对象类型 + 关系类型 + 属性）
result = skill.run(mode="schema", kn_name="erp_prod")
result = skill.run(mode="schema", kn_name="erp_prod", include_samples=True, sample_size=3)
# -> {"kn_name": "erp_prod", "object_types": [...], "relation_types": [...]}

# 浏览某个对象类型的实例数据
result = skill.run(mode="instances", kn_name="erp_prod", object_type="products", limit=10)
# -> {"data": [{...}], "total_count": 1200, "has_more": true, "object_type_schema": {...}}
```

### 4. query_kn — 查询知识网络

> "查一下高库存的产品" / "status=active 的订单有哪些？"

```python
from kweaver.skills import QueryKnSkill
skill = QueryKnSkill(client)

# 语义搜索 — 不确定查什么时用
result = skill.run(kn_id="<id>", mode="search", query="高库存的产品")

# 精确查询 — 按条件过滤某类对象
result = skill.run(
    kn_id="<id>", mode="instances", object_type="products",
    conditions={"field": "status", "operation": "eq", "value": "active"},
    limit=20,
)

# 子图查询 — 沿关系路径关联查询
result = skill.run(
    kn_id="<id>", mode="subgraph",
    start_object="products",
    start_condition={"field": "category", "operation": "eq", "value": "电子"},
    path=["inventory", "suppliers"],
)
```

### 5. connect_db — 连接数据库

> "帮我把这个 MySQL 接进来"

```python
from kweaver.skills import ConnectDbSkill
skill = ConnectDbSkill(client)

result = skill.run(
    db_type="mysql",       # mysql | postgresql | oracle | sqlserver | clickhouse | ...
    host="10.0.1.100",
    port=3306,
    database="erp_prod",
    account="readonly",
    password="xxx",
)
# -> {"datasource_id": "ds_01", "tables": [{"name": "orders", "columns": [...]}, ...]}
```

### 6. build_kn — 构建知识网络

> "把这几张表建成知识网络"

```python
from kweaver.skills import BuildKnSkill
skill = BuildKnSkill(client)

result = skill.run(
    datasource_id="<connect_db 返回的 datasource_id>",
    network_name="供应链",
    tables=["orders", "products", "suppliers"],     # 可选，不传则全部纳入
    relations=[{                                     # 可选，定义表间关系
        "name": "订单包含产品",
        "from_table": "orders", "from_field": "product_id",
        "to_table": "products", "to_field": "id",
    }],
)
# -> {"kn_id": "kn_abc", "kn_name": "供应链", "object_types": [...], "status": "completed"}
```

构建可能需要数十秒到数分钟，Skill 内部会自动等待完成。

---

## 典型流程

| 场景 | Skill 调用顺序 |
|---|---|
| 探索已有知识网络 | `load_kn_context(overview)` → `load_kn_context(schema)` → `query_kn` |
| 与 Agent 对话 | `discover_agents(list)` → `chat_agent(ask)` → `chat_agent(ask, conversation_id=...)` |
| 从零构建知识网络 | `connect_db` → `build_kn` → `load_kn_context(schema)` → `query_kn` |

## 在 Claude Code 中使用

本项目已内置 Claude Code Skill（`.claude/skills/kweaver/SKILL.md`）。当项目目录加入 Claude Code 工作区后，用户说"有哪些知识网络"、"跟 Agent 聊一下"等意图时，Claude Code 会自动调用对应的 Skill。

无需额外配置，只需确保环境变量 `ADP_BASE_URL` 和 `ADP_TOKEN` 已设置。

## 开发与测试

```bash
# 单元测试 + 集成测试
pytest

# E2E 测试（需要 ADP 环境）
pytest tests/e2e/ --run-destructive
```

E2E 测试支持自动登录刷新 Token — 在 `~/.env.secrets` 中配置 `ADP_USERNAME` 和 `ADP_PASSWORD` 即可，无需手动更新 Token。
