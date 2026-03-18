# @kweaver-ai/kweaver-sdk

KWeaver TypeScript SDK 和 CLI — 让 AI 智能体与应用程序以编程方式访问知识网络和 Decision Agent。

[English](README.md)

## 安装

```bash
# 全局安装 CLI
npm install -g @kweaver-ai/kweaver-sdk

# 作为库使用
npm install @kweaver-ai/kweaver-sdk
```

需要 **Node.js >= 22**。

## 快速上手

### 认证

```bash
kweaver auth login https://your-kweaver-instance.com
```

或使用环境变量：

```bash
export KWEAVER_BASE_URL=https://your-kweaver-instance.com
export KWEAVER_TOKEN=your-token
```

### 简洁 API（推荐）

```typescript
import kweaver from "@kweaver-ai/kweaver-sdk/kweaver";

// 使用 `kweaver auth login` 保存的凭据，零配置
kweaver.configure({ config: true, bknId: "your-bkn-id", agentId: "your-agent-id" });

// 搜索知识网络
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

// 零配置：自动读取 `kweaver auth login` 保存的凭据
const client = new KWeaverClient();

// 或显式传入凭据
const client = new KWeaverClient({
  baseUrl: "https://your-kweaver-instance.com",
  accessToken: "your-token",
});

// 知识网络
const kns = await client.knowledgeNetworks.list({ limit: 10 });
const ots = await client.knowledgeNetworks.listObjectTypes("bkn-id");
const rts = await client.knowledgeNetworks.listRelationTypes("bkn-id");
const ats = await client.knowledgeNetworks.listActionTypes("bkn-id");

// Agent 对话（单次）
const reply = await client.agents.chat("agent-id", "你好");
console.log(reply.text, reply.conversationId);

// Agent 对话（流式）
await client.agents.stream("agent-id", "你好", {
  onTextDelta: (chunk) => process.stdout.write(chunk),
});

// BKN 引擎：实例查询、子图、Action 执行
const instances = await client.bkn.queryInstances("bkn-id", "ot-id", { limit: 20 });
const graph     = await client.bkn.querySubgraph("bkn-id", { /* 路径规格 */ });
await client.bkn.executeAction("bkn-id", "at-id", { /* 参数 */ });
const logs      = await client.bkn.listActionLogs("bkn-id");

// Context Loader（通过 MCP 对 BKN 做语义搜索）
const cl      = client.contextLoader(mcpUrl, "bkn-id");
const results = await cl.search({ query: "高血压 治疗" });
```

## 命令速查

```
kweaver auth login/status/list/use/delete/logout
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
kweaver call <path> [-X METHOD] [-d BODY] [-H header]
```

## 环境变量

| 变量 | 说明 |
|---|---|
| `KWEAVER_BASE_URL` | KWeaver 实例地址 |
| `KWEAVER_BUSINESS_DOMAIN` | 业务域标识 |
| `KWEAVER_TOKEN` | 访问令牌 |

## 在 AI 智能体中使用

为 Claude Code、Cursor 等 AI 编程助手安装 KWeaver 技能：

```bash
npx skills add kweaver-ai/kweaver-sdk --skill kweaver-core
```

## 相关链接

- [GitHub](https://github.com/kweaver-ai/kweaver-sdk)
- [Python SDK on PyPI](https://pypi.org/project/kweaver-sdk/)

## 许可证

MIT
