---
name: kweaver
description: >-
  操作 ADP 知识网络与 Decision Agent — 连接数据库、构建知识网络、查询 Schema/实例、
  语义搜索、执行 Action、列举 Agent、与 Agent 对话。
  当用户提到"知识网络"、"知识图谱"、"连接数据库并建模"、"查询对象类"、
  "执行 Action"、"有哪些 Agent"、"跟 Agent 对话"等意图时自动使用。
allowed-tools: Bash(python *), Bash(${KWEAVER_PYTHON:-python} *), Bash(kweaver *)
argument-hint: [自然语言指令]
requires:
  env: [ADP_BASE_URL, ADP_BUSINESS_DOMAIN, ADP_TOKEN, ADP_USERNAME, ADP_PASSWORD]
  bins: [python]
---

# KWeaver — ADP 知识网络与 Decision Agent 技能

通过 kweaver SDK（Python API）或 kweaver CLI 操作 ADP 平台的知识网络和 Decision Agent。

## 两种调用方式

| 方式 | 适用场景 | 说明 |
|------|---------|------|
| **Python SDK** | 复杂逻辑、多步编排、流式处理 | 写 Python 脚本，通过 Bash 执行 |
| **kweaver CLI** | 简单查询、快速操作 | 直接 Bash 执行 `kweaver <cmd>` |

优先用 CLI 完成简单操作；需要复杂编排时用 SDK。

## 环境准备

**重要规则**:
1. 如果环境变量 `KWEAVER_PYTHON` 已设置，用它作为 Python 解释器路径；否则用 `python`
2. 客户端初始化代码必须**原样复制**，不要修改参数名或尝试其他值
3. **所有环境变量已预配置，直接执行代码即可。禁止提前检查环境变量是否存在，禁止询问用户提供密码或 Token。**

### 认证优先级

SDK 按以下顺序尝试认证（无需用户干预）：

1. **ConfigAuth**（推荐）— 读取 `~/.kweaver/` 凭据（与 kweaverc CLI 共享），自动刷新 Token
2. **PasswordAuth** — 通过 `ADP_USERNAME` + `ADP_PASSWORD` 环境变量
3. **TokenAuth** — 通过 `ADP_TOKEN` 环境变量

### SDK 客户端初始化（直接复制使用，禁止修改）

```python
import os
from kweaver import ADPClient, ConfigAuth, TokenAuth, PasswordAuth
from kweaver.skills import (
    ConnectDbSkill, BuildKnSkill, LoadKnContextSkill, QueryKnSkill,
    DiscoverAgentsSkill, ChatAgentSkill, ExecuteActionSkill,
)

# 优先 ConfigAuth（零配置），fallback 到 PasswordAuth / TokenAuth
base_url = os.environ.get("ADP_BASE_URL")
username = os.environ.get("ADP_USERNAME")
password = os.environ.get("ADP_PASSWORD")
token = os.environ.get("ADP_TOKEN")
bd = os.environ.get("ADP_BUSINESS_DOMAIN")

try:
    # ConfigAuth: 读取 ~/.kweaver/ 凭据（kweaverc 或 kweaver auth login 写入）
    client = ADPClient(auth=ConfigAuth(), business_domain=bd)
except Exception:
    if username and password:
        auth = PasswordAuth(base_url, username, password)
    elif token:
        auth = TokenAuth(token)
    else:
        raise RuntimeError("无法认证: 请先运行 'kweaver auth login' 或设置 ADP_TOKEN 环境变量")
    client = ADPClient(base_url=base_url, auth=auth, business_domain=bd)
```

---

## CLI 命令速查

### 认证

```bash
kweaver auth login <platform-url>             # 浏览器 OAuth2 登录
kweaver auth login <platform-url> --alias prod  # 登录并设别名
kweaver auth status                            # 当前认证状态
kweaver auth list                              # 已保存的平台
kweaver auth use <platform|alias>              # 切换平台
kweaver auth logout                            # 登出
```

### 知识网络

```bash
kweaver kn list [--name <filter>]
kweaver kn get <kn-id>
kweaver kn export <kn-id>
kweaver kn build <kn-id> [--no-wait]
kweaver kn delete <kn-id>
```

### 查询

```bash
kweaver query search <kn-id> "<query>"
kweaver query instances <kn-id> <ot-id> [--condition '<json>'] [--limit N]
kweaver query kn-search <kn-id> "<query>" [--only-schema]
```

### Action

```bash
kweaver action query <kn-id> <at-id>
kweaver action execute <kn-id> <at-id> [--params '<json>'] [--no-wait]
kweaver action logs <kn-id> [--limit N]
kweaver action log <kn-id> <log-id>
```

### Agent

```bash
kweaver agent list [--keyword <text>]
kweaver agent chat <agent-id> -m "<message>" [--conversation-id <id>]
```

### 通用 API 调用

```bash
kweaver call <path>                            # GET（自动注入认证）
kweaver call <path> -X POST -d '<json>'        # POST
```

---

## SDK Skill 详解

根据用户意图，选择下面 **一个或多个** 操作组合执行。

### 1. connect_db — 连接数据库

**何时用**: 用户想接入一个数据库、查看库里有哪些表。

```python
result = ConnectDbSkill(client).run(
    db_type="mysql",       # mysql|postgresql|oracle|sqlserver|clickhouse|...
    host="10.0.1.100",
    port=3306,
    database="erp_prod",
    account="readonly",
    password="xxx",
)
# 返回: { datasource_id, tables: [{ name, columns: [{ name, type, comment }] }] }
```

### 2. build_kn — 构建知识网络

**何时用**: 用户想把数据库中的表建模为知识网络。需要先 connect_db 拿到 datasource_id。

```python
result = BuildKnSkill(client).run(
    datasource_id="<connect_db 返回的 ID>",
    network_name="erp_prod",
    tables=["products", "inventory", "suppliers"],
    relations=[{
        "name": "产品_库存",
        "from_table": "products", "to_table": "inventory",
        "from_field": "material_number", "to_field": "material_code",
    }],
)
# 返回: { kn_id, kn_name, object_types, relation_types, status }
```

### 3. load_kn_context — 查看知识网络结构与数据

**何时用**: 用户想了解有哪些知识网络、某个网络的 Schema、或某个对象类的实例数据。

```python
skill = LoadKnContextSkill(client)

# 3a. overview — 列出所有知识网络
result = skill.run(mode="overview")
result = skill.run(mode="overview", keyword="erp")

# 3b. schema — 查看某个知识网络的完整结构
result = skill.run(mode="schema", kn_name="erp_prod")
result = skill.run(mode="schema", kn_name="erp_prod", include_samples=True, sample_size=3)

# 3c. instances — 查看某个对象类的实例
result = skill.run(mode="instances", kn_name="erp_prod", object_type="products", limit=10)
```

### 4. query_kn — 查询知识网络

**何时用**: 用户有具体的业务问题要查询（语义搜索、精确查询、关联查询）。

```python
skill = QueryKnSkill(client)

# 4a. search — 语义搜索
result = skill.run(kn_id="<id>", mode="search", query="高库存的产品")

# 4b. instances — 精确查询某类对象
result = skill.run(
    kn_id="<id>", mode="instances", object_type="products",
    conditions={"field": "status", "operation": "eq", "value": "active"},
    limit=20,
)

# 4c. subgraph — 沿关系路径做关联查询
result = skill.run(
    kn_id="<id>", mode="subgraph",
    start_object="products",
    start_condition={"field": "category", "operation": "eq", "value": "电子"},
    path=["inventory", "suppliers"],
)
```

### 5. discover_agents — 发现 Decision Agent

**何时用**: 用户想知道平台上有哪些可用的 Agent。

```python
skill = DiscoverAgentsSkill(client)

# 5a. list — 列出所有已发布的 Agent
result = skill.run(mode="list")
result = skill.run(mode="list", keyword="供应链")

# 5b. detail — 查看某个 Agent 的详情
result = skill.run(mode="detail", agent_name="供应链助手")
```

### 6. chat_agent — 与 Decision Agent 对话

**何时用**: 用户想跟某个 Agent 聊天、问业务问题。

```python
skill = ChatAgentSkill(client)

# 6a. ask — 向 Agent 提问（自动创建会话）
result = skill.run(mode="ask", agent_name="供应链助手", question="华东仓库库存情况")
# 返回: { answer, conversation_id, references }

# 6b. ask — 续接已有会话（多轮对话）
result = skill.run(
    mode="ask", agent_name="供应链助手",
    question="和上个月相比呢？",
    conversation_id="<上一轮返回的 conversation_id>",
)

# 6c. ask — 流式输出
result = skill.run(mode="ask", agent_name="供应链助手", question="详细分析", stream=True)
```

### 7. execute_action — 执行 Action

**何时用**: 用户明确要求执行某个 Action（有副作用，需用户确认）。

```python
skill = ExecuteActionSkill(client)

# 按名称执行（自动查找 action_type_id）
result = skill.run(kn_name="erp_prod", action_name="库存盘点")
# 返回: { execution_id, status, result }

# 按 ID 执行，传入参数
result = skill.run(
    kn_id="<id>", action_type_id="<at_id>",
    params={"warehouse": "华东"},
    timeout=600,
)

# 异步执行（不等待完成）
result = skill.run(kn_id="<id>", action_type_id="<at_id>", wait=False)
```

---

## 操作编排指南

典型的多步流程：

1. **从零构建**: connect_db → build_kn → load_kn_context(schema) → query_kn
2. **探索已有**: load_kn_context(overview) → load_kn_context(schema) → query_kn
3. **直接查询**: 如果用户给了明确的 kn_id/kn_name，直接 query_kn
4. **发现 Agent**: discover_agents(list) → discover_agents(detail) → chat_agent(ask)
5. **Agent 多轮对话**: chat_agent(ask) → chat_agent(ask, conversation_id=...) 续接
6. **执行 Action**: load_kn_context(schema) → execute_action(kn_name, action_name)

## 注意事项

- 所有 Skill 操作返回 dict。如果 `result.get("error")` 为 True，向用户说明错误原因。
- kn_name 可以替代 kn_id 使用（SDK 内部自动按名称查找）。
- agent_name 可以替代 agent_id 使用（SDK 内部自动按名称查找）。
- 不要向用户暴露 dataview_id、ot_id 等内部 ID，用名称展示即可。
- 构建知识网络(build_kn)可能需要等待一段时间，提前告知用户。
- execute_action 有副作用，仅在用户明确请求时执行，执行前向用户确认。
- **不要自行猜测或枚举 business_domain 值**，只使用环境变量中配置的值。
- 如果 API 返回 "Bad Request"，最常见原因是 Token 过期或 business_domain 未设置。
