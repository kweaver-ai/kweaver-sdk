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

Both CLIs share the same command structure (`kweaver auth`, `kweaver bkn`, `kweaver agent`, `kweaver skill`, `kweaver context-loader`, …) and credentials stored in `~/.kweaver/`.

## Authentication

```bash
kweaver auth login https://your-kweaver-instance.com
kweaver auth login https://your-kweaver-instance.com --alias prod
```

Or use environment variables: `KWEAVER_BASE_URL`, `KWEAVER_BUSINESS_DOMAIN`, `KWEAVER_TOKEN`. With saved `~/.kweaver/` sessions from OAuth2 browser login, **the default is to exchange `refresh_token` for a new access token** when the access token expires (no extra flags). For TLS in the Node `kweaver` CLI, see `KWEAVER_TLS_INSECURE` and `NODE_TLS_REJECT_UNAUTHORIZED` in the [TypeScript README](packages/typescript/README.md#environment-variables).

### Headless hosts (SSH, CI, containers — no browser)

The **npm `kweaver` CLI** supports logging in on a machine that cannot open a browser:

1. On any machine **with** a browser, run `kweaver auth login https://your-instance`. After success, the local callback page shows a one-line command you can copy (or run `kweaver auth export` / `kweaver auth export --json`).
2. On the **headless** machine, run that command — it uses `--client-id`, `--client-secret`, and `--refresh-token` to exchange for tokens and save `~/.kweaver/` as usual.

Details: [`packages/typescript/README.md`](packages/typescript/README.md) (section **Headless / Server Authentication**). The Python `kweaver` CLI still uses interactive browser login; you can reuse the same `~/.kweaver/` directory copied from a machine where the Node CLI completed login.

## Platform configuration (business domain)

Most API calls send `x-business-domain`. **Set or verify this right after login** — wrong or default-only `bd_public` often explains empty lists on DIP-style deployments.

```bash
kweaver config show              # current platform + resolved business domain
kweaver config list-bd         # list domains from the platform (needs login)
kweaver config set-bd <uuid>   # persist default for this platform
```

Priority: `KWEAVER_BUSINESS_DOMAIN` env → per-platform `~/.kweaver/.../config.json` → `bd_public`. After a successful `kweaver auth login`, the CLI tries to auto-pick a domain (prefer `bd_public` in the list, else the first entry) when nothing is configured yet.

See [`skills/kweaver-core/references/config.md`](skills/kweaver-core/references/config.md).

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

// Data sources & data views
const dsList = await client.datasources.list();
const tables = await client.datasources.listTables("ds-id");
const viewId = await client.dataviews.create({ name: "v", datasourceId: "ds-id", table: "orders" });

// Dataflow automation (CSV import pipeline, etc.)
const result = await client.dataflows.execute({
  title: "import", trigger_config: { operator: "manual" },
  steps: [{ id: "s1", title: "load", operator: "csv_import", parameters: {} }],
});

// Vega observability
const catalogs = await client.vega.listCatalogs();

// Context Loader (semantic search over a knowledge network)
const cl      = client.contextLoader(mcpUrl, "bkn-id");
const results = await cl.search({ query: "hypertension treatment" });
```

## Python SDK Usage

### Pure Python authentication

You can sign in from Python alone; tokens land in `~/.kweaver/` just like the CLIs:

- **HTTP sign-in** (RSA-encrypted password, aligned with `kweaver auth login --http-signin`): `kweaver.login("https://…", username="…", password="…")`. Use `new_password=` when the server requires an initial password change (`401001017`).
- **Refresh token**: `kweaver.login("https://…", refresh_token="…", client_id="…", client_secret="…")`.
- **No-auth hosts**: `kweaver.login("https://…", no_auth=True)`.
- **Browser OAuth**: `kweaver.login("https://…")` opens a browser; `open_browser=False` matches the headless paste flow.

Helpers such as `http_signin`, `whoami`, and `list_platforms` live in `kweaver.auth`. For lazy sign-in on first API call, use `kweaver.configure(..., username=…, password=…)` or `HttpSigninAuth`.

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

# Dataflow automation
from kweaver.resources.dataflows import DataflowStep
result = client.dataflows.execute(
    title="import", steps=[DataflowStep(id="s1", title="load", operator="csv_import")],
)
```

## CLI Quick Reference

```bash
kweaver auth login <url> [--alias name] [--no-browser] [-u user] [-p pass] [--new-password <pwd>] [--http-signin] [--insecure|-k]
# -u/-p (with or without --http-signin): HTTP POST /oauth2/signin (yields refresh_token). Missing -u/-p are prompted from stdin (password hidden on TTY).
# Initial-password lockout (401001017): TTY prompts to change password; scripts use --new-password <pwd>.
kweaver auth change-password [<url>] [-u <account>] [-o <old>] [-n <new>] [--insecure|-k]
kweaver auth login <url> --client-id ID --client-secret S --refresh-token T   (headless host)
kweaver auth export [url|alias] [--json]
kweaver auth status / whoami [url|alias] [--json]   # with KWEAVER_BASE_URL+KWEAVER_TOKEN when no ~/.kweaver/ platform
kweaver auth list/use/delete/logout
kweaver config show / list-bd / set-bd <value>   # business domain; show/list-bd work with KWEAVER_BASE_URL (+ KWEAVER_TOKEN for list-bd)
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
kweaver agent list/get/create/update/delete/chat/sessions/history/publish/unpublish
kweaver skill list/market/get/register/status/delete/content/read-file/download/install
kweaver vega health/stats/inspect/sql/catalog/resource/connector-type
kweaver context-loader config set/use/list/show
kweaver context-loader search-schema/tool-call/kn-search/query-object-instance/find-skills/...
kweaver call <path> [-X METHOD] [-d BODY] [-H header] [-bd domain]
```

The two CLIs use different top-level command names for some features. The table below maps **Python CLI** (`pip install kweaver-sdk[cli]`) to **TypeScript CLI** (`npm install -g @kweaver-ai/kweaver-sdk`).

| Python CLI | TypeScript CLI |
|------------|----------------|
| `kweaver query search <kn_id> <query>` | `kweaver bkn search <kn-id> <query>` |
| `kweaver query instances <kn_id> <ot_id> …` | `kweaver bkn object-type query <kn-id> <ot-id> …` |
| `kweaver query subgraph <kn_id> …` (flags build the path) | `kweaver bkn subgraph <kn-id> <body-json>` (JSON body; shape differs) |
| `kweaver query kn-search <kn_id> <query>` (REST) | `kweaver context-loader kn-search <query>` (HTTP compatibility with configured KN), or `kweaver context-loader search-schema <query>` for MCP `search_schema` |
| `kweaver action query …` / `execute` / `logs` … | `kweaver bkn action-type query|execute …`, `kweaver bkn action-log list|get|…` |

**Only on TypeScript CLI:** `kweaver vega`, `kweaver dataview list|find|get|delete`, `kweaver ds import-csv`, `kweaver bkn create-from-csv`, and full `kweaver agent` create/update/delete/publish (see `kweaver agent --help`). Both CLIs support `kweaver config show|list-bd|set-bd` and `kweaver dataview query` (SQL via mdl-uniquery; Python requires `pip install kweaver-sdk[cli]`).

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
├── skills/kweaver-core/         # AI agent skill — KWeaver CLI (SKILL.md)
├── skills/create-bkn/           # AI agent skill — BKN authoring (SKILL.md)
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

Install [Agent Skills](https://skills.sh) with the [`skills` CLI](https://www.npmjs.com/package/skills) (`npx skills add`):

- **Multiple skills from this repo** — pass `--skill` more than once in a single `npx skills add` (see combined install below).
- **Skills from other repos** — run `npx skills add <other-repo-url>` separately for each repository.

```bash
# KWeaver CLI — auth, BKN/KN management, agents, Context Loader
npx skills add https://github.com/kweaver-ai/kweaver-sdk --skill kweaver-core

# BKN authoring — modular BKN v2.0.1 definitions (object/relation/action types, …)
npx skills add https://github.com/kweaver-ai/kweaver-sdk --skill create-bkn

# Install kweaver-core and create-bkn in one command
npx skills add https://github.com/kweaver-ai/kweaver-sdk \
  --skill kweaver-core --skill create-bkn
```

[![kweaver-core on skills.sh](https://img.shields.io/badge/skills.sh-kweaver--core-6366f1?style=flat-square)](https://skills.sh/kweaver-ai/kweaver-sdk)
[![create-bkn on skills.sh](https://img.shields.io/badge/skills.sh-create--bkn-6366f1?style=flat-square)](https://skills.sh/kweaver-ai/kweaver-sdk)

Before using **kweaver-core**, authenticate with your KWeaver instance:

```bash
npm install -g @kweaver-ai/kweaver-sdk
kweaver auth login https://your-kweaver-instance.com
```

- [skills/kweaver-core/SKILL.md](skills/kweaver-core/SKILL.md) — CLI workflows
- [skills/create-bkn/SKILL.md](skills/create-bkn/SKILL.md) — BKN file layout and references
