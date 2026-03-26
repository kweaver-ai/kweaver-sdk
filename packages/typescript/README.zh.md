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

// 数据源与数据视图
const dsList = await client.datasources.list();
const viewId = await client.dataviews.create({ name: "v", datasourceId: "ds-id", table: "orders" });
const views = await client.dataviews.list({ datasourceId: "ds-id" });
const fuzzy = await client.dataviews.find("BOM", { wait: false });
const exact = await client.dataviews.find("orders", {
  datasourceId: "ds-id",
  exact: true,
  wait: true,
});
const dv = await client.dataviews.get(viewId);
const queryRows = await client.dataviews.query(viewId, {
  sql: "SELECT id, name FROM orders LIMIT 10",
  limit: 10,
  needTotal: true,
});

// Context Loader（通过 MCP 对 BKN 做语义搜索）
const cl      = client.contextLoader(mcpUrl, "bkn-id");
const results = await cl.search({ query: "高血压 治疗" });
```

## 命令速查

```
kweaver auth login <url> [--alias name] [-u user] [-p pass] [--playwright] [--insecure|-k] — 另有 status、list、use、delete、logout
kweaver token
kweaver ds list/get/delete/tables/connect
kweaver dataview list/find/get/query/delete
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
| `KWEAVER_TLS_INSECURE` | 设为 `1` 或 `true` 时跳过 TLS 证书校验（仅开发；更推荐 `kweaver auth … --insecure` 以按平台持久化） |
| `NODE_TLS_REJECT_UNAUTHORIZED` | Node.js 内置 TLS 开关：设为 `0` 时在本进程内跳过 HTTPS 证书校验。`kweaver` 在 `KWEAVER_TLS_INSECURE` 生效或已保存 token 为不安全 TLS 时会设置此项（范围同上；仅开发）。 |

### TLS 证书问题排查

如果遇到 `fetch failed`、`self-signed certificate`、`UNABLE_TO_GET_ISSUER_CERT` 等 TLS 相关错误，通常是目标服务器使用了自签名证书或 Kubernetes Ingress 默认假证书。可按优先级尝试以下方案：

1. **推荐（按平台持久化）** — 登录时加 `--insecure`：
   ```bash
   kweaver auth login https://your-host --insecure
   # 或简写
   kweaver auth login https://your-host -k
   ```
   该标记会写入 `~/.kweaver/` 的 `token.json`，后续所有 CLI 命令对该平台自动生效，无需额外操作。

2. **临时生效（当前 shell）** — 设置环境变量：
   ```bash
   export KWEAVER_TLS_INSECURE=1
   kweaver bkn list
   ```

3. **Node.js 原生方式** — 直接设置 `NODE_TLS_REJECT_UNAUTHORIZED`：
   ```bash
   NODE_TLS_REJECT_UNAUTHORIZED=0 kweaver bkn list
   ```

> **安全提示：** 以上方式均会跳过 HTTPS 证书校验，仅适用于开发/内网环境。生产环境请使用受信任的 CA 签发证书。

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
