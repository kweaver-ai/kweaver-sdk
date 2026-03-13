# kweaver-caller 能力整合方案

## 1. 背景

| 项目 | 语言 | 定位 |
|------|------|------|
| **kweaver-sdk** | Python | Agent-oriented SDK，6 个 Skills + 低层 Resources API |
| **kweaver-caller** | TypeScript | CLI 工具，覆盖 OAuth2 多平台管理、Agent 对话、BKN CRUD、本体查询、Context-Loader MCP |

目标：将 kweaver-caller 中 SDK 尚未覆盖的能力整合进 kweaver-sdk，使 Python SDK 成为完整的 ADP 客户端。

---

## 2. 能力对比

| 能力 | kweaver-sdk | kweaver-caller | 整合优先级 |
|------|:-----------:|:--------------:|:----------:|
| 数据源 CRUD | ✅ | ❌ | — |
| 数据视图 CRUD | ✅ | ❌ | — |
| 知识网络 create/list/get/delete | ✅ | ✅ | — |
| 知识网络 update / export | ❌ | ✅ | **P1** |
| 对象类 / 关系类 CRUD | ✅ | ❌ | — |
| 对象类属性查询 | ❌ | ✅ | **P1** |
| 实例查询 | ✅ | ✅ | — |
| 子图查询 | ✅ | ✅ | — |
| 语义搜索 | ✅ | ❌ | — |
| **Action Type 查询/执行** | ❌ | ✅ | **P0** |
| **Action 执行状态/日志/取消** | ❌ | ✅ | **P0** |
| Agent 列表/详情 | ✅ | ✅ | — |
| Agent 对话 (含流式) | ✅ | ✅ | — |
| **Context-Loader MCP** | ❌ | ✅ | **P1** |
| **OAuth2 浏览器授权流** | ❌ (Playwright) | ✅ (本地回调) | **P2** |
| **多平台配置管理** | ❌ | ✅ | **P2** |
| **CLI 命令行** | ❌ | ✅ | **P2** |
| 通用 API 调用 (curl-style) | ❌ | ✅ | P3 |

---

## 3. 整合方案

### 3.1 P0 — Action Type 资源 (新增 `resources/action_types.py`)

kweaver-caller 覆盖的 Action 相关 API 是 SDK 最大的功能缺口，这是知识网络"可执行操作"的核心能力。

#### 3.1.1 新增 Resource: `ActionTypesResource`

```python
# src/kweaver/resources/action_types.py

class ActionTypesResource:
    """知识网络 Action Type 查询、执行与日志管理"""

    def query(self, kn_id: str, action_type_id: str, body: dict) -> dict:
        """查询 Action Type 定义与参数"""
        # POST /api/ontology-query/v1/knowledge-networks/{kn_id}/action-types/{at_id}/
        # Header: X-HTTP-Method-Override: GET

    def execute(self, kn_id: str, action_type_id: str, params: dict) -> ActionExecution:
        """执行 Action，返回异步执行对象"""
        # POST /api/ontology-query/v1/knowledge-networks/{kn_id}/action-types/{at_id}/execute

    def get_execution(self, kn_id: str, execution_id: str) -> dict:
        """获取执行状态"""
        # GET /api/ontology-query/v1/knowledge-networks/{kn_id}/action-executions/{execution_id}

    def list_logs(self, kn_id: str, *, offset: int = 0, limit: int = 20,
                  sort: str = "create_time", direction: str = "desc") -> list[dict]:
        """列出 Action 执行日志"""
        # GET /api/ontology-query/v1/knowledge-networks/{kn_id}/action-logs

    def get_log(self, kn_id: str, log_id: str) -> dict:
        """获取单条执行日志"""
        # GET /api/ontology-query/v1/knowledge-networks/{kn_id}/action-logs/{log_id}

    def cancel(self, kn_id: str, log_id: str) -> None:
        """取消正在执行的 Action"""
        # POST /api/ontology-query/v1/knowledge-networks/{kn_id}/action-logs/{log_id}/cancel
```

#### 3.1.2 新增类型

```python
# types.py 新增
class ActionType(BaseModel):
    id: str
    name: str
    kn_id: str
    description: str | None = None
    input_params: list[dict] = []
    output_params: list[dict] = []

class ActionExecution(BaseModel):
    execution_id: str
    kn_id: str
    action_type_id: str
    status: str  # pending, running, completed, failed, cancelled

    def poll(self) -> "ActionExecution": ...
    def wait(self, timeout: float = 300, poll_interval: float = 2) -> "ActionExecution": ...
    def cancel(self) -> None: ...
```

#### 3.1.3 挂载到 ADPClient

```python
# _client.py
class ADPClient:
    @property
    def action_types(self) -> ActionTypesResource: ...
```

#### 3.1.4 新增 Skill: `ExecuteActionSkill`

```python
# skills/execute_action.py
class ExecuteActionSkill(BaseSkill):
    """执行知识网络中的 Action 并等待结果"""

    def run(self, *, kn_id: str | None = None, kn_name: str | None = None,
            action_name: str, params: dict = {},
            wait: bool = True, timeout: float = 300) -> dict:
        # 1. 按名称解析 kn_id
        # 2. 查询匹配的 action_type
        # 3. 执行并等待完成
        # 返回: {"execution_id": "...", "status": "completed", "result": {...}}
```

---

### 3.2 P1 — 知识网络增强 & Context-Loader MCP

#### 3.2.1 知识网络 update / export

在现有 `KnowledgeNetworksResource` 中补充：

```python
class KnowledgeNetworksResource:
    # 已有: create, list, get, delete, build, build_status

    def update(self, kn_id: str, *, name: str | None = None,
               comment: str | None = None, tags: list[str] | None = None) -> KnowledgeNetwork:
        """更新知识网络元信息"""
        # PUT /api/ontology-manager/v1/knowledge-networks/{kn_id}

    def export(self, kn_id: str) -> dict:
        """导出知识网络完整定义 (含对象类、关系类、属性)"""
        # GET /api/ontology-manager/v1/knowledge-networks/{kn_id}?mode=export
```

#### 3.2.2 对象类属性查询

在现有 `ObjectTypesResource` 或 `QueryResource` 中补充：

```python
class QueryResource:
    # 已有: semantic_search, kn_search, instances, instances_iter, subgraph

    def object_type_properties(self, kn_id: str, ot_id: str, body: dict = {}) -> dict:
        """查询对象类属性定义及统计"""
        # POST /api/ontology-query/v1/knowledge-networks/{kn_id}/object-types/{ot_id}/properties
```

#### 3.2.3 Context-Loader MCP 客户端 (新增 `mcp/` 模块)

kweaver-caller 的 Context-Loader 通过 JSON-RPC 2.0 协议与后端 MCP 服务通信，提供了 6 个工具：

| MCP Tool | 说明 | SDK 已有对应 |
|----------|------|:------------:|
| `kn_search` | 知识网络语义搜索 | ✅ `query.kn_search` |
| `kn_schema_search` | Schema 搜索 | 部分 (`LoadKnContextSkill`) |
| `query_object_instance` | 实例查询 (Layer 2) | ✅ `query.instances` |
| `query_instance_subgraph` | 子图查询 | ✅ `query.subgraph` |
| `get_logic_properties_values` | 逻辑属性值 (Layer 3) | ❌ |
| `get_action_info` | Action 信息 | ❌ (P0 整合后有) |

**整合策略**：新增 `src/kweaver/mcp/` 模块，提供标准 MCP 客户端，可被 Claude Code / Cursor 等工具直接使用。

```python
# src/kweaver/mcp/__init__.py
# src/kweaver/mcp/client.py
# src/kweaver/mcp/server.py  (可选，作为 MCP Server 暴露)

class MCPClient:
    """KWeaver Context-Loader MCP 客户端"""

    def __init__(self, http: HttpClient, kn_id: str):
        self._endpoint = "/api/agent-retrieval/v1/mcp"
        self._session_id: str | None = None

    async def initialize(self) -> dict: ...
    async def list_tools(self) -> list[dict]: ...
    async def call_tool(self, name: str, arguments: dict) -> dict: ...
    async def list_resources(self) -> list[dict]: ...
    async def read_resource(self, uri: str) -> dict: ...
    async def list_prompts(self) -> list[dict]: ...
    async def get_prompt(self, name: str, arguments: dict = {}) -> dict: ...
```

**可选扩展 — MCP Server 模式**：将 SDK 能力以 MCP Server 形式暴露，使其可以被任何 MCP 客户端调用：

```python
# src/kweaver/mcp/server.py
class KWeaverMCPServer:
    """将 kweaver-sdk 能力暴露为 MCP Server (stdio 传输)"""
    # 使用 mcp-python-sdk 库实现
    # 工具: connect_db, build_kn, query_kn, load_kn_context, ...
```

---

### 3.3 P2 — OAuth2 授权 & 多平台 & CLI

#### 3.3.1 认证整合策略

**核心原则：共享凭据存储 `~/.kweaver/`，不共享代码。**

kweaverc 已有完善的 OAuth2 登录 + 多平台管理。Python SDK 不重新发明轮子，而是复用其凭据格式：

```
kweaverc auth <url>            ──┐
kweaver auth login <url>       ──┼──▶ ~/.kweaver/platforms/<encoded>/token.json
OAuth2BrowserAuth(url).login() ──┘        │
                                          ▼
                               ConfigAuth() ──▶ auth_headers()
                                          ▼
                               ADPClient / Skill / CLI 均可使用
```

三条写入路径 + 一个读取入口。用户用任一工具登录后，所有工具直接可用。

新增两个 AuthProvider：

| 类 | 职责 | 与 kweaverc 的关系 |
|---|---|---|
| `ConfigAuth` | 读取 ~/.kweaver/ 已有凭据，自动刷新 | 消费 kweaverc 写入的 token |
| `OAuth2BrowserAuth` | Python 侧独立 OAuth2 登录，写入 ~/.kweaver/ | 行为与 `kweaverc auth` 一致 |

**关键兼容约束：**

- 目录编码：URL-safe base64（`+`→`-`，`/`→`_`，去尾部 `=`）
- JSON 字段名：camelCase（`accessToken`、`expiresAt`、`refreshToken`）
- Token 刷新阈值：过期前 60 秒
- 刷新时保留旧 refresh_token（若服务端未返回新的）
- 文件权限：0o600（文件）/ 0o700（目录）
- expiresAt 格式：ISO 8601 datetime string

> 完整的存储格式、OAuth2 流程时序图和实现接口见 `kweaver_sdk_design.md` §8.2。

#### 3.3.2 CLI (新增 `kweaver` 命令)

使用 `click` 或 `typer` 提供 Python CLI，行为与 kweaverc 对齐，共享 SDK 实现：

```
kweaver auth login <url>           # OAuth2 浏览器登录（同 kweaverc auth <url>）
kweaver auth status                # 当前认证状态（同 kweaverc auth status）
kweaver auth list                  # 已保存的平台（同 kweaverc auth list）
kweaver auth use <url|alias>       # 切换平台（同 kweaverc auth use）
kweaver auth logout                # 登出（同 kweaverc auth logout）

kweaver token                      # 打印 access token

kweaver kn list                    # 列出知识网络
kweaver kn get <id>                # 查看知识网络
kweaver kn build <id>              # 构建知识网络
kweaver kn export <id>             # 导出知识网络

kweaver query instances <kn-id> <ot-id> [--condition JSON]
kweaver query subgraph <kn-id> [--paths JSON]
kweaver query search <kn-id> <query>

kweaver action query <kn-id> <at-id>
kweaver action execute <kn-id> <at-id> [--params JSON]
kweaver action logs <kn-id>
kweaver action cancel <kn-id> <log-id>

kweaver agent list [--keyword STR]
kweaver agent chat <agent-id> [-m MESSAGE] [--stream]

kweaver call <url> [-X METHOD] [-H HEADER] [-d BODY]   # 通用 API 调用
```

**CLI 内部认证方式：** 所有命令通过 `ConfigAuth()` 读取 `~/.kweaver/` 凭据。`kweaver auth login` 使用 `OAuth2BrowserAuth` 完成登录后写入凭据，后续命令自动复用。

**新增依赖**: `click >= 8.0` 或 `typer >= 0.9` (可选安装)

---

## 4. 实施计划

### Phase 1: P0 — Action Types (预计 2-3 天)

| 步骤 | 产出 | 文件 |
|------|------|------|
| 1 | ActionType / ActionExecution 类型 | `types.py` |
| 2 | ActionTypesResource 实现 | `resources/action_types.py` |
| 3 | 挂载到 ADPClient | `_client.py` |
| 4 | ExecuteActionSkill | `skills/execute_action.py` |
| 5 | 单元测试 | `tests/unit/test_action_types.py` |
| 6 | E2E 测试 | `tests/e2e/test_action_e2e.py` |

### Phase 2: P1 — KN 增强 + MCP (预计 3-4 天)

| 步骤 | 产出 | 文件 |
|------|------|------|
| 1 | KN update / export | `resources/knowledge_networks.py` |
| 2 | 对象类属性查询 | `resources/query.py` |
| 3 | MCPClient 实现 | `mcp/client.py` |
| 4 | MCP 工具封装 | `mcp/__init__.py` |
| 5 | 单元测试 | `tests/unit/test_mcp.py` |
| 6 | (可选) MCP Server | `mcp/server.py` |

### Phase 3: P2 — OAuth2 + 配置 + CLI (预计 4-5 天)

| 步骤 | 产出 | 文件 |
|------|------|------|
| 1 | OAuth2BrowserAuth | `_auth.py` |
| 2 | PlatformStore / ConfigAuth | `config/store.py` |
| 3 | CLI 框架 + auth 命令 | `cli/auth.py` |
| 4 | CLI query/action/agent 命令 | `cli/*.py` |
| 5 | pyproject.toml console_scripts | `pyproject.toml` |
| 6 | 测试 | `tests/unit/test_cli.py` |

---

## 5. 整合后的目标架构

### 5.1 分层关系

Skill 在最上层，可向下引用 CLI 或直接调用 SDK；CLI 只向下引用 SDK，不引用 Skill。

```
┌──────────────────────────────────────────────────────────┐
│  Skill 层（最上层，面向 Agent）                            │
│  可调用 CLI 命令（如 kweaver kn list）                     │
│  也可直接调用 SDK Python API                               │
├──────────────────────────────────────────────────────────┤
│  CLI 层（面向终端用户）                                    │
│  kweaver 命令行，交互式操作                                │
│  只调用 SDK，不引用 Skill                                  │
├──────────────────────────────────────────────────────────┤
│  SDK 层（面向开发者）                                      │
│  Resources API，1:1 映射 ADP 概念                         │
├──────────────────────────────────────────────────────────┤
│  HTTP 层 + Config 层                                      │
│  httpx / 认证 / 重试 / ~/.kweaver/ 凭据管理                │
└──────────────────────────────────────────────────────────┘
```

依赖方向：
```
Skill ──→ CLI ──→ SDK ──→ HTTP     (Skill 通过 CLI 命令操作)
Skill ──────────→ SDK ──→ HTTP     (Skill 也可直接调 SDK)
```

### 5.2 目录变更

`[已有]` = 不改动，`[改]` = 修改已有文件，`[新]` = 新增文件/目录。

```
kweaver-sdk/
├── pyproject.toml                          [改] 新增 [project.scripts], [project.optional-dependencies].cli
├── src/kweaver/
│   ├── __init__.py                         [改] 导出 ConfigAuth, OAuth2BrowserAuth
│   ├── _client.py                          [改] 新增 .action_types 属性
│   ├── _auth.py                            [改] 新增 OAuth2BrowserAuth, ConfigAuth 两个类
│   ├── _http.py                            [已有]
│   ├── _errors.py                          [已有]
│   ├── _crypto.py                          [已有]
│   ├── types.py                            [改] 新增 ActionType, ActionExecution 模型
│   │
│   ├── config/                             [新] 凭据持久化，被 _auth.py 和 cli/ 共同使用
│   │   ├── __init__.py                     [新]
│   │   └── store.py                        [新] PlatformStore — ~/.kweaver/ 读写
│   │
│   ├── mcp/                                [新] Context-Loader MCP 客户端
│   │   ├── __init__.py                     [新]
│   │   ├── client.py                       [新] MCPClient (JSON-RPC 2.0)
│   │   └── server.py                       [新] 可选，MCP Server 模式
│   │
│   ├── resources/
│   │   ├── __init__.py                     [已有]
│   │   ├── datasources.py                  [已有]
│   │   ├── dataviews.py                    [已有]
│   │   ├── knowledge_networks.py           [改] 新增 update(), export()
│   │   ├── object_types.py                 [已有]
│   │   ├── relation_types.py               [已有]
│   │   ├── query.py                        [改] 新增 object_type_properties()
│   │   ├── agents.py                       [已有]
│   │   ├── conversations.py                [已有]
│   │   └── action_types.py                 [新] ActionTypesResource
│   │
│   ├── cli/                                [新] CLI 层 — 只调用 SDK，不引用 skills/
│   │   ├── __init__.py                     [新]
│   │   ├── main.py                         [新] click/typer 入口
│   │   ├── auth.py                         [新] kweaver auth login/status/use/logout
│   │   ├── kn.py                           [新] kweaver kn list/get/build/export
│   │   ├── query.py                        [新] kweaver query instances/subgraph/search
│   │   ├── action.py                       [新] kweaver action execute/logs/cancel
│   │   ├── agent.py                        [新] kweaver agent list/chat
│   │   └── call.py                         [新] kweaver call <url>
│   │
│   └── skills/                             Skill 层（最上层）— 可调用 cli/ 或 resources/
│       ├── __init__.py                     [改] 导出 ExecuteActionSkill
│       ├── _base.py                        [已有]
│       ├── connect_db.py                   [已有]
│       ├── build_kn.py                     [已有]
│       ├── load_kn_context.py              [已有]
│       ├── query_kn.py                     [已有]
│       ├── discover_agents.py              [已有]
│       ├── chat_agent.py                   [已有]
│       └── execute_action.py               [新] ExecuteActionSkill
│
└── tests/
    ├── conftest.py                         [已有]
    ├── unit/
    │   ├── test_auth.py                    [改] 新增 ConfigAuth, OAuth2BrowserAuth 测试
    │   ├── test_datasources.py             [已有]
    │   ├── test_dataviews.py               [已有]
    │   ├── test_knowledge_networks.py      [改] 新增 update/export 测试
    │   ├── test_object_types.py            [已有]
    │   ├── test_relation_types.py          [已有]
    │   ├── test_query.py                   [改] 新增 object_type_properties 测试
    │   ├── test_agents.py                  [已有]
    │   ├── test_conversations.py           [已有]
    │   ├── test_errors.py                  [已有]
    │   ├── test_action_types.py            [新] ActionTypesResource 单元测试
    │   ├── test_config.py                  [新] PlatformStore 单元测试
    │   └── test_mcp.py                     [新] MCPClient 单元测试
    ├── integration/
    │   ├── test_connect_db.py              [已有]
    │   ├── test_build_kn.py                [已有]
    │   ├── test_load_kn_context.py         [已有]
    │   ├── test_query_kn.py                [已有]
    │   ├── test_discover_agents.py         [已有]
    │   └── test_chat_agent.py              [已有]
    ├── cli/                                [新] CLI 命令测试
    │   ├── test_auth_commands.py           [新]
    │   ├── test_kn_commands.py             [新]
    │   └── test_query_commands.py          [新]
    └── e2e/
        ├── conftest.py                     [已有]
        ├── test_agents_e2e.py              [已有]
        ├── test_build_e2e.py               [已有]
        ├── test_context_loader_e2e.py      [已有]
        ├── test_datasource_e2e.py          [已有]
        ├── test_full_flow_e2e.py           [已有]
        ├── test_query_e2e.py               [已有]
        └── test_action_e2e.py              [新] Action 执行 E2E 测试
```

**变更统计：**

| 类别 | 新增文件 | 修改文件 | 不变文件 |
|------|:-------:|:-------:|:-------:|
| src/kweaver/ 核心 | 0 | 4 (`__init__`, `_client`, `_auth`, `types`) | 3 |
| src/kweaver/config/ | 2 | — | — |
| src/kweaver/mcp/ | 3 | — | — |
| src/kweaver/resources/ | 1 (`action_types`) | 2 (`knowledge_networks`, `query`) | 7 |
| src/kweaver/cli/ | 8 | — | — |
| src/kweaver/skills/ | 1 (`execute_action`) | 1 (`__init__`) | 7 |
| tests/ | 7 | 3 | 16 |
| **合计** | **22** | **10** | **33** |

---

## 6. 注意事项

1. **配置兼容**: `~/.kweaver/` 目录结构必须与 kweaver-caller 完全兼容，两个工具共享凭据。
2. **Header 对齐**: kweaver-caller 除 `Authorization` 外还发送 `token: {accessToken}`，需确认后端是否必需。
3. **X-HTTP-Method-Override**: kweaver-caller 的 ontology-query POST 请求带 `X-HTTP-Method-Override: GET`，SDK 的 `query.py` 也使用了这一模式，需保持一致。
4. **MCP Session 管理**: Context-Loader MCP 需要 initialize → tools/list → tools/call 的会话流程，需要管理 session 生命周期。
5. **CLI 可选安装**: CLI 依赖 (click/typer) 应作为 optional dependency，不影响作为库使用。
6. **向后兼容**: 所有新增能力为纯增量，不改变现有 API。
