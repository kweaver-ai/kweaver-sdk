# KWeaver Python SDK

Python SDK for the KWeaver platform — BKN (Business Knowledge Network), Vega data management, and Decision Agents.

> **Note:** The CLI is provided by the [TypeScript package](../typescript/). This package is SDK-only.

[中文文档](README.zh.md)

## Installation

```bash
pip install kweaver-sdk
```

Requires **Python >= 3.10**.

## Quick Start

### Search & Chat (simplest path)

```python
import kweaver

kweaver.configure(
    url="https://kweaver.example.com",
    token="my-token",
    bkn_id="supply-chain-bkn-id",
    agent_id="supply-chain-agent-id",
)

# Semantic search
results = kweaver.search("What are the key risks in the supply chain?")
for concept in results.concepts:
    print(concept.concept_name, concept.rerank_score)

# Chat with an agent
reply = kweaver.chat("Analyse the inventory risks for this year")
print(reply.content)

# Streaming
for chunk in kweaver.chat("Generate a risk report", stream=True):
    print(chunk.delta, end="", flush=True)
```

### No-auth servers

If the platform has no API authentication, use `configure(..., auth=False)` or pass `NoAuth()` to `KWeaverClient`. This matches the TypeScript CLI `kweaver auth <url> --no-auth` token stored in `~/.kweaver/` (`ConfigAuth` then sends no `Authorization` header when the saved token is the `__NO_AUTH__` sentinel).

```python
from kweaver import KWeaverClient, NoAuth

client = KWeaverClient(base_url="http://localhost:8080", auth=NoAuth())
# or: kweaver.configure("http://localhost:8080", auth=False)
```

### Pure Python login

HTTP sign-in matches the TypeScript CLI (`--http-signin`): RSA-encrypted password, `/oauth2/signin`, token exchange—no Playwright and no Node CLI required.

```python
import kweaver

kweaver.login(
    "https://kweaver.example.com",
    username="alice@example.com",
    password="secret",
    # new_password="..."  # if the server returns 401001017 (initial password change)
)
```

`kweaver.configure(url=..., username=..., password=...)` wires `HttpSigninAuth`, which performs sign-in on the first API call.

### Client API (full control)

```python
from kweaver import KWeaverClient, ConfigAuth

client = KWeaverClient(
    auth=ConfigAuth(),           # reads ~/.kweaver/ credentials
    debug=True,                  # print request/response diagnostics
    vega_url="http://vega:13014", # optional: connect to Vega
)

# BKN — Knowledge Networks
kns = client.knowledge_networks.list()
report = client.knowledge_networks.inspect("kn-123")  # one-shot diagnosis

# BKN — Schema
ots = client.object_types.list("kn-123")
ot = client.object_types.get("kn-123", "ot-456")      # includes data_properties
cgs = client.concept_groups.list("kn-123")
jobs = client.jobs.list("kn-123")

# Vega — Data Platform
catalogs = client.vega.catalogs.list()
resources = client.vega.resources.list(catalog_id="cat-1", category="table")
models = client.vega.metric_models.list()

# Vega — Query
result = client.vega.query.dsl(body={"query": {"match_all": {}}, "size": 10})
result = client.vega.query.execute(tables=[...], output_fields=["*"], limit=20)
# Direct SQL or OpenSearch DSL — POST /api/vega-backend/v1/resources/query
# Use {{resource_id}} placeholders so vega-backend routes to the correct catalog connector.
rows = client.vega.query.sql_query({"query": "SELECT * FROM {{<resource-id>}} LIMIT 5", "resource_type": "mysql"})

# Vega — Diagnostics
info = client.vega.health()
report = client.vega.inspect()
```

### Observability

```python
# Debug mode — print full HTTP diagnostics + curl commands to stderr
client = KWeaverClient(auth=ConfigAuth(), debug=True)

# Dry-run — intercept write operations without sending to server
client = KWeaverClient(auth=ConfigAuth(), dry_run=True)
```

---

## SDK Resources

### BKN (Knowledge Networks)

| Resource | Access | Methods |
|----------|--------|---------|
| Knowledge Networks | `client.knowledge_networks` | `list`, `get`, `create`, `update`, `delete`, `build`, `export`, `inspect` |
| Object Types | `client.object_types` | `list`, `get`, `create`, `update`, `delete` |
| BKN metrics (definitions) | `client.metrics` | `list`, `create`, `search`, `validate`, `get`, `update`, `delete` |
| BKN metric data / dry-run | `client.metric_query` | `data`, `dry_run` |
| Relation Types | `client.relation_types` | `list`, `get`, `create`, `update`, `delete` |
| Action Types | `client.action_types` | `list`, `execute`, `cancel` |
| Concept Groups | `client.concept_groups` | `list`, `get`, `create`, `update`, `delete`, `add_members`, `remove_members` |
| Jobs | `client.jobs` | `list`, `get_tasks`, `delete`, `wait` |
| Query | `client.query` | `semantic_search`, `instances`, `instances_iter`, `kn_search`, `subgraph` |
| Agents | `client.agents` | `list`, `get`, `get_by_key`, `create`, `update`, `delete`, `publish`, `unpublish` |
| Conversations | `client.conversations` | `send_message`, `list_messages` |
| Dataflows | `client.dataflows` | `create`, `run`, `poll`, `delete`, `execute` |
| Dataflow v2 | `client.dataflow_v2` | `list_dataflows`, `run_dataflow_with_file`, `run_dataflow_with_remote_url`, `list_dataflow_runs`, `get_dataflow_logs_page` |
| Data Views | `client.dataviews` | `create`, `list`, `get`, `delete`, `find_by_table`, `query` (SQL via mdl-uniquery) |
| Skills | `client.skills` | `list`, `market`, `get`, `register_content`, `register_zip`, `update_status`, `content`, `read_file`, `download`, `install` |

For Context Loader MCP access, use `ContextLoaderResource` directly:

```python
from kweaver.resources import ContextLoaderResource

cl = ContextLoaderResource(base_url, token, kn_id="kn_01")
schema = cl.search_schema("margin")
raw = cl.call_tool("search_schema", {"query": "margin"})
```

`search_schema()` is the typed wrapper for the Context Loader MCP `search_schema` tool. It defaults `response_format` to `json` and accepts `query`, `response_format`, `search_scope`, `max_concepts`, `schema_brief`, and `enable_rerank`. The parsed response may contain `object_types`, `relation_types`, `action_types`, and `metric_types`.

Use `call_tool(name, args)` when you need native MCP `tools/call` access for newly added server tools before the SDK adds a typed wrapper. Arguments are passed through unchanged.

For self-signed development platforms, pass `tls_insecure=True`.

### Vega (Data Platform)

| Resource | Access | Methods |
|----------|--------|---------|
| Catalogs | `client.vega.catalogs` | `list`, `get`, `health_status`, `health_report`, `test_connection`, `discover`, `resources` |
| Resources | `client.vega.resources` | `list`, `get`, `data`, `preview` |
| Connector Types | `client.vega.connector_types` | `list`, `get` |
| Metric Models | `client.vega.metric_models` | `list`, `get` |
| Event Models | `client.vega.event_models` | `list`, `get` |
| Trace Models | `client.vega.trace_models` | `list`, `get` |
| Data Views | `client.vega.data_views` | `list`, `get` |
| Data Dicts | `client.vega.data_dicts` | `list`, `get` |
| Objective Models | `client.vega.objective_models` | `list`, `get` |
| Query | `client.vega.query` | `execute`, `sql_query`, `dsl`, `dsl_count`, `promql`, `promql_instant`, `events` |
| Tasks | `client.vega.tasks` | `list_discover`, `get_discover`, `wait_discover`, `get_metric` |
| Namespace | `client.vega` | `health`, `stats`, `inspect` |

### Configuration

```python
KWeaverClient(
    base_url="https://...",          # KWeaver platform URL
    auth=ConfigAuth(),               # or TokenAuth("...") or HttpSigninAuth(url, username=..., password=...)
    vega_url="http://vega:13014",    # optional: Vega data platform URL
    debug=False,                     # print request/response diagnostics
    dry_run=False,                   # intercept write operations
    tls_insecure=False,              # skip TLS verification (dev/self-signed; prefer trusted certs in prod)
)
```

| Env Variable | Description |
|---|---|
| `KWEAVER_BASE_URL` | Platform URL |
| `KWEAVER_TOKEN` | Bearer token |
| `KWEAVER_VEGA_URL` | Vega backend URL |
| `KWEAVER_DEBUG` | Enable debug mode (`true`) |
| `KWEAVER_FORMAT` | Output format (`md`/`json`/`yaml`) |
| `KWEAVER_TLS_INSECURE` | Set to `1` or `true` to skip TLS verification for HTTPS (dev only; `kweaver auth … --insecure` persists per platform in `token.json`) |

---

## Dataflow v2 Example

```python
from kweaver import KWeaverClient, ConfigAuth

client = KWeaverClient(auth=ConfigAuth())

flows = client.dataflow_v2.list_dataflows()

file_run = client.dataflow_v2.run_dataflow_with_file(
    "dag-id",
    file_path="./demo.pdf",
)

remote_run = client.dataflow_v2.run_dataflow_with_remote_url(
    "dag-id",
    url="https://example.com/demo.pdf",
    name="demo.pdf",
)

runs = client.dataflow_v2.list_dataflow_runs(
    "dag-id",
    limit=20,
    sort_by="started_at",
    order="desc",
)

logs = client.dataflow_v2.get_dataflow_logs_page(
    "dag-id",
    remote_run["dag_instance_id"],
    page=0,
    limit=10,
)
```

The Python package remains SDK-only. The `dataflow` CLI commands are provided by the TypeScript package.

---

## Links

- [GitHub](https://github.com/kweaver-ai/kweaver-sdk)
- [TypeScript SDK on npm](https://www.npmjs.com/package/@kweaver-ai/kweaver-sdk)

## License

MIT
