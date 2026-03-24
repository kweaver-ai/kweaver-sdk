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

两套 CLI 命令结构完全一致（`kweaver auth`、`kweaver bkn`、`kweaver agent`、`kweaver context-loader` 等），凭据共享 `~/.kweaver/`。

## 认证

```bash
kweaver auth login https://your-kweaver-instance.com
kweaver auth login https://your-kweaver-instance.com --alias prod
```

或使用环境变量：`KWEAVER_BASE_URL`、`KWEAVER_BUSINESS_DOMAIN`、`KWEAVER_TOKEN`。

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
const graph     = await client.bkn.querySubgraph("bkn-id", { ... });
await client.bkn.executeAction("bkn-id", "at-id", { ... });

// Context Loader
const cl      = client.contextLoader(mcpUrl, "bkn-id");
const results = await cl.search({ query: "高血压 治疗" });
```

## Python SDK 用法

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
```

## 命令速查

```bash
kweaver auth login <url> [--alias name] [-u user] [-p pass] [--playwright] — 另有 status、list、use、delete、logout
kweaver token
kweaver bkn list/get/stats/export/create/update/delete
kweaver bkn object-type list/get/create/update/delete/query/properties
kweaver bkn relation-type list/get/create/update/delete
kweaver bkn action-type list/query/execute
kweaver bkn subgraph
kweaver bkn action-execution get
kweaver bkn action-log list/get/cancel
kweaver agent list/get/chat/sessions/history
kweaver context-loader config set/use/list/show
kweaver context-loader kn-search/query-object-instance/...
kweaver call <path> [-X METHOD] [-d BODY] [-H header] [-bd domain]
```

Python CLI 额外提供：`kweaver ds`（数据源）、`kweaver query`（语义搜索、实例、子图）、`kweaver action`（高层编排）。

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
└── README.md
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
kweaver context-loader kn-search "关键词"

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
npx tsx src/cli.ts context-loader kn-search "关键词"
```

**Python CLI**：

```bash
cd packages/python
.venv/bin/kweaver auth status
.venv/bin/kweaver agent list
.venv/bin/kweaver bkn list
.venv/bin/kweaver bkn object-type list <kn_id>
.venv/bin/kweaver context-loader kn-search "关键词"
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

[![skills.sh](https://skills.sh/badge/kweaver-core)](https://skills.sh/kweaver-ai/kweaver-sdk)
[![skills.sh](https://skills.sh/badge/create-bkn)](https://skills.sh/kweaver-ai/kweaver-sdk)

使用 **kweaver-core** 前需先安装 CLI 并完成认证：

```bash
npm install -g @kweaver-ai/kweaver-sdk
kweaver auth login https://your-kweaver-instance.com
```

- [skills/kweaver-core/SKILL.md](skills/kweaver-core/SKILL.md) — CLI 工作流
- [skills/create-bkn/SKILL.md](skills/create-bkn/SKILL.md) — BKN 目录结构与参考文档
