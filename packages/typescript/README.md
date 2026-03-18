# @kweaver-ai/kweaver-sdk

TypeScript SDK and CLI for [KWeaver](https://github.com/kweaver-ai/kweaver-sdk) — gives AI agents and applications programmatic access to knowledge networks and Decision Agents.

[中文文档](README.zh.md)

## Installation

```bash
# CLI (global)
npm install -g @kweaver-ai/kweaver-sdk

# Library
npm install @kweaver-ai/kweaver-sdk
```

Requires **Node.js >= 22**.

## Quick Start

### Authenticate

```bash
kweaver auth login https://your-kweaver-instance.com
```

Or use environment variables:

```bash
export KWEAVER_BASE_URL=https://your-kweaver-instance.com
export KWEAVER_TOKEN=your-token
```

### Simple API (recommended)

```typescript
import kweaver from "@kweaver-ai/kweaver-sdk/kweaver";

// Zero-config: reads credentials saved by `kweaver auth login`
kweaver.configure({ config: true, bknId: "your-bkn-id", agentId: "your-agent-id" });

// Search the knowledge network
const results = await kweaver.search("What risks exist in the supply chain?");
for (const concept of results.concepts) console.log(concept.concept_name);

// Chat with an agent
const reply = await kweaver.chat("Summarise the top 3 risks");
console.log(reply.text);

// After modifying object types or adding datasources, rebuild the BKN index
await kweaver.weaver({ wait: true });

// List available BKNs and agents
const bknList   = await kweaver.bkns();
const agentList = await kweaver.agents();
```

### Full Client API (advanced)

```typescript
import { KWeaverClient } from "@kweaver-ai/kweaver-sdk";

// Zero-config: reads credentials saved by `kweaver auth login`
const client = new KWeaverClient();

// Or pass credentials explicitly
const client = new KWeaverClient({
  baseUrl: "https://your-kweaver-instance.com",
  accessToken: "your-token",
});

// Knowledge networks
const kns = await client.knowledgeNetworks.list({ limit: 10 });
const ots = await client.knowledgeNetworks.listObjectTypes("bkn-id");
const rts = await client.knowledgeNetworks.listRelationTypes("bkn-id");
const ats = await client.knowledgeNetworks.listActionTypes("bkn-id");

// Agent chat (single-shot)
const reply = await client.agents.chat("agent-id", "Hello");
console.log(reply.text, reply.conversationId);

// Agent chat (streaming)
await client.agents.stream("agent-id", "Hello", {
  onTextDelta: (chunk) => process.stdout.write(chunk),
});

// BKN engine — instance queries, subgraph, action execution
const instances = await client.bkn.queryInstances("bkn-id", "ot-id", { limit: 20 });
const graph     = await client.bkn.querySubgraph("bkn-id", { /* path spec */ });
await client.bkn.executeAction("bkn-id", "at-id", { /* params */ });
const logs      = await client.bkn.listActionLogs("bkn-id");

// Context Loader (semantic search over a BKN via MCP)
const cl      = client.contextLoader(mcpUrl, "bkn-id");
const results = await cl.search({ query: "hypertension treatment" });
```

## CLI Reference

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

## Environment Variables

| Variable | Description |
|---|---|
| `KWEAVER_BASE_URL` | KWeaver instance URL |
| `KWEAVER_BUSINESS_DOMAIN` | Business domain identifier |
| `KWEAVER_TOKEN` | Access token |

## Using with AI Agents

Install the KWeaver skill for Claude Code, Cursor, or other AI coding agents:

```bash
npx skills add kweaver-ai/kweaver-sdk --skill kweaver-core
```

## Links

- [GitHub](https://github.com/kweaver-ai/kweaver-sdk)
- [Python SDK on PyPI](https://pypi.org/project/kweaver-sdk/)

## License

MIT
