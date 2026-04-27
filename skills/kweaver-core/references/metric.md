# BKN metrics (definitions + data)

BKN **native metrics** (`MetricDefinition`) are **not** Vega catalog metrics.

- **Definitions** (list / CRUD / search / validate): **bkn-backend** — `kweaver bkn metric ...` and Python `KWeaverClient.metrics`.
- **Data / dry-run** (query by published `metric_id`, 试算): **ontology-query** — `bkn metric query|dry-run` and `KWeaverClient.metric_query`.

## CLI

```bash
kweaver bkn metric --help
kweaver bkn metric list <kn-id> [--limit 30] ...
kweaver bkn metric query <kn-id> <metric-id> '<json>' [--branch <b>] [--fill-null]
kweaver bkn metric dry-run <kn-id> '<json>' [--branch <b>] [--fill-null]
```

`query` / `search` (concept) default **limit 50** in the JSON body when not set; `list` default **--limit 30** (AGENTS.md).

## TypeScript (npm package)

- `metricQueryData` / `metricDryRun` — `packages/typescript` exports from `ontology-query-metrics`.
- `listMetrics` / `createMetrics` / … — `bkn-metrics` module.

## Python

```python
from kweaver import KWeaverClient

c = KWeaverClient(base_url="...", token="...")
c.metrics.list("kn-1", limit=30)
c.metric_query.data("kn-1", "metric_id", {"limit": 10}, fill_null=True)
c.metric_query.dry_run("kn-1", {"metric_config": {...}})
```

## OpenAPI (kweaver-core)

- `adp/docs/api/bkn/bkn-backend-api/bkn-metrics.yaml`
- `adp/docs/api/bkn/ontology-query-ai/ontology-query.yaml` (paths under `.../metrics/...`)
