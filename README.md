# KWeaver SDK

> Part of the [KWeaver](https://github.com/kweaver-ai/KWeaver) ecosystem — an open-source platform for building, managing, and querying knowledge networks.

Give AI agents (Claude Code, GPT, custom agents, etc.) access to KWeaver knowledge networks and Decision Agents via the `kweaver` CLI. Also provides Python and TypeScript SDKs for programmatic integration.

[中文文档](README.zh.md)

## Installation

### TypeScript CLI (recommended — includes interactive agent chat TUI)

```bash
npm install -g @kweaver-ai/kweaver-sdk
```

Requires Node.js 22+. After installation, use the `kweaver` command.

### TypeScript SDK (programmatic)

```bash
npm install @kweaver-ai/kweaver-sdk
```

```typescript
import { KWeaverClient } from "@kweaver-ai/kweaver-sdk";

// Zero-config: reads credentials saved by `kweaver auth login`
const client = new KWeaverClient();

// Or pass credentials explicitly
const client = new KWeaverClient({
  baseUrl: "https://your-kweaver.com",
  accessToken: "your-token",
});

const kns   = await client.knowledgeNetworks.list();
const reply = await client.agents.chat("agent-id", "Hello");
console.log(reply.text);
```

### Python CLI (alternative — for testing or Node-free environments)

```bash
pip install kweaver-sdk[cli]
```

Requires Python >= 3.10. After installation, use the same `kweaver` command.

### Python SDK (programmatic)

```bash
pip install kweaver-sdk
```

```python
import kweaver

kweaver.configure(config=True, bkn_id="your-bkn-id", agent_id="your-agent-id")

results = kweaver.search("What risks exist in the supply chain?")
reply   = kweaver.chat("Summarise the top 3 risks")
print(reply.content)
```

## Overview

| Entry point | Install | Purpose |
|-------------|---------|---------|
| **TS CLI** | `npm install -g @kweaver-ai/kweaver-sdk` | Primary CLI with Ink TUI and streaming agent chat |
| **TS SDK** | `npm install @kweaver-ai/kweaver-sdk` | Programmatic API — `import { KWeaverClient } from "@kweaver-ai/kweaver-sdk"` |
| **Python CLI** | `pip install kweaver-sdk[cli]` | Alternative CLI, feature-parity with TS CLI |
| **Python SDK** | `pip install kweaver-sdk` | Programmatic API — `from kweaver import KWeaverClient` |

Both CLIs share the same command structure (`kweaver auth`, `kweaver bkn`, `kweaver agent`, `kweaver context-loader`, …) and credentials stored in `~/.kweaver/`.

## Authentication

```bash
kweaver auth login https://your-kweaver-instance.com
kweaver auth login https://your-kweaver-instance.com --alias prod
```

Or use environment variables: `KWEAVER_BASE_URL`, `KWEAVER_BUSINESS_DOMAIN`, `KWEAVER_TOKEN`.

## TypeScript SDK Usage

### Simple API (recommended)

```typescript
import kweaver from "@kweaver-ai/kweaver-sdk/kweaver";

// Uses saved credentials from `kweaver auth login`
kweaver.configure({ config: true, bknId: "your-bkn-id", agentId: "your-agent-id" });

// Search the BKN
const results = await kweaver.search("What risks exist in the supply chain?");
for (const concept of results.concepts) console.log(concept.concept_name);

// Chat with an agent
const reply = await kweaver.chat("Summarise the top 3 risks");
console.log(reply.text);

// After adding datasources or modifying object types, rebuild the BKN index
await kweaver.weaver({ wait: true });

// List available BKNs and agents
const bknList   = await kweaver.bkns();
const agentList = await kweaver.agents();
```

### Full client API (advanced)

```typescript
import { KWeaverClient } from "@kweaver-ai/kweaver-sdk";

const client = new KWeaverClient();   // reads ~/.kweaver/ credentials

// Knowledge networks
const kns = await client.knowledgeNetworks.list({ limit: 10 });
const ots = await client.knowledgeNetworks.listObjectTypes("bkn-id");
const rts = await client.knowledgeNetworks.listRelationTypes("bkn-id");

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

// Context Loader (semantic search over a knowledge network)
const cl      = client.contextLoader(mcpUrl, "bkn-id");
const results = await cl.search({ query: "hypertension treatment" });
```

## Python SDK Usage

### Simple API (recommended)

```python
import kweaver

# Uses saved credentials from `kweaver auth login`
kweaver.configure(config=True, bkn_id="your-bkn-id", agent_id="your-agent-id")

# Search the BKN
results = kweaver.search("What risks exist in the supply chain?")
for concept in results.concepts:
    print(concept.concept_name)

# Chat with an agent
reply = kweaver.chat("Summarise the top 3 risks")
print(reply.content)

# After adding datasources or modifying object types, rebuild the BKN index
kweaver.weaver(wait=True)

# List available BKNs and agents
for bkn in kweaver.bkns():
    print(bkn.id, bkn.name)
```

### Full client API (advanced)

```python
from kweaver import KWeaverClient, ConfigAuth

client = KWeaverClient(auth=ConfigAuth())   # reads ~/.kweaver/ credentials

# BKNs
bkns = client.knowledge_networks.list()
ots  = client.object_types.list("bkn-id")

# Agent chat
msg = client.conversations.send_message("", "Hello", agent_id="agent-id")
print(msg.content)

# BKN engine — instance queries and action execution
instances = client.query.instances("bkn-id", "ot-id", limit=20)
result    = client.action_types.execute("bkn-id", "at-id", params={})
```

## CLI Quick Reference

```bash
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
kweaver call <path> [-X METHOD] [-d BODY] [-H header] [-bd domain]
```

Python CLI also provides: `kweaver ds` (data sources), `kweaver query` (semantic search, instances, subgraph), `kweaver action` (orchestration).

## Repository Structure (Monorepo)

```
kweaver-sdk/
├── packages/
│   ├── python/                  # Python SDK + CLI
│   │   ├── src/kweaver/
│   │   │   ├── _client.py       # KWeaverClient
│   │   │   ├── resources/       # knowledge_networks, agents, …
│   │   │   └── cli/             # kweaver commands
│   │   └── tests/
│   └── typescript/              # TypeScript SDK + CLI
│       ├── src/
│       │   ├── client.ts        # KWeaverClient
│       │   ├── resources/       # knowledge-networks, agents, bkn, …
│       │   ├── api/             # low-level HTTP functions
│       │   └── commands/        # CLI command implementations
│       └── test/
├── skills/kweaver-core/         # AI agent skill (SKILL.md)
├── docs/
├── README.md                    # English (this file)
└── README.zh.md                 # 中文
```

## Development & Testing

```bash
# Python
make -C packages/python test

# TypeScript
make -C packages/typescript test
```

## Using with AI Agents

```bash
npx skills add https://github.com/kweaver-ai/kweaver-sdk --skill kweaver-core
```

[![skills.sh](https://skills.sh/badge/kweaver-core)](https://skills.sh/kweaver-ai/kweaver-sdk)

Before using the skill, authenticate with your KWeaver instance:

```bash
npm install -g @kweaver-ai/kweaver-sdk
kweaver auth login https://your-kweaver-instance.com
```

See [skills/kweaver-core/SKILL.md](skills/kweaver-core/SKILL.md) for details.
