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

With both set, API commands use that token even if you never ran `auth login`. You can also run **`kweaver auth status`**, **`kweaver auth whoami`** (supports `--json`), and **`kweaver config show`** when there is **no** current platform in `~/.kweaver/`. In env-token mode, `whoami` resolves the bound identity from EACP `/api/eacp/v1/user/get` and prints `Type` (user/app), `User ID`, `Account` and `Name`; this works for both opaque and JWT tokens. If EACP is unreachable, the CLI falls back to local JWT decode and prints a short hint when the token is opaque.

`kweaver config list-bd` lists business domains for the current user. App (service) tokens are not bound to an end-user — when the backend rejects the call with `401 invalid user_id`, the CLI re-checks the token type via EACP and, if confirmed `type:"app"`, replaces the cryptic backend body with `This command does not support app accounts.`. Use a user token (interactive `auth login`) for user-bound endpoints.

### Business domain (platform)

Set or verify **before** calling list/query APIs that scope by tenant. DIP deployments often need a UUID, not only `bd_public`.

```bash
kweaver config show
kweaver config list-bd
kweaver config set-bd <uuid>
```

After `kweaver auth login`, the CLI may auto-select a domain when none is saved yet. Override with `KWEAVER_BUSINESS_DOMAIN` or `-bd` / `--biz-domain` on commands. See [`../../skills/kweaver-core/references/config.md`](../../skills/kweaver-core/references/config.md).

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

// Data sources & data views
const dsList = await client.datasources.list();
const tables = await client.datasources.listTables("ds-id");
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

// Dataflow automation (CSV import pipeline, etc.)
const result = await client.dataflows.execute({
  title: "import", trigger_config: { operator: "manual" },
  steps: [{ id: "s1", title: "load", operator: "csv_import", parameters: {} }],
});

// Vega — observability and query
const catalogs = await client.vega.listCatalogs();
const health   = await client.vega.health();
// Structured query — POST /api/vega-backend/v1/query/execute (JSON string body)
const structured = await client.vega.executeQuery(
  JSON.stringify({ tables: [{ resource_id: "res-1" }], output_fields: ["*"], limit: 20 }),
);
// Direct SQL or OpenSearch DSL — POST /api/vega-backend/v1/resources/query
// Use {{resource_id}} placeholders so vega-backend routes to the correct catalog connector.
const rows = await client.vega.sqlQuery(
  JSON.stringify({ query: "SELECT * FROM {{res-1}} LIMIT 5", resource_type: "mysql" }),
);

// Context Loader (MCP search_schema plus generic tools/call)
const cl      = client.contextLoader(mcpUrl, "bkn-id");
const schema  = await cl.searchSchema({ query: "hypertension treatment" });
const rawTool = await cl.callTool("search_schema", { query: "hypertension treatment" });

// Skills (registry + market + progressive read)
const skills = await client.skills.market({ name: "kweaver" });
const skillMd = await client.skills.fetchContent("skill-id");
```

`searchSchema()` is the typed wrapper for the Context Loader MCP `search_schema` tool. It defaults `response_format` to `json` and accepts `query`, `response_format`, `search_scope`, `max_concepts`, `schema_brief`, and `enable_rerank`. The parsed response may contain `object_types`, `relation_types`, `action_types`, and `metric_types`.

Use `callTool(name, args)` when you need native MCP `tools/call` access for newly added server tools before the SDK adds a typed wrapper. Arguments are passed through unchanged.

## CLI Reference

```
kweaver auth login <url> [--alias name] [--no-auth] [--no-browser] [-u user] [-p pass] [--new-password <pwd>] [--http-signin] [--insecure|-k]
# -u/-p (with or without --http-signin): HTTP POST /oauth2/signin (yields refresh_token). Missing -u/-p are prompted from stdin (password hidden when TTY).
# If the server returns error 401001017 (initial password), TTY users get a prompt to set a new password; non-interactive scripts must pass --new-password <pwd>.
kweaver auth change-password [<url>] [-u <account>] [-o <old>] [-n <new>] [--insecure|-k]
# EACP POST /api/eacp/v1/auth1/modifypassword — no OAuth token required. Omit -o/-n on a TTY to be prompted.
kweaver auth login <url> --client-id ID --client-secret S --refresh-token T   (headless login)
kweaver auth export [url|alias] [--json]   (export command to run on a headless host)
kweaver auth status / whoami [url|alias] [--json]   # whoami: --json; with KWEAVER_BASE_URL+KWEAVER_TOKEN when no ~/.kweaver/ platform
kweaver auth list/use/delete/logout
kweaver config show / list-bd / set-bd <value>   # platform business domain — show/list-bd work with KWEAVER_BASE_URL (+ KWEAVER_TOKEN for list-bd)
kweaver token
kweaver ds list/get/delete/tables/connect
kweaver ds import-csv <ds_id> --files <glob> [--table-prefix <p>] [--batch-size 500] [--recreate]
kweaver dataflow list/run/runs/logs
kweaver dataview list/find/get/query/delete
kweaver bkn list/get/stats/export/create/update/delete
kweaver bkn create-from-ds <ds_id> --name <name> [--tables t1,t2] [--build]
kweaver bkn create-from-csv <ds_id> --files <glob> --name <name> [--build]
kweaver bkn validate/push/pull
kweaver bkn object-type list/get/create/update/delete/query/properties
kweaver bkn relation-type list/get/create/update/delete
kweaver bkn action-type list/query/execute
kweaver bkn subgraph / search
kweaver bkn action-execution get
kweaver bkn action-log list/get/cancel
kweaver agent list/get/create/update/delete/chat/sessions/history/publish/unpublish
kweaver skill list/market/get/register/status/delete/content/read-file/download/install
kweaver vega health/stats/inspect/sql/catalog/resource/connector-type
kweaver context-loader config set/use/list/show
kweaver context-loader search-schema/tool-call/kn-search/query-object-instance/find-skills/...
kweaver toolbox create/list/publish/unpublish/delete
kweaver tool upload/list/enable/disable
kweaver call <path> [-X METHOD] [-d BODY] [-H header] [-F key=value]
```

### Dataflow CLI examples

```bash
kweaver dataflow list
kweaver dataflow run <dagId> --file ./demo.pdf
kweaver dataflow run <dagId> --url https://example.com/demo.pdf --name demo.pdf
kweaver dataflow runs <dagId>
kweaver dataflow runs <dagId> --since 2026-04-01
kweaver dataflow logs <dagId> <instanceId>
kweaver dataflow logs <dagId> <instanceId> --detail
```

`kweaver dataflow runs --since` filters one local natural day. If the value cannot be parsed by `new Date(...)`, the CLI falls back to the most recent 20 runs. `kweaver dataflow logs` defaults to summary output; add `--detail` to print indented `input` and `output` payloads.

### Vega `sql` CLI examples

Direct SQL against catalog-backed resources (`POST /api/vega-backend/v1/resources/query`). In SQL, use **`{{<resource_id>}}`** or **`{{.<resource_id>}}`** (Vega resource id from `vega resource list` / `get`) so the backend resolves the physical table and connector. `--resource-type` accepts the connector type of the target data source (run `kweaver vega connector-type list` to see available types). In simple mode, **quote the entire `--query` value** so the shell does not treat `{` / `}` specially.

```bash
# Simple mode (recommended): avoid JSON-escaping the query string
kweaver vega sql --resource-type mysql --query "SELECT * FROM {{res-1}} LIMIT 5"

# Advanced mode: full JSON body (optional fields like query_timeout, stream_size, OpenSearch DSL object)
kweaver vega sql -d '{"resource_type":"mysql","query":"SELECT * FROM {{res-1}} LIMIT 5"}'
```

If both `-d` and `--query` / `--resource-type` are present, **only `-d` is used**.

### Register an Agent toolbox

```bash
# 1. Create a toolbox pointing at your service
kweaver toolbox create \
  --name my_actions \
  --service-url http://my-svc:8080 \
  --description "Demo action backend"
# → {"box_id":"<BOX_ID>"}

# 2. Upload an OpenAPI spec as a tool
kweaver tool upload --toolbox <BOX_ID> ./openapi.json
# → {"success_ids":["<TOOL_ID>"]}

# 3. Publish the toolbox and enable the tool
kweaver toolbox publish <BOX_ID>
kweaver tool enable --toolbox <BOX_ID> <TOOL_ID>
```

**No-auth platforms:** If OAuth is not enabled, use `kweaver auth <url> --no-auth` (or run a normal `auth login`; a **404** on `POST /oauth2/clients` switches to no-auth automatically). Credentials are still saved under `~/.kweaver/` and work with `auth use` / `auth list`. Optional: `KWEAVER_NO_AUTH=1` with `KWEAVER_BASE_URL` when no token env is set. SDK: `new KWeaverClient({ baseUrl, auth: false })` or `kweaver.configure({ baseUrl, auth: false })`.

## Environment Variables

| Variable | Description |
|---|---|
| `KWEAVER_BASE_URL` | KWeaver instance URL |
| `KWEAVER_BUSINESS_DOMAIN` | Business domain identifier |
| `KWEAVER_TOKEN` | Access token |
| `KWEAVER_NO_AUTH` | Set to `1`/`true`/`yes` to use no-auth sentinel when `KWEAVER_TOKEN` is unset (with `KWEAVER_BASE_URL` or active platform) |
| `KWEAVER_TLS_INSECURE` | Set to `1` or `true` to skip TLS certificate verification for all HTTPS in the process (dev only; prefer `kweaver auth … --insecure` which saves per platform) |
| `NODE_TLS_REJECT_UNAUTHORIZED` | Node.js built-in TLS switch: set to `0` to skip certificate verification for HTTPS in this process. The `kweaver` CLI sets this when `KWEAVER_TLS_INSECURE` is set or the saved token has insecure TLS (same scope as above; dev only). |

### TLS Certificate Troubleshooting

If you encounter errors like `fetch failed`, `self-signed certificate`, or `UNABLE_TO_GET_ISSUER_CERT`, the target server likely uses a self-signed certificate or Kubernetes Ingress default fake certificate. Try the following in order of preference:

1. **Recommended (persists per platform)** — add `--insecure` during login:
   ```bash
   kweaver auth login https://your-host --insecure
   # or shorthand
   kweaver auth login https://your-host -k
   ```
   The flag is saved to `token.json` in `~/.kweaver/`, so all subsequent CLI commands for that platform skip TLS verification automatically.

2. **Temporary (current shell)** — set an environment variable:
   ```bash
   export KWEAVER_TLS_INSECURE=1
   kweaver bkn list
   ```

3. **Node.js native** — set `NODE_TLS_REJECT_UNAUTHORIZED` directly:
   ```bash
   NODE_TLS_REJECT_UNAUTHORIZED=0 kweaver bkn list
   ```

> **Security note:** All of the above disable HTTPS certificate verification and should only be used in development or internal network environments. Use trusted CA-signed certificates in production.

### Headless / Server Authentication

For servers or CI environments without a browser, log in on any machine that has one, then transfer credentials:

**Step 1 — Browser machine:** Run `kweaver auth login` as usual. The callback page displays a ready-to-copy command with `--client-id`, `--client-secret`, and `--refresh-token`. Alternatively, run `kweaver auth export` to print the same command.

**Step 2 — On the machine without a browser:** Run the pasted command there (SSH server, CI, etc.):

```bash
kweaver auth login https://your-platform \
  --client-id abc123 \
  --client-secret def456 \
  --refresh-token ghi789
```

The SDK exchanges the refresh token for a new access token and saves it locally. Auto-refresh works normally from that point on.

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
