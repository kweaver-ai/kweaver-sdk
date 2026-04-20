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

两者同时设置时，即使未执行 `auth login`，业务命令也会使用该 token。若 **`~/.kweaver/` 无当前平台**，仍可使用 **`kweaver auth status`**、**`kweaver auth whoami`**（支持 `--json`）、**`kweaver config show`**：CLI 会在本地解 JWT 展示身份；若 token 为 opaque，则省略身份字段并给出简短提示。

### 业务域（平台配置）

在调用依赖租户范围的接口前，应先确认业务域；DIP 环境通常使用 **UUID**，不能长期只依赖默认 `bd_public`。

```bash
kweaver config show
kweaver config list-bd
kweaver config set-bd <uuid>
```

`kweaver auth login` 成功后，若尚未配置，CLI 可能自动选择业务域。也可用环境变量 `KWEAVER_BUSINESS_DOMAIN` 或各命令的 `-bd` / `--biz-domain` 覆盖。详见 [`../../skills/kweaver-core/references/config.md`](../../skills/kweaver-core/references/config.md)。

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

// Vega — 可观测性与查询
const catalogs = await client.vega.listCatalogs();
const health   = await client.vega.health();
// 结构化查询 — POST /api/vega-backend/v1/query/execute（body 为 JSON 字符串）
const structured = await client.vega.executeQuery(
  JSON.stringify({ tables: [{ resource_id: "res-1" }], output_fields: ["*"], limit: 20 }),
);
// 直连 SQL 或 OpenSearch DSL — POST /api/vega-backend/v1/resources/query
// 使用 {{resource_id}} 占位符以路由到正确的 catalog connector
const rows = await client.vega.sqlQuery(
  JSON.stringify({ query: "SELECT * FROM {{res-1}} LIMIT 5", resource_type: "mysql" }),
);

// Context Loader（通过 MCP 对 BKN 做语义搜索）
const cl      = client.contextLoader(mcpUrl, "bkn-id");
const results = await cl.search({ query: "高血压 治疗" });

// Skill（注册表/市场/渐进式读取）
const skills = await client.skills.market({ name: "kweaver" });
const skillMd = await client.skills.fetchContent("skill-id");
```

## 命令速查

```
kweaver auth login <url> [--alias name] [--no-auth] [--no-browser] [-u user] [-p pass] [--new-password <pwd>] [--http-signin] [--insecure|-k]
# -u/-p（无论是否带 --http-signin）：HTTP POST /oauth2/signin（可拿 refresh_token）；缺失的用户名/密码会从 stdin 提示输入（TTY 下密码隐藏）
# 若服务端返回 401001017（初始密码），交互终端会引导修改；非交互请使用 --new-password <pwd>。
kweaver auth change-password [<url>] -u <account> [-o <old>] [-n <new>] [--insecure|-k]
kweaver auth login <url> --client-id ID --client-secret S --refresh-token T   (无浏览器登录)
kweaver auth export [url|alias] [--json]   (导出在无浏览器机器上运行的命令)
kweaver auth status / whoami [url|alias] [--json]   # whoami 支持 --json；无 ~/.kweaver/ 当前平台时可配 KWEAVER_BASE_URL+KWEAVER_TOKEN
kweaver auth list/use/delete/logout
kweaver config show / list-bd / set-bd <value>   # 业务域；show/list-bd 在无已保存平台时可与 env 配对
kweaver token
kweaver ds list/get/delete/tables/connect
kweaver dataflow list/run/runs/logs
kweaver dataview list/find/get/query/delete
kweaver bkn list/get/stats/export/create/update/delete
kweaver bkn object-type list/get/create/update/delete/query/properties
kweaver bkn relation-type list/get/create/update/delete
kweaver bkn action-type list/query/execute
kweaver bkn subgraph
kweaver bkn action-execution get
kweaver bkn action-log list/get/cancel
kweaver agent list/get/chat/sessions/history
kweaver skill list/market/get/register/status/delete/content/read-file/download/install
kweaver vega health|stats|inspect|sql|catalog|resource|connector-type
kweaver context-loader config set/use/list/show
kweaver context-loader kn-search/query-object-instance/...
kweaver call <path> [-X METHOD] [-d BODY] [-H header]
```

### Dataflow CLI 示例

```bash
kweaver dataflow list
kweaver dataflow run <dagId> --file ./demo.pdf
kweaver dataflow run <dagId> --url https://example.com/demo.pdf --name demo.pdf
kweaver dataflow runs <dagId>
kweaver dataflow runs <dagId> --since 2026-04-01
kweaver dataflow logs <dagId> <instanceId>
kweaver dataflow logs <dagId> <instanceId> --detail
```

`kweaver dataflow runs --since` 会按本地自然日过滤；如果参数无法被 `new Date(...)` 解析，CLI 会回退到最近 20 条运行记录。`kweaver dataflow logs` 默认输出摘要；加上 `--detail` 会打印带缩进的 `input` 和 `output` 载荷。

### Vega `sql` CLI 示例

对 Catalog 资源执行直连 SQL（`POST /api/vega-backend/v1/resources/query`）。SQL 中使用 **`{{<resource_id>}}`** 或 **`{{.<resource_id>}}`**（资源 id 来自 `vega resource list` / `get`），后端据此解析物理表与 connector。`--resource-type` 为目标数据源的连接器类型，可通过 `kweaver vega connector-type list` 查看。简单模式下请**用引号包住整个 `--query` 参数**，避免 shell 对花括号做特殊处理。

```bash
# 简单模式（推荐）：避免在 JSON 里转义整段 SQL
kweaver vega sql --resource-type mysql --query "SELECT * FROM {{res-1}} LIMIT 5"

# 高级模式：完整 JSON（可带 query_timeout、stream_size，或 OpenSearch DSL 对象等）
kweaver vega sql -d '{"resource_type":"mysql","query":"SELECT * FROM {{res-1}} LIMIT 5"}'
```

若同时提供 `-d` 与 `--query` / `--resource-type`，**仅以 `-d` 为准**。

**无 OAuth 的平台：** 使用 `kweaver auth <url> --no-auth`，或照常 `auth login`；若 `POST /oauth2/clients` 返回 **404**，CLI 会提示并自动保存为 no-auth。凭据仍在 `~/.kweaver/`，可用 `auth use` / `auth list` 切换。可选环境变量 `KWEAVER_NO_AUTH=1`（未设置 `KWEAVER_TOKEN` 时）配合 `KWEAVER_BASE_URL`。SDK：`new KWeaverClient({ baseUrl, auth: false })` 或 `kweaver.configure({ baseUrl, auth: false })`。

## 环境变量

| 变量 | 说明 |
|---|---|
| `KWEAVER_BASE_URL` | KWeaver 实例地址 |
| `KWEAVER_BUSINESS_DOMAIN` | 业务域标识 |
| `KWEAVER_TOKEN` | 访问令牌 |
| `KWEAVER_NO_AUTH` | 设为 `1`/`true`/`yes` 且未设置 `KWEAVER_TOKEN` 时使用 no-auth 占位（需 `KWEAVER_BASE_URL` 或已选平台） |
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

### 无浏览器 / 服务器端认证

适用于 SSH 远程服务器、CI 环境等无浏览器场景：

**第一步 — 有浏览器的机器：** 正常运行 `kweaver auth login`。登录成功后，回调页面会显示一条可复制的命令（含 `--client-id`、`--client-secret`、`--refresh-token`）。也可以用 `kweaver auth export` 查看。

**第二步 — 在没有浏览器的那台机器上：** 在 SSH 服务器、CI 等环境中执行下面这条命令：

```bash
kweaver auth login https://your-platform \
  --client-id abc123 \
  --client-secret def456 \
  --refresh-token ghi789
```

SDK 会用 refresh token 换取新的 access token 并保存到本地，之后自动续期正常工作。

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
