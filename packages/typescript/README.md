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

## API reference (TypeDoc)

Generate HTML from source + TSDoc, then open `docs/reference/typescript-api-html/index.html` (gitignored), or serve locally:

HTML reference auto-discovers **`src/resources/*`**, **`src/api/*`**, and **`src/auth/*`** via TypeDoc's `entryPointStrategy: "expand"` (`typedoc.json`), so newly added modules appear without editing the config. The English build uses `README.md` as the cover page; the Chinese build uses `README.zh.md`. **"Defined in"** GitHub links read `gitRevision` from `TYPEDOC_GIT_REVISION` → `GITHUB_SHA` → fallback `"main"`; CI should pin links to the build SHA: `TYPEDOC_GIT_REVISION=$GITHUB_SHA npm run docs`.

TypeDoc does **not** ship a single-site EN/ZH toggle. Use two outputs: English UI (default) and Chinese UI strings (`docs:zh`, primarily localizes navigation chrome). API descriptions come from TSDoc and stay English unless you maintain duplicate comments elsewhere.

```bash
cd packages/typescript
npm install
npm run docs             # English UI → docs/reference/typescript-api-html/
npm run docs:serve       # generate + serve http://127.0.0.1:8766
npm run docs:zh          # Chinese UI + README.zh.md → docs/reference/typescript-api-html-zh/
npm run docs:serve:zh    # generate + serve http://127.0.0.1:8767
npm run docs:all         # both folders
```

> Files inside `docs/reference/**` are generated. Edit `packages/typescript/README*.md` and TSDoc comments in source instead — anything copied into `media/` is overwritten on the next build.

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

With both set, API commands use that token even if you never ran `auth login`. The same applies to **`kweaver --base-url <url> --token <access-token> <command>`** (stateless flag mode; see [Stateless token mode](#stateless-token-mode)). You can also run **`kweaver auth status`**, **`kweaver auth whoami`** (supports `--json`), and **`kweaver config show`** when there is **no** current platform in `~/.kweaver/`. In env-token mode, `whoami` resolves the bound identity from EACP `/api/eacp/v1/user/get` and prints `Type` (user/app), `User ID`, `Account` and `Name`; this works for both opaque and JWT tokens. If EACP is unreachable, the CLI falls back to local JWT decode and prints a short hint when the token is opaque.

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

// Data sources & vega-backend resources
const dsList = await client.datasources.list();
const tables = await client.datasources.listTables("ds-id");
const resId  = await client.resources.create({ name: "v", datasourceId: "ds-id", table: "orders" });
const resList = await client.resources.list({ datasourceId: "ds-id" });
const fuzzy  = await client.resources.find("BOM", { wait: false });
const exact  = await client.resources.find("orders", {
  datasourceId: "ds-id",
  exact: true,
  wait: true,
});
const res       = await client.resources.get(resId);
const queryRows = await client.resources.query(resId, { limit: 10, needTotal: true });

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
const schema  = await cl.searchSchema({
  query: "hypertension treatment",
  search_scope: { concept_groups: ["clinical"] },
});
const rawTool = await cl.callTool("search_schema", { query: "hypertension treatment" });

// Skills (registry + market + progressive read)
const skills = await client.skills.market({ name: "kweaver" });
const skillMd = await client.skills.fetchContent("skill-id");
const draft = await client.skills.updateMetadata("skill-id", {
  name: "Demo",
  description: "Demo skill",
  category: "system",
});
const history = await client.skills.history("skill-id");
```

`searchSchema()` is the typed wrapper for the Context Loader MCP `search_schema` tool. It defaults `response_format` to `json` and accepts `query`, `response_format`, `search_scope`, `max_concepts`, `schema_brief`, and `enable_rerank`. `search_scope.concept_groups` limits schema discovery to BKN concept group IDs; it is not an instance-data filter. The parsed response may contain `object_types`, `relation_types`, `action_types`, and `metric_types`.

`client.bkn.knSearch(...)` is deprecated. Use `client.contextLoader(...).searchSchema(...)` for new schema discovery integrations.

Use `callTool(name, args)` when you need native MCP `tools/call` access for newly added server tools before the SDK adds a typed wrapper. Arguments are passed through unchanged.

## CLI Reference

`kweaver` follows a `gh`-style help layout (see [docs/cli_conventions.md §8](../../docs/cli_conventions.md#8-help-文本格式must)):

```text
kweaver [--help|-h]                       # gh-style top-level overview
kweaver help <command>                    # forward to <command> --help
kweaver help all                          # full per-action signatures (migration fallback)
kweaver <command> [--help|-h]             # subcommand overview + actions
kweaver <command> <subcommand> [--help|-h]  # action-level flags + examples
```

Top-level command groups:

```text
CORE        auth · token · call · agent · bkn · dataflow · ds · resource
PLATFORM    model · skill · toolbox · tool · vega · context-loader
ADDITIONAL  config · explore · trace · help
```

For a structured browsable index of every action and flag, run `kweaver help all`.

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

### Model factory CLI examples

`model` talks to **mf-model-manager** (`/api/mf-model-manager/v1`) for CRUD and **mf-model-api** (`/api/mf-model-api/v1`) for OpenAI-compatible **`chat`**, **`small embeddings`**, and **`small rerank`**. Override origins with `--mf-base-url` / `--mf-api-base-url` or `KWEAVER_MF_MODEL_MANAGER_URL` / `KWEAVER_MF_MODEL_API_URL`. `model llm --template` / `model small --template` prints one offline **`basic`** JSON stub per branch (no API calls). **LLM** `model_type` on the platform is one of **`llm`** (text), **`rlm`** (reasoning), or **`vu`** (vision / multimodal); filter with `kweaver model llm list --type …`. See [`skills/kweaver-core/references/model.md`](../../skills/kweaver-core/references/model.md#llm-model-types).

```bash
kweaver model llm list --limit 30
kweaver model llm list --type rlm
kweaver model llm get <model_id>
kweaver model llm add --body-file ./llm.json --upstream-url https://dashscope-intl.aliyuncs.com/compatible-mode/v1/chat/completions --api-model qwen-plus --api-key-file ~/.dashscope_key
kweaver model llm chat <model_id> -m "Hello" --no-stream
kweaver model llm --template > ./llm.json
kweaver model small list
kweaver model small add --name my-emb --type embedding --batch-size 8 --max-tokens 512 --embedding-dim 1536 \
  --model-config-file ./cfg.json
kweaver model small add --name my-emb --type embedding --batch-size 8 --max-tokens 8192 --embedding-dim 1024 \
  --upstream-url https://dashscope-intl.aliyuncs.com/compatible-mode/v1/embeddings --api-model text-embedding-v4 --api-key-file ~/.dashscope_key
kweaver model small test <model_id>
kweaver model small embeddings <model_id> -i "hello" -i "world"
kweaver model small rerank <model_id> -q "query" -d "doc a" -d "doc b"
kweaver model small --template > ./embedding-model-config.json
```

Full flags: `kweaver model --help` and [`skills/kweaver-core/references/model.md`](../../skills/kweaver-core/references/model.md).

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

# Invoke / debug: envelope supports `--header`, `--query`, `--body`, and **`--path`**
# for OpenAPI `{param}` placeholders (required for paths like `/data-views/{id}`).
kweaver tool debug --toolbox <BOX_ID> <TOOL_ID> \
  --path '{"id":"<DATA_VIEW_UUID>"}' [--body '<json>']
```

**No-auth platforms:** If OAuth is not enabled, use `kweaver auth <url> --no-auth` (or run a normal `auth login`; a **404** on `POST /oauth2/clients` switches to no-auth automatically). Credentials are still saved under `~/.kweaver/` and work with `auth use` / `auth list`. Optional: `KWEAVER_NO_AUTH=1` with `KWEAVER_BASE_URL` when no token env is set. SDK: `new KWeaverClient({ baseUrl, auth: false })` or `kweaver.configure({ baseUrl, auth: false })`.

## Environment Variables

| Variable | Description |
|---|---|
| `KWEAVER_BASE_URL` | KWeaver instance URL |
| `KWEAVER_MF_MODEL_MANAGER_URL` | Optional override for mf-model-manager API (defaults from `KWEAVER_BASE_URL` + `/api/mf-model-manager/v1`) |
| `KWEAVER_MF_MODEL_API_URL` | Optional override for mf-model-api (defaults from `KWEAVER_BASE_URL` + `/api/mf-model-api/v1`) |
| `KWEAVER_BUSINESS_DOMAIN` | Business domain identifier |
| `KWEAVER_TOKEN` | Access token |
| `KWEAVER_TOKEN_SOURCE` | Internal sentinel set by the CLI when `--token` is passed; do not set manually |
| `KWEAVER_NO_AUTH` | Set to `1`/`true`/`yes` to use no-auth sentinel when `KWEAVER_TOKEN` is unset (with `KWEAVER_BASE_URL` or active platform) |
| `KWEAVER_TLS_INSECURE` | Set to `1` or `true` to skip TLS certificate verification for all HTTPS in the process (dev only; prefer `kweaver auth … --insecure` which saves per platform) |
| `NODE_TLS_REJECT_UNAUTHORIZED` | Node.js built-in TLS switch: set to `0` to skip certificate verification for HTTPS in this process. The `kweaver` CLI sets this when `KWEAVER_TLS_INSECURE` is set or the saved token has insecure TLS (same scope as above; dev only). |

### Stateless token mode

Pass an access token via `--token` for fully stateless invocations (no read or write of `~/.kweaver/` for that token):

```bash
kweaver --base-url https://platform.example.com --token "$TOK" bkn list
```

Resolution order:

| Source | base-url | token |
|--------|----------|-------|
| flag   | `--base-url` | `--token` |
| env    | `KWEAVER_BASE_URL` | `KWEAVER_TOKEN` |
| disk   | active platform | OAuth session (refreshable) |

When `--token` is used, write-disk commands (`auth login` / `logout` / `use` / `delete` / `switch`, `config set-bd`, the entire `context-loader config` group) error out — drop `--token` or use `kweaver auth login` for a saved session.

`auth whoami` / `auth status` distinguish the two stateless modes: `Source: CLI (flag: --token)` for flag mode, `env (KWEAVER_TOKEN)` for env mode (`whoami --json` uses `"source": "flag"` vs `"source": "env"`).

`kweaver context-loader` runtime subcommands accept `<kn-id>` as the first positional (e.g. `kweaver context-loader tools <kn-id>`) or via the global `--kn-id <id>` / `-k <id>` flag, so they work in stateless mode without any saved config. Use `kweaver context-loader help <subcommand>` or `<subcommand> --help` to inspect arguments before login/network checks. The `context-loader config set|use|list|remove|show` management group is deprecated, prints a warning on use, and is disabled in its entirety under `--token`.

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
