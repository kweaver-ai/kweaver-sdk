# KWeaver SDK

> [KWeaver](https://github.com/kweaver-ai/KWeaver) 生态项目 — 开源知识网络构建、管理与查询平台。

[English](README.md)

让 AI 智能体（Claude Code、GPT、自定义 Agent 等）通过 `kweaver` CLI 命令访问 KWeaver 平台的知识网络与 Decision Agent。同时提供 Python 和 TypeScript SDK 供程序化集成。

## 安装

### TypeScript CLI（推荐，含交互式 agent chat TUI）

```bash
npm install -g @kweaver-ai/kweaver-sdk
```

需 Node.js 22+。安装后使用 `kweaver` 命令。

### TypeScript SDK（程序化调用）

```bash
npm install @kweaver-ai/kweaver-sdk
```

```typescript
import { KWeaverClient } from "@kweaver-ai/kweaver-sdk";

// 使用 CLI 存好的凭据（kweaver auth login 之后零配置）
const client = new KWeaverClient();

// 或显式传入
const client = new KWeaverClient({
  baseUrl: "https://your-kweaver.com",
  accessToken: "your-token",
});

const kns   = await client.knowledgeNetworks.list();
const reply = await client.agents.chat("agent-id", "你好");
console.log(reply.text);
```

### Python CLI（备用，用于测试或无 Node 环境）

```bash
pip install kweaver-sdk[cli]
```

需 Python >= 3.10。安装后同样使用 `kweaver` 命令。

### Python SDK（程序化调用）

```bash
pip install kweaver-sdk
```

```python
import kweaver

kweaver.configure(config=True, bkn_id="your-bkn-id", agent_id="your-agent-id")

results = kweaver.search("供应链有哪些风险？")
reply   = kweaver.chat("总结前三大风险")
print(reply.content)
```

## 定位

| 入口 | 安装方式 | 用途 |
|------|----------|------|
| **TS CLI** | `npm install -g @kweaver-ai/kweaver-sdk` | 主力 CLI，含 Ink 交互式 TUI、流式 agent chat |
| **TS SDK** | `npm install @kweaver-ai/kweaver-sdk` | 程序化 API，`import { KWeaverClient } from "@kweaver-ai/kweaver-sdk"` |
| **Python CLI** | `pip install kweaver-sdk[cli]` | 备用 CLI，功能对齐，用于测试或纯 Python 环境 |
| **Python SDK** | `pip install kweaver-sdk` | 程序化 API，`from kweaver import KWeaverClient` |

两套 CLI 命令结构完全一致（`kweaver auth`、`kweaver bkn`、`kweaver agent`、`kweaver skill`、`kweaver context-loader` 等），凭据共享 `~/.kweaver/`。

## 认证

```bash
kweaver auth login https://your-kweaver-instance.com
kweaver auth login https://your-kweaver-instance.com --alias prod
```

或使用环境变量：`KWEAVER_BASE_URL`、`KWEAVER_BUSINESS_DOMAIN`、`KWEAVER_TOKEN`。通过浏览器 OAuth2 登录写入的 `~/.kweaver/` 会话，**默认在 access token 过期时用 refresh_token 换发新 token**（OAuth2 refresh 授权，无需额外参数）。Node 版 `kweaver` CLI 的 TLS 说明见 [`packages/typescript/README.zh.md`](packages/typescript/README.zh.md) 中「环境变量」一节（含 `KWEAVER_TLS_INSECURE`、`NODE_TLS_REJECT_UNAUTHORIZED`）。

### 无浏览器环境（SSH、CI、容器）

**npm 版 `kweaver` CLI** 支持在无法打开浏览器的机器上完成登录：

1. 在**有浏览器**的机器上执行 `kweaver auth login https://你的实例`。登录成功后，本地回调页会显示可复制的一行命令；也可执行 `kweaver auth export` 或 `kweaver auth export --json`。
2. 在**无浏览器**的机器上执行该命令（含 `--client-id`、`--client-secret`、`--refresh-token`），会换取 token 并写入 `~/.kweaver/`，之后行为与正常登录一致。

详见 [`packages/typescript/README.zh.md`](packages/typescript/README.zh.md) 中「无浏览器 / 服务器端认证」一节。Python 版 `kweaver` CLI 仍为浏览器交互登录；可将已在 Node CLI 下登录生成的 `~/.kweaver/` 目录拷贝到目标机复用。

## 平台配置（business domain / 业务域）

多数接口会带 `x-business-domain`。**登录后应先确认或设置业务域**，DIP 类产品常用 UUID；若一直用默认 `bd_public`，列表类命令可能为空。

```bash
kweaver config show              # 当前平台与解析后的业务域
kweaver config list-bd           # 从平台列出可选业务域（需已登录）
kweaver config set-bd <uuid>     # 写入当前平台的默认业务域
```

优先级：`KWEAVER_BUSINESS_DOMAIN` 环境变量 → 平台目录下 `config.json` → `bd_public`。首次 `kweaver auth login` 成功后，若尚未配置，CLI 会尝试自动选择（列表含 `bd_public` 则选它，否则选第一项）。

详见 [`skills/kweaver-core/references/config.md`](skills/kweaver-core/references/config.md)。

## TypeScript SDK 用法

### 简洁 API（推荐）

```typescript
import kweaver from "@kweaver-ai/kweaver-sdk/kweaver";

// 使用 `kweaver auth login` 保存的凭据，零配置
kweaver.configure({ config: true, bknId: "your-bkn-id", agentId: "your-agent-id" });

// 搜索 BKN
const results = await kweaver.search("供应链有哪些关键风险？");
for (const concept of results.concepts) console.log(concept.concept_name);

// 与 Agent 对话
const reply = await kweaver.chat("总结前三大风险");
console.log(reply.text);

// 接入数据源或修改对象类后，重建 BKN 索引
await kweaver.weaver({ wait: true });

// 查看所有 BKN 和 Agent
const bknList   = await kweaver.bkns();
const agentList = await kweaver.agents();
```

### 底层客户端（高级用法）

```typescript
import { KWeaverClient } from "@kweaver-ai/kweaver-sdk";

const client = new KWeaverClient();   // 读取 ~/.kweaver/ 凭据

// 知识网络
const kns = await client.knowledgeNetworks.list({ limit: 10 });
const ots = await client.knowledgeNetworks.listObjectTypes("bkn-id");
const rts = await client.knowledgeNetworks.listRelationTypes("bkn-id");

// Agent 对话
const reply = await client.agents.chat("agent-id", "你好");
console.log(reply.text, reply.conversationId);

// 流式对话
await client.agents.stream("agent-id", "你好", {
  onTextDelta: (chunk) => process.stdout.write(chunk),
});

// BKN 引擎：实例查询、子图、Action 执行
const instances = await client.bkn.queryInstances("bkn-id", "ot-id", { limit: 20 });
const graph     = await client.bkn.querySubgraph("bkn-id", { /* path spec */ });
await client.bkn.executeAction("bkn-id", "at-id", { /* params */ });
const logs      = await client.bkn.listActionLogs("bkn-id");

// 数据源 & 数据视图
const dsList = await client.datasources.list();
const tables = await client.datasources.listTables("ds-id");
const viewId = await client.dataviews.create({ name: "v", datasourceId: "ds-id", table: "orders" });

// 数据流自动化（CSV 导入管线等）
const result = await client.dataflows.execute({
  title: "import", trigger_config: { operator: "manual" },
  steps: [{ id: "s1", title: "load", operator: "csv_import", parameters: {} }],
});

// Vega 可观测性
const catalogs = await client.vega.listCatalogs();

// Context Loader（知识网络语义搜索）
const cl      = client.contextLoader(mcpUrl, "bkn-id");
const results = await cl.search({ query: "高血压 治疗" });
```

## Python SDK 用法

### 纯 Python 认证

无需 Node CLI，仅 Python 即可登录，凭据写入 `~/.kweaver/`，与 CLI 一致：

- **HTTP 登录**（RSA 加密密码，对齐 `kweaver auth login --http-signin`）：`kweaver.login("https://…", username="…", password="…")`。若服务端要求首次改密（`401001017`），可传 `new_password=`。
- **Refresh token**：`kweaver.login("https://…", refresh_token="…", client_id="…", client_secret="…")`。
- **无鉴权实例**：`kweaver.login("https://…", no_auth=True)`。
- **浏览器 OAuth**：`kweaver.login("https://…")` 会打开浏览器；`open_browser=False` 对应无浏览器的粘贴流程。

`http_signin`、`whoami`、`list_platforms` 等位于 `kweaver.auth`。若希望首次调用 API 时再登录，可用 `kweaver.configure(..., username=…, password=…)` 或 `HttpSigninAuth`。

### 简洁 API（推荐）

```python
import kweaver

# 使用 `kweaver auth login` 保存的凭据，零配置
kweaver.configure(config=True, bkn_id="your-bkn-id", agent_id="your-agent-id")

# 搜索 BKN
results = kweaver.search("供应链有哪些关键风险？")
for concept in results.concepts:
    print(concept.concept_name)

# 与 Agent 对话
reply = kweaver.chat("总结前三大风险")
print(reply.content)

# 接入数据源或修改对象类后，重建 BKN 索引
kweaver.weaver(wait=True)

# 查看所有 BKN 和 Agent
for bkn in kweaver.bkns():
    print(bkn.id, bkn.name)
```

### 底层客户端（高级用法）

```python
from kweaver import KWeaverClient, ConfigAuth

client = KWeaverClient(auth=ConfigAuth())   # 读取 ~/.kweaver/ 凭据

# BKN
bkns = client.knowledge_networks.list()
ots  = client.object_types.list("bkn-id")

# Agent 对话
msg = client.conversations.send_message("", "你好", agent_id="agent-id")
print(msg.content)

# BKN 引擎：实例查询、Action 执行
instances = client.query.instances("bkn-id", "ot-id", limit=20)
result    = client.action_types.execute("bkn-id", "at-id", params={})

# 数据流自动化
from kweaver.resources.dataflows import DataflowStep
result = client.dataflows.execute(
    title="import", steps=[DataflowStep(id="s1", title="load", operator="csv_import")],
)
```

## 命令速查

```bash
kweaver auth login <url> [--alias name] [--no-browser] [-u user] [-p pass] [--new-password <pwd>] [--http-signin] [--insecure|-k]
# -u/-p（无论是否带 --http-signin）：HTTP POST /oauth2/signin（可拿 refresh_token）；缺失的用户名/密码会从 stdin 提示输入（TTY 下密码隐藏）
# 初始密码 401001017：TTY 会提示修改；脚本请加 --new-password <pwd>。
kweaver auth change-password [<url>] [-u <account>] [-o <old>] [-n <new>] [--insecure|-k]
kweaver auth login <url> --client-id ID --client-secret S --refresh-token T   （无浏览器主机）
kweaver auth export [url|alias] [--json]
kweaver auth status / whoami [url|alias] [--json]   # 无 ~/.kweaver/ 当前平台时可配 KWEAVER_BASE_URL+KWEAVER_TOKEN
kweaver auth list/use/delete/logout
kweaver config show / list-bd / set-bd <value>   # 业务域；show/list-bd 可配合 KWEAVER_BASE_URL（list-bd 还需 KWEAVER_TOKEN）
kweaver token
kweaver ds list/get/delete/tables/connect
kweaver ds import-csv <ds_id> --files <glob> [--table-prefix <p>] [--batch-size 500] [--recreate]
kweaver dataview|dv list/find/get/query/delete
kweaver bkn list/get/stats/export/create/update/delete
kweaver bkn build [--wait] [--timeout 300]
kweaver bkn create-from-ds <ds_id> --name <name> [--tables t1,t2] [--build]
kweaver bkn create-from-csv <ds_id> --files <glob> --name <name> [--build]
kweaver bkn validate/push/pull
kweaver bkn object-type list/get/create/update/delete/query/properties
kweaver bkn relation-type list/get/create/update/delete
kweaver bkn action-type list/query/inputs/execute
kweaver bkn subgraph / search
kweaver bkn action-execution get
kweaver bkn action-log list/get/cancel
kweaver agent list/get/get-by-key/create/update/delete/chat/sessions/history/publish/unpublish
kweaver skill list/market/get/register/status/delete/content/read-file/download/install
kweaver vega health/stats/inspect/sql/catalog/resource/connector-type
kweaver context-loader config set/use/list/show
kweaver context-loader search-schema/tool-call/kn-search/query-object-instance/...
kweaver call <path> [-X METHOD] [-d BODY] [-H header] [-bd domain]
```

两套 CLI 顶层命令名不完全一致，下表为 **Python CLI**（`pip install kweaver-sdk[cli]`）与 **TypeScript CLI**（`npm install -g @kweaver-ai/kweaver-sdk`）的对应关系。

| Python CLI | TypeScript CLI |
|------------|----------------|
| `kweaver query search <kn_id> <query>` | `kweaver bkn search <kn-id> <query>` |
| `kweaver query instances <kn_id> <ot_id> …` | `kweaver bkn object-type query <kn-id> <ot-id> …` |
| `kweaver query subgraph <kn_id> …`（用 flags 拼路径） | `kweaver bkn subgraph <kn-id> <body-json>`（JSON 体，格式不同） |
| `kweaver query kn-search <kn_id> <query>`（REST） | `kweaver context-loader kn-search <query>`（HTTP 兼容，使用已配置 KN），或 `kweaver context-loader search-schema <query>`（MCP `search_schema`） |
| `kweaver action query` / `execute` / `logs` … | `kweaver bkn action-type query|execute …`, `kweaver bkn action-log list|get|…` |

**仅 TypeScript CLI：** `kweaver config`、`kweaver vega`、`kweaver dataview`（别名 `dv`）、`kweaver ds import-csv`、`kweaver bkn create-from-csv`，以及完整的 `kweaver agent` 创建/更新/删除/发布等（见 `kweaver agent --help`）。

## 项目结构（Monorepo）

```
kweaver-sdk/
├── packages/
│   ├── python/                  # Python SDK + CLI
│   │   ├── src/kweaver/
│   │   │   ├── _client.py       # KWeaverClient
│   │   │   ├── resources/       # knowledge_networks, agents, ...
│   │   │   └── cli/             # kweaver 命令行
│   │   └── tests/
│   └── typescript/              # TypeScript SDK + CLI
│       ├── src/
│       │   ├── client.ts        # KWeaverClient
│       │   ├── resources/       # knowledge-networks, agents, bkn, ...
│       │   ├── api/             # 底层 HTTP 函数
│       │   └── commands/        # CLI 命令实现
│       └── test/
├── skills/kweaver-core/         # AI Agent Skill — KWeaver CLI（SKILL.md）
├── skills/create-bkn/           # AI Agent Skill — BKN 建模（SKILL.md）
├── docs/
├── README.md                    # English
└── README.zh.md                 # 中文（本文件）
```

## CLI 手动测试

以下命令用于验证 CLI 功能，需先完成 `kweaver auth login`。业务域默认 `bd_public`，可通过 `KWEAVER_BUSINESS_DOMAIN` 或 `-bd` 覆盖。

```bash
# 1. 认证状态
kweaver auth status

# 2. Agent 列表
kweaver agent list
kweaver agent list -v              # 完整输出

# 3. 给 Agent 发消息
kweaver agent chat <agent_id> -m "你好"
kweaver agent chat <agent_id> -m "续聊" --conversation-id <conversation_id>

# 4. BKN 列表与 Schema
kweaver bkn list
kweaver bkn list --limit 10
kweaver bkn object-type list <kn_id>
kweaver bkn relation-type list <kn_id>

# 5. Context-loader
kweaver context-loader config set --kn-id <kn_id> --name my-bkn
kweaver context-loader config use my-bkn
kweaver context-loader search-schema "关键词"
kweaver context-loader tool-call search_schema --args '{"query":"关键词"}'

# 6. 原始 API 调用
kweaver call "/api/agent-factory/v3/personal-space/agent-list?offset=0&limit=3" --pretty
```

**TypeScript CLI**（需 Node.js 22+）：

```bash
cd packages/typescript
npx tsx src/cli.ts auth status
npx tsx src/cli.ts agent list
npx tsx src/cli.ts agent chat <agent_id> -m "你好"
npx tsx src/cli.ts bkn list
npx tsx src/cli.ts bkn object-type list <kn_id>
npx tsx src/cli.ts context-loader search-schema "关键词"
```

**Python CLI**：

```bash
cd packages/python
.venv/bin/kweaver auth status
.venv/bin/kweaver agent list
.venv/bin/kweaver bkn list
.venv/bin/kweaver bkn object-type list <kn_id>
# Context Loader MCP 请使用 TypeScript CLI，或在 Python SDK 中直接使用 ContextLoaderResource。
```

## 开发与测试

```bash
# 仅 Python
make -C packages/python test

# 仅 TypeScript
make -C packages/typescript test
```

## 在 AI 智能体中使用

使用 [`skills` CLI](https://www.npmjs.com/package/skills)（`npx skills add`）安装 [Agent Skills](https://skills.sh)：

- **同一仓库多个 skill**：一条命令里重复写 `--skill`（见下方合并安装示例）。
- **不同仓库**：对每个仓库分别执行一次 `npx skills add <仓库 URL>`。

```bash
# KWeaver CLI — 认证、BKN/知识网络、Agent、Context Loader
npx skills add https://github.com/kweaver-ai/kweaver-sdk --skill kweaver-core

# BKN 建模 — 模块化 BKN v2.0.1（对象类/关系类/行动类等）
npx skills add https://github.com/kweaver-ai/kweaver-sdk --skill create-bkn

# 一条命令同时安装 kweaver-core 与 create-bkn
npx skills add https://github.com/kweaver-ai/kweaver-sdk \
  --skill kweaver-core --skill create-bkn
```

[![kweaver-core（skills.sh）](https://img.shields.io/badge/skills.sh-kweaver--core-6366f1?style=flat-square)](https://skills.sh/kweaver-ai/kweaver-sdk)
[![create-bkn（skills.sh）](https://img.shields.io/badge/skills.sh-create--bkn-6366f1?style=flat-square)](https://skills.sh/kweaver-ai/kweaver-sdk)

使用 **kweaver-core** 前需先安装 CLI 并完成认证：

```bash
npm install -g @kweaver-ai/kweaver-sdk
kweaver auth login https://your-kweaver-instance.com
```

- [skills/kweaver-core/SKILL.md](skills/kweaver-core/SKILL.md) — CLI 工作流
- [skills/create-bkn/SKILL.md](skills/create-bkn/SKILL.md) — BKN 目录结构与参考文档
