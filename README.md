# KWeaver SDK

让 AI 智能体（Claude Code、GPT、自定义 Agent 等）通过 Skill 访问 KWeaver / ADP 平台的知识网络与 Decision Agent。同时提供 `kweaver` CLI 命令供终端用户直接操作。

## 这个项目解决什么问题

KWeaver (ADP) 平台提供了知识网络构建、语义搜索、Decision Agent 对话等能力，但这些能力藏在复杂的 REST API 背后。本 SDK 将它们封装为 **7 个 Skill**，每个 Skill 是一个 `run(**kwargs) -> dict` 的简单调用，智能体无需了解底层 API 细节即可完成操作。

## 前置条件

1. **Python >= 3.10**
2. **ADP 平台账号**
3. 安装 SDK：

```bash
pip install -e .           # 核心 SDK
pip install -e ".[cli]"    # 含 CLI 命令行工具（可选）
```

## 接入步骤

### 第 1 步：认证

提供四种认证方式，按推荐顺序：

#### 方式 A（推荐）：用 kweaverc 或 kweaver CLI 登录，SDK 共享凭据

```bash
# 用 kweaverc（TypeScript CLI）登录
kweaverc auth https://your-adp-instance.com

# 或用 kweaver（Python CLI）登录
kweaver auth login https://your-adp-instance.com
```

登录后凭据存储在 `~/.kweaver/`，SDK 通过 `ConfigAuth` 自动读取，无需配置环境变量：

```python
from kweaver import ADPClient, ConfigAuth

client = ADPClient(
    auth=ConfigAuth(),                   # 自动读取 ~/.kweaver/ 凭据，自动刷新
    business_domain="bd_public",         # 必填
)
```

也可以指定平台（多平台场景）：

```python
client = ADPClient(auth=ConfigAuth(platform="prod"), business_domain="bd_public")
```

#### 方式 B：用户名密码（程序化 / CI 环境）

```bash
export ADP_BASE_URL="https://your-adp-instance.com"
export ADP_BUSINESS_DOMAIN="bd_public"
export ADP_USERNAME="user@example.com"
export ADP_PASSWORD="your-password"
```

```python
from kweaver import ADPClient, PasswordAuth

auth = PasswordAuth(base_url, username, password)  # 依赖 Playwright
client = ADPClient(base_url=base_url, auth=auth, business_domain="bd_public")
```

> 方式 B 依赖 Playwright：`pip install playwright && playwright install chromium`

#### 方式 C：静态 Token（临时调试）

```bash
export ADP_BASE_URL="https://your-adp-instance.com"
export ADP_BUSINESS_DOMAIN="bd_public"
export ADP_TOKEN="Bearer ory_at_xxxxx"
```

```python
from kweaver import ADPClient, TokenAuth

client = ADPClient(base_url=base_url, auth=TokenAuth(token), business_domain="bd_public")
```

> **注意**: `ADP_BUSINESS_DOMAIN` 是必填项。不传或传错会导致 API 返回空结果或 Bad Request。

### 第 3 步：使用 Skill

所有 Skill 遵循相同模式：`Skill(client).run(**kwargs) -> dict`。

出错时不抛异常，而是返回 `{"error": True, "message": "..."}`，智能体可以直接将 message 展示给用户。

---

## 7 个 Skill

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

### 6. execute_action — 执行知识网络中的 Action

> "执行一下库存盘点" / "跑那个数据同步 Action"

```python
from kweaver.skills import ExecuteActionSkill
skill = ExecuteActionSkill(client)

# 按名称执行（自动查找 action_type_id）
result = skill.run(kn_name="erp_prod", action_name="库存盘点")
# -> {"execution_id": "exec_xxx", "status": "completed", "result": {...}}

# 按 ID 执行，传入参数
result = skill.run(
    kn_id="<id>", action_type_id="<at_id>",
    params={"warehouse": "华东"},
    timeout=600,
)

# 异步执行（不等待完成）
result = skill.run(kn_id="<id>", action_type_id="<at_id>", wait=False)
# -> {"execution_id": "exec_xxx", "status": "pending"}
```

### 7. build_kn — 构建知识网络

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
| 执行 Action | `load_kn_context(schema)` → `execute_action(kn_name, action_name)` |

## CLI 命令行

安装 `pip install -e ".[cli]"` 后可使用 `kweaver` 命令：

```bash
# 认证
kweaver auth login https://your-adp-instance.com   # 浏览器登录（与 kweaverc 共享凭据）
kweaver auth login https://xxx.com --alias prod    # 登录并设置别名
kweaver auth logout                                 # 登出当前平台
kweaver auth status                                 # 查看当前认证状态
kweaver auth list                                   # 已保存的平台
kweaver auth use prod                               # 切换平台（别名或 URL）

# 知识网络
kweaver kn list
kweaver kn get <kn-id>
kweaver kn export <kn-id>
kweaver kn build <kn-id>

# 查询
kweaver query search <kn-id> "高库存的产品"
kweaver query instances <kn-id> <ot-id> --condition '{"field":"status","op":"eq","value":"active"}'

# Action
kweaver action query <kn-id> <action-type-id>
kweaver action execute <kn-id> <action-type-id> --params '{"warehouse":"华东"}'
kweaver action logs <kn-id>

# Agent
kweaver agent list
kweaver agent chat <agent-id> -m "华东仓库库存情况"

# 通用 API 调用（类似 curl，自动注入认证）
kweaver call /api/ontology-manager/v1/knowledge-networks
```

CLI 与 kweaverc (TypeScript CLI) 共享 `~/.kweaver/` 凭据存储，用任一工具登录后另一个直接可用。

## 在 AI 智能体中使用

本项目内置 Skill 定义文件（`.claude/skills/kweaver/SKILL.md`），可部署到 Claude Code、OpenClaw 等支持 Skill 的智能体平台。

### Claude Code（本地开发）

当项目目录加入 Claude Code 工作区后，Skill 自动加载。认证推荐先用 CLI 登录：

```bash
kweaver auth login https://your-adp-instance.com    # 或 kweaverc auth <url>
```

Skill 内部通过 `ConfigAuth` 读取 `~/.kweaver/` 凭据，无需设置环境变量。

也可以用环境变量方式（兼容旧用法）：

```bash
export ADP_BASE_URL="https://your-adp-instance.com"
export ADP_BUSINESS_DOMAIN="bd_public"
export ADP_TOKEN="Bearer ory_at_xxxxx"    # 或 ADP_USERNAME + ADP_PASSWORD
```

### OpenClaw（网关 Bot 部署）

OpenClaw 网关以 Mac app / 后台进程方式运行，**不会继承你的 shell 环境变量**，因此需要额外配置步骤：

#### 1. 安装 SDK

```bash
pip install -e /path/to/kweaver-sdk
```

> **注意**: OpenClaw 网关通过 Mac app 启动时 PATH 非常精简。如果 SDK 装在 conda/venv 里，需要设置 `KWEAVER_PYTHON` 指向完整路径。

#### 2. 安装 Skill 文件

```bash
mkdir -p ~/.openclaw/skills/kweaver
cp /path/to/kweaver-sdk/.claude/skills/kweaver/SKILL.md ~/.openclaw/skills/kweaver/SKILL.md
```

#### 3. 配置认证

**推荐方式：** 先在终端用 CLI 登录，OpenClaw 网关进程能直接读取 `~/.kweaver/` 凭据：

```bash
kweaver auth login https://your-adp-instance.com
```

然后在 `~/.openclaw/openclaw.json` 中只需配 `ADP_BUSINESS_DOMAIN`：

```jsonc
{
  "skills": {
    "entries": {
      "kweaver": {
        "env": {
          "ADP_BUSINESS_DOMAIN": "bd_public",
          "KWEAVER_PYTHON": "/path/to/your/python"  // 可选
        }
      }
    }
  }
}
```

**备选方式（无法用 CLI 登录时）：** 配置 `ADP_USERNAME` + `ADP_PASSWORD` 或 `ADP_TOKEN` 环境变量。

#### 4. 验证

```bash
openclaw skills info kweaver    # 应显示 ✓ Ready
```

### 其他平台

只需将 `.claude/skills/kweaver/SKILL.md` 的内容适配到目标平台的 Skill/Plugin 格式，并确保运行环境能访问到已安装 kweaver SDK 的 Python 解释器。认证优先用 `~/.kweaver/` 共享凭据，或通过环境变量配置。

## 开发与测试

```bash
# 单元测试 + 集成测试
pytest

# E2E 测试（需要 ADP 环境）
pytest tests/e2e/ --run-destructive
```

E2E 测试推荐先用 `kweaver auth login` 登录，测试会自动使用 `~/.kweaver/` 凭据。也支持 `ADP_USERNAME` + `ADP_PASSWORD` 环境变量方式。
