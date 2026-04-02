# AI 应用开发者接入指南

将 KWeaver 知识网络接入你的 AI 应用，为 LLM 提供领域知识检索、图谱查询和 Agent 对话能力。

## 你会用到的能力

| 能力 | 说明 | 典型场景 |
|------|------|---------|
| **语义搜索** | 用自然语言搜索知识网络中的概念和实例 | RAG 检索增强、知识问答 |
| **MCP 服务** | 标准 MCP 协议接入，AI 工具原生支持 | Claude Desktop、Cursor、Cline、自定义 Agent |
| **Agent 对话** | 与预配置的 AI Agent 交互，Agent 自动调用图谱能力 | 智能客服、分析助手、运维问答 |
| **图谱查询** | 按条件检索实例、沿关系遍历子图 | 风控关联分析、供应链溯源 |
| **Action 执行** | 触发知识网络上定义的可执行动作 | 自动化运维、数据更新 |

## 前置条件

- 一个运行中的 KWeaver 平台实例（如 `https://dip-poc.aishu.cn`）
- 平台上已创建并构建了至少一个知识网络（没有？找数据工程师，或参考 [数据工程师建图指南](./data-engineer-graph-building.md)）
- Node.js 22+（CLI 和 TypeScript SDK）或 Python 3.10+（Python SDK）

## 第一步：安装与认证

```bash
# 安装 CLI
npm install -g @kweaver-ai/kweaver-sdk

# 登录（浏览器会自动打开）
kweaver auth login https://your-kweaver-instance.com

# 设置业务域（DIP 部署必须设置，否则查不到数据）
kweaver config list-bd
kweaver config set-bd <your-bd-uuid>

# 验证
kweaver config show
```

> **无浏览器环境（SSH/CI）？** 在有浏览器的机器上执行 `kweaver auth export`，将输出的命令在目标机器上执行即可。详见 [README - Headless hosts](../../README.md#headless-hosts-ssh-ci-containers--no-browser)。

## 第二步：确认可用资源

```bash
# 查看知识网络
kweaver bkn list

# 查看某个知识网络的统计信息
kweaver bkn stats <kn-id>

# 查看可用 Agent
kweaver agent list
```

记下你需要的知识网络 ID（`kn-id`）和 Agent ID（`agent-id`），后续接入会用到。

## 接入方式一：MCP 协议（推荐给 AI IDE 和 Agent 框架）

MCP（Model Context Protocol）是 AI 工具访问外部数据的标准协议。Claude Desktop、Cursor、Cline 等工具原生支持。

### 获取 MCP 接入信息

```bash
# 配置 Context Loader（选择你的知识网络）
kweaver context-loader config set --kn-id <kn-id>

# 查看配置（包含 MCP URL 和 KN ID）
kweaver context-loader config show
```

输出示例：
```json
{
  "mcpUrl": "https://dip-poc.aishu.cn/api/agent-retrieval/v1/mcp",
  "knId": "d4rt3135s3q8va76m8fd"
}
```

### 接入 Claude Desktop

在 `~/Library/Application Support/Claude/claude_desktop_config.json` 中添加：

```json
{
  "mcpServers": {
    "kweaver": {
      "command": "kweaver",
      "args": ["context-loader", "mcp-serve"],
      "env": {}
    }
  }
}
```

重启 Claude Desktop 后，Claude 就能直接搜索你的知识网络。

### 接入 Cursor / Cline

配置原理相同 — 将 `kweaver context-loader mcp-serve` 作为 MCP server 命令。各工具的配置文件位置不同，请参考对应工具的 MCP 文档。

### 直接调用 MCP（curl 示例）

适用于自研 Agent 框架，直接通过 HTTP 调用 MCP 协议：

```bash
BASE="https://your-kweaver-instance.com"
MCP_URL="$BASE/api/agent-retrieval/v1/mcp"
TOKEN=$(kweaver token)
KN_ID="your-kn-id"

# Step 1: initialize — 获取 session id
SESSION_ID=$(curl -s -D - "$MCP_URL" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -H "X-Kn-ID: $KN_ID" \
  -H "MCP-Protocol-Version: 2024-11-05" \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{
    "protocolVersion":"2024-11-05",
    "capabilities":{},
    "clientInfo":{"name":"my-app","version":"1.0"}
  }}' | grep -i 'mcp-session-id' | awk '{print $2}' | tr -d '\r')

# Step 2: initialized 通知
curl -s "$MCP_URL" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -H "X-Kn-ID: $KN_ID" \
  -H "MCP-Protocol-Version: 2024-11-05" \
  -H "MCP-Session-Id: $SESSION_ID" \
  -d '{"jsonrpc":"2.0","method":"notifications/initialized"}'

# Step 3: 调用工具（示例：语义搜索）
curl -s "$MCP_URL" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -H "X-Kn-ID: $KN_ID" \
  -H "MCP-Protocol-Version: 2024-11-05" \
  -H "MCP-Session-Id: $SESSION_ID" \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{
    "name":"kn_search",
    "arguments":{"query":"你的查询内容"}
  }}' | jq .
```

> **Token 获取**：`kweaver token` 会自动刷新并输出当前有效的 access token（1 小时有效期，自动续期）。

## 接入方式二：SDK 集成（推荐给自研应用）

### TypeScript

```typescript
import { KWeaverClient } from "@kweaver-ai/kweaver-sdk";

const client = new KWeaverClient(); // 自动读取 ~/.kweaver/ 凭证

// 语义搜索
const cl = client.contextLoader(
  "https://your-instance.com/api/agent-retrieval/v1/mcp",
  "your-kn-id"
);
const results = await cl.search({ query: "高血压治疗方案" });

// Agent 对话（单次）
const reply = await client.agents.chat("agent-id", "总结高血压的主要风险");
console.log(reply.text);

// Agent 对话（流式）
await client.agents.stream("agent-id", "详细说明", {
  onTextDelta: (text) => process.stdout.write(text),
});

// 图谱实例查询
const instances = await client.bkn.queryInstances("kn-id", "ot-id", {
  limit: 10,
  condition: {
    operation: "and",
    sub_conditions: [
      { field: "name", operation: "like", value_from: "const", value: "%高血压%" }
    ]
  }
});

// 子图遍历
const subgraph = await client.bkn.querySubgraph("kn-id", {
  relation_type_paths: [{
    relation_types: [{
      relation_type_id: "rt-id",
      source_object_type_id: "ot-source",
      target_object_type_id: "ot-target",
    }],
  }],
  limit: 20,
});
```

### Python

```python
from kweaver import KWeaverClient, ConfigAuth

client = KWeaverClient(auth=ConfigAuth())  # 自动读取 ~/.kweaver/ 凭证

# Agent 对话
msg = client.conversations.send_message("", "总结高血压的主要风险", agent_id="agent-id")
print(msg.content)

# 实例查询
instances = client.query.instances("kn-id", "ot-id", limit=10)
```

### Simple API（更简洁的封装）

如果只需要搜索和对话，Simple API 更方便：

```typescript
import kweaver from "@kweaver-ai/kweaver-sdk/kweaver";

kweaver.configure({ config: true, bknId: "your-kn-id", agentId: "your-agent-id" });

// 搜索
const results = await kweaver.search("供应链风险");

// 对话
const reply = await kweaver.chat("总结 top 3 风险");
console.log(reply.text);
```

## 接入方式三：CLI 快速验证

在写代码之前，先用 CLI 验证数据可用：

```bash
# 语义搜索
kweaver context-loader kn-search "高血压"

# 查看 schema
kweaver context-loader kn-search "高血压" --only-schema

# 查询实例
kweaver bkn object-type query <kn-id> <ot-id> --limit 5

# Agent 对话（交互式，支持流式输出）
kweaver agent chat <agent-id> --stream
```

## 常见问题

### 查不到数据 / 列表为空

1. **业务域未设置**：`kweaver config show` 确认 `businessDomain` 不是 `bd_public`（DIP 部署下）
2. **知识网络未构建**：`kweaver bkn stats <kn-id>` 检查是否有数据，未构建需执行 `kweaver bkn build <kn-id> --wait`
3. **Token 过期**：`kweaver auth status` 检查登录状态

### MCP 连接失败

1. 确认 URL 格式：`https://<host>/api/agent-retrieval/v1/mcp`
2. 确认 Token 有效：`kweaver token` 应输出一个 JWT
3. 确认 KN ID 正确：`kweaver bkn list` 核对

### Agent 对话无响应

1. 确认 Agent 已发布：`kweaver agent list` 中应可见
2. 确认 Agent 关联了知识网络且已构建

## 更多资源

- [SDK 代码示例](../../examples/sdk/) — 6 个渐进式 TypeScript 示例
- [Context Loader 命令参考](../../skills/kweaver-core/references/context-loader.md) — MCP 协议完整命令
- [BKN 命令参考](../../skills/kweaver-core/references/bkn.md) — 图谱查询完整参数
- [Agent 命令参考](../../skills/kweaver-core/references/agent.md) — Agent 对话与管理
