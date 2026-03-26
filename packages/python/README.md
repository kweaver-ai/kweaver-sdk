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
| Relation Types | `client.relation_types` | `list`, `get`, `create`, `update`, `delete` |
| Action Types | `client.action_types` | `list`, `execute`, `cancel` |
| Concept Groups | `client.concept_groups` | `list`, `get`, `create`, `update`, `delete`, `add_members`, `remove_members` |
| Jobs | `client.jobs` | `list`, `get_tasks`, `delete`, `wait` |
| Query | `client.query` | `semantic_search`, `instances`, `instances_iter`, `kn_search`, `subgraph` |
| Agents | `client.agents` | `list`, `get`, `get_by_key`, `create`, `update`, `delete`, `publish`, `unpublish` |
| Conversations | `client.conversations` | `send_message`, `list_messages` |
| Dataflows | `client.dataflows` | `create`, `run`, `poll`, `delete`, `execute` |
| Data Views | `client.dataviews` | `create`, `list`, `get`, `delete`, `find_by_table`, `query` (SQL via mdl-uniquery) |

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
| Query | `client.vega.query` | `execute`, `dsl`, `dsl_count`, `promql`, `promql_instant`, `events` |
| Tasks | `client.vega.tasks` | `list_discover`, `get_discover`, `wait_discover`, `get_metric` |
| Namespace | `client.vega` | `health`, `stats`, `inspect` |

### Configuration

```python
KWeaverClient(
    base_url="https://...",          # KWeaver platform URL
    auth=ConfigAuth(),               # or TokenAuth("...") or PasswordAuth(...)
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

## Links

- [GitHub](https://github.com/kweaver-ai/kweaver-sdk)
- [TypeScript SDK on npm](https://www.npmjs.com/package/@kweaver-ai/kweaver-sdk)

## License

MIT
