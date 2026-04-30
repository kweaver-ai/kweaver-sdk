# BKN Metrics — Full Stack (Management + Query + Dry-Run)

Last updated: 2026-04-27 (TS + Py split modules; Python in same PR)

## Summary

Deliver **one milestone** in kweaver-sdk: **(1) BKN metric definition lifecycle** on **bkn-backend** (list, CRUD, concept search, validation) and **(2) metric data** on **ontology-query** (query by published `metric_id`, **dry-run** with inline `metric_config`).

**Deliverables (same PR)**:

- **TypeScript**: split API modules (`bkn-metrics.ts`, `ontology-query-metrics.ts`) + **CLI** `kweaver bkn metric ...` + **Skill** (`references/metric.md`, `SKILL.md`).
- **Python**: split resources mirroring the two HTTP planes (see **Python file layout**), exposed on `KWeaverClient`, with **unit tests** under `packages/python/tests/unit/`.

| Concern | Service | OpenAPI (kweaver-core) | Implementation service (reference) |
|--------|---------|------------------------|-----------------------------------|
| Metric CRUD, list, search, validation | bkn-backend | `adp/docs/api/bkn/bkn-backend-api/bkn-metrics.yaml` | `adp/bkn/bkn-backend/server` |
| Metric data + dry-run | ontology-query | `adp/docs/api/bkn/ontology-query-ai/ontology-query.yaml` | `adp/bkn/ontology-query/server` |

**Approach** confirmed: **(1) full stack single delivery** (extends prior query-only draft).

## Scope

### In scope

- **TypeScript** (see **TypeScript file layout** below — **do not** add all metric code into `bkn-backend.ts` or `ontology-query.ts` to avoid oversized files)
  - **`packages/typescript/src/api/bkn-metrics.ts`**: bkn-backend **metric definition** HTTP helpers (`/api/bkn-backend/v1/.../metrics/...` per `bkn-metrics.yaml`).
  - **`packages/typescript/src/api/ontology-query-metrics.ts`**: **metric data** + **dry-run** on ontology-query (`metricQueryData`, `metricDryRun`); reuses `fetchWithRetry` and `OntologyQueryBaseOptions` from `./ontology-query.js` without growing `ontology-query.ts` further.
- **CLI**: `bkn-metric.ts` (or equivalent) with **`kweaver bkn metric ...`**; **register** in `packages/typescript/src/commands/bkn.ts` alongside `object-type`.
- **Exports** (`packages/typescript/src/index.ts` as needed): re-export public symbols from `bkn-metrics.ts` and `ontology-query-metrics.ts`.
- **Unit tests** (dedicated test files, parallel to the split)
  - **`packages/typescript/test/bkn-metrics.test.ts`** for `bkn-metrics.ts`.
  - **`packages/typescript/test/ontology-query-metrics.test.ts`** for `ontology-query-metrics.ts`.
- **Skill** (`skills/kweaver-core/`): extend `SKILL.md` triggers; **`references/metric.md`** covers **both** bkn-backend management and ontology-query query/dry-run (plus **Python** snippets for `KWeaverClient`).
- **User-visible doc sync** per `AGENTS.md`: TypeScript CLI help, `printHelp()` in `cli.ts` if the `bkn` summary table changes, README(s) if they list `bkn` subcommands; **Python** docstrings and package/README updates if they list resources.
- **Python** (same PR, split modules — do **not** place all metric logic in one oversized file; see **Python file layout**): `BknMetricsResource` + `MetricQueryResource` on `KWeaverClient`, with unit tests.

### Out of scope (same PR)

- E2E against live bkn-backend / ontology-query (UT only: TS mock `fetch` / Python mock HTTP).
- **OpenAPI code generation**; TS request bodies as **`str`**; Python returns **parsed JSON** (`dict` / `Any`) unless small DTOs already exist in `kweaver.types`.
- **Vega** platform metrics; only **BKN `MetricDefinition`** and the ontology-query metric paths in this spec.
- **Python** standalone CLI for `bkn metric` (library SDK only in this PR unless the repo already exposes an equivalent; see “Later (optional)”).

## Goals

- Parity in spirit with **`bkn object-type`**: schema/management vs **`query`/`properties`** on ontology-query; here **metric** management is on **bkn-backend**, not ontology-manager.
- Reuse **auth** (`buildHeaders`), **business domain**, and where applicable **timeout/retry** (ontology-query read paths: TS `fetchWithRetry` like `objectTypeQuery`; Python: align `HttpClient` timeout/retry with existing `query.py` / `QueryResource` patterns for long-running reads).
- **Default `limit` (AGENTS.md)**: list-like **30**, query-like **50** — apply in **TS CLI** and **Python** public methods that accept `limit` (document; do not break existing callers with silent injection into JSON if the API expects body-only — prefer explicit default parameters where the HTTP API uses query or method args).
- **TypeScript CLI**: JSON body as string, `--pretty`, `-bd`, list defaults as above.

## Architecture

```text
User / Agent
    → SKILL.md (intent: 指标管理 vs 查数 vs 试算)
    → references/metric.md
    → kweaver bkn metric <subcommand>
        OR  TS: `bkn-metrics.ts` | `ontology-query-metrics.ts`
        OR  Py: `KWeaverClient.metrics` | `KWeaverClient.metric_query` (see below)
        → /api/bkn-backend/v1/knowledge-networks/{kn_id}/metrics/...   (definitions)
        → /api/ontology-query/v1/knowledge-networks/{kn_id}/metrics/...   (data, dry-run)
```

- **Management API layer**: build URL + query; `POST` to collection URL requires **`X-HTTP-Method-Override`** (`POST` = batch create, `GET` = concept search) per OpenAPI; **no** `fetchWithRetry` unless product decides these POSTs are idempotent (default: **single request**, no retry, same as `bknPost` in `bkn-backend.ts`).
- **Query API layer**: `metricQueryData` / `metricDryRun` (in `ontology-query-metrics.ts`) use **`fetchWithRetry`**, `Content-Type: application/json`, **no** `X-HTTP-Method-Override`.

## TypeScript file layout

| File | Responsibility | Depends on |
|------|----------------|------------|
| `api/bkn-metrics.ts` | List, batch create, concept search, validation, get/update/delete (single and batch) for **BKN metrics** on bkn-backend. | `HttpError`, `buildHeaders` from existing modules; **reuse** URL/build patterns with `bkn-backend.ts` by **exporting** small shared helpers from `bkn-backend.ts` (e.g. `knUrl` + `bknGet` / post variants) **or** a short private duplicate of the `BKN_BASE` + path builder only if re-exporting is too noisy—pick the lower-noise option at implementation. |
| `api/ontology-query-metrics.ts` | `metricQueryData`, `metricDryRun` only. | `./ontology-query.js`: `fetchWithRetry`, `OntologyQueryBaseOptions`; `buildHeaders` already pulled transitively. |

**Rules**

- **Do not** append metric APIs to the bottom of `ontology-query.ts` or `bkn-backend.ts`; keep those files focused on pre-existing surface area.
- New CLI (`bkn-metric.ts`) imports from **`bkn-metrics.js`** and **`ontology-query-metrics.js`**, not from monolith files.
- `index.ts` re-exports what is part of the public API for SDK consumers.

## Python file layout

| Module | Class | Responsibility |
|--------|--------|------------------|
| `kweaver/resources/bkn_metrics.py` | e.g. `BknMetricsResource` (name finalizable) | **bkn-backend** `/api/bkn-backend/v1/knowledge-networks/{kn_id}/metrics/...` — list, batch create, concept search (POST + `X-HTTP-Method-Override`), validation, get/update/delete, batch get/delete. |
| `kweaver/resources/metric_query.py` | e.g. `MetricQueryResource` | **ontology-query** only: `.../metrics/{metric_id}/data` and `.../metrics/dry-run` (POST, **no** `X-HTTP-Method-Override`). |

**Constants**: `_BKN_PREFIX = "/api/bkn-backend/v1/knowledge-networks"` and `_OQ_METRICS` path segments — mirror existing style (`object_types.py`, `query.py`).

**Client wiring** (`_client.py`):

- `self.metrics = BknMetricsResource(self._http)` (or `bkn_metrics` if `metrics` is too ambiguous — prefer one name and document: **BKN metric definitions**).
- `self.metric_query = MetricQueryResource(self._http)`.

**Rules**

- **Do not** add large metric blocks to `query.py` if it would exceed the “split to avoid huge files” goal; keep **`QueryResource`** for existing `instances`, subgraph, etc., and use **`metric_query.py`** for the two metric endpoints.
- `resources/__init__.py` and package `__init__.py` / docs: export new resources as needed for public API consistency with other `resources`.

**Request/response**: use `self._http.get/post/put/delete` with `json=...` or `data=...` per `HttpClient` conventions; for bodies that are arbitrary JSON, accept `dict[str, Any] | str` and document; prefer `dict` for Python ergonomics.

## HTTP contract — bkn-backend (`bkn-metrics.yaml`)

Base: `/api/bkn-backend/v1/knowledge-networks/{kn_id}`.

| Operation | Method | Path | Notes |
|-----------|--------|------|--------|
| List | GET | `/metrics` | Query: `name_pattern`, `sort`, `direction`, `offset`, `limit` (server default 10; **CLI may default 30** per AGENTS and pass explicitly), `tag`, `group_id`, `branch` |
| Batch create | POST | `/metrics` | Header **`X-HTTP-Method-Override: POST`**, body `ReqMetrics` (`entries`), query `branch`, `strict_mode` |
| Concept search | POST | `/metrics` | Header **`X-HTTP-Method-Override: GET`**, body `FirstQueryWithSearchAfter` / `PageTurnWithSearchAfter` (same as object-type override), query `branch`, `strict_mode` |
| Validate | POST | `/metrics/validation` | body `{ "entries": [ CreateMetricRequest, ... ] }`, query `branch`, `strict_mode`, `import_mode` |
| Get one | GET | `/metrics/{metric_id}` | query `branch` |
| Update | PUT | `/metrics/{metric_id}` | body `UpdateMetricRequest`, query `branch`, `strict_mode` |
| Delete one | DELETE | `/metrics/{metric_id}` | query `branch` |
| Batch get | GET | `/metrics/{metric_ids}` | **One path segment**: comma-separated metric IDs (same style as `deleteObjectTypes` / `atIds` in this SDK) |
| Batch delete | DELETE | `/metrics/{metric_ids}` | same as batch get |

**Response codes**: `201` + ID array (batch create), `200` + JSON (list, get, search, validate), `204` (update/delete) — handle empty body on `204` like other PUT/DELETE clients.

**Note**: bkn-backend server routes may expose additional operations on `:metric_ids` (e.g. batch update); the SDK should **only** implement what `bkn-metrics.yaml` and product scope require, and can extend if OpenAPI is updated.

## HTTP contract — ontology-query (data + dry-run)

### Query metric data

- **POST** `/api/ontology-query/v1/knowledge-networks/{kn_id}/metrics/{metric_id}/data`
- **Query**: `branch`, `fill_null` (default false, URL only)
- **Body**: `MetricQueryRequestBody` (string in SDK)

### Dry-run (试算)

- **POST** `/api/ontology-query/v1/knowledge-networks/{kn_id}/metrics/dry-run`
- **Query**: `branch`, `fill_null`
- **Body**: `MetricDryRun` — include **`metric_config`**

### Response

- **200**: `MetricData` — as in OpenAPI; **400 / 404**: `ErrorBody`

## TypeScript API

### bkn-backend — `bkn-metrics.ts` (not `bkn-backend.ts`)

Add functions (names finalizable; export if public) mirroring the table above, e.g.:

| Function | Maps to |
|----------|--------|
| `listMetrics` | GET `.../metrics` |
| `createMetrics` | POST `.../metrics` + override **POST** |
| `searchMetrics` | POST `.../metrics` + override **GET** |
| `validateMetrics` | POST `.../metrics/validation` |
| `getMetric` | GET `.../metrics/{metric_id}` |
| `updateMetric` | PUT `.../metrics/{metric_id}` |
| `deleteMetric` | DELETE one |
| `getMetrics` | GET batch (path) |
| `deleteMetrics` | DELETE batch (path) |

**Options pattern**: `BknBackendKnOptions` (define locally or import from `bkn-backend.ts` if a shared name exists) + `body?: string` where needed; `branch`, `strict_mode`, `import_mode` (validation), query params for list. Use **`bknGet` / custom POST with extra headers** where `bknPost` does not set override (implement one small `bknPostWithOverride` in `bkn-metrics.ts` or shared helper exported from `bkn-backend.ts`).

### ontology-query — `ontology-query-metrics.ts` (not `ontology-query.ts`)

| Function | Purpose |
|----------|--------|
| `metricQueryData` | POST `.../metrics/{metric_id}/data` |
| `metricDryRun` | POST `.../metrics/dry-run` |

**Shared options** (extend `OntologyQueryBaseOptions`):

- `metricId?` — only for `metricQueryData`
- `body: string`
- `branch?`, `fillNull?` → `fill_null`

**Behavior**: **`fetchWithRetry`**, `Content-Type: application/json`, **no** `X-HTTP-Method-Override`.

## Python API (summary)

- **`BknMetricsResource`**: methods 1:1 with the bkn-backend table in **TypeScript API** (list, create, search, validate, get, update, delete). `get` / `delete` accept a comma-separated id list for the batch path segment. Set headers for override POST/GET on the collection `POST` as required by `bkn-metrics.yaml`.
- **`MetricQueryResource`**: `metric_data` / `dry_run` (names finalizable) — POST with `kn_id`, `metric_id` (data path), `branch`, `fill_null`, and JSON body.
- **Parity**: behavior and paths align with **TypeScript** modules in the same PR; avoid duplicate HTTP logic beyond what is idiomatic in each language.

## CLI

**Group**: `kweaver bkn metric`

### Management (bkn-backend)

| Subcommand | Args (conceptual) | Notes |
|------------|-------------------|--------|
| `list` | `<kn-id>` | Flags: filter/sort/pagination/`branch`/`--limit` (default **30**), `-bd`, `--pretty` |
| `get` | `<kn-id> <metric-id>` or comma-separated ids | optional `--branch`; multiple ids use the batch GET path |
| `create` | `<kn-id> '<json>'` or file pattern if project already has `@file` | `ReqMetrics` / `entries` |
| `search` | `<kn-id> '<json>'` | concept search; `--search-after`, `--limit` for body assist (same style as `object-type query` helpers if reused) |
| `validate` | `<kn-id> '<json>'` | `import_mode`, `strict_mode` flags |
| `update` | `<kn-id> <metric-id> '<json>'` | `UpdateMetricRequest` |
| `delete` | `<kn-id> <metric-id>` or comma-separated ids `[-y]` | multiple ids use the batch DELETE path |

**Naming**: single `get` / `delete` subcommands only; no separate `get-batch` / `delete-batch`.

### Query (ontology-query)

| Subcommand | Args | Notes |
|------------|------|--------|
| `query` | `<kn-id> <metric-id> ['<json-body>']` | `--branch`, `--fill-null` |
| `dry-run` | `<kn-id> ['<json-body>']` | `metric_config` required in body |

**Flags**: `--branch`, `--fill-null`, `--pretty`, `-bd` as in other bkn query commands.

**Help**: Update **`bkn.ts`** general help to include a line for `bkn metric` (parallel to `object-type` quick reference) if the summary block lists subgroup commands.

## Skill & references

- **`SKILL.md`**: Triggers e.g. BKN 指标、指标管理、指标列表、指标创建、**指标概念检索**、**指标校验**、指标查询、**指标试算**、metric dry-run; clarify **not** Vega.
- **`references/metric.md`**: **Definitions (bkn-backend)**, **Data / dry-run (ontology-query)**, and **Python** (`KWeaverClient`); minimal JSON for HTTP; link to OpenAPI in kweaver-core; **BKN 指标** vs 对象类上的 metric 属性查询（不同入口）.

## Testing

- **TypeScript**
  - **`bkn-metrics.test.ts`**: For each `bkn-metrics.ts` function, assert URL, method, `X-HTTP-Method-Override` when required, query string, `Content-Type`, body pass-through, and error mapping. No network; mock `fetch` like `bkn-backend.test.ts`.
  - **`ontology-query-metrics.test.ts`**: Path, `branch`/`fill_null`, POST without override, and `fetchWithRetry` usage.
- **Python** (`make -C packages/python test`, no external services)
  - **`packages/python/tests/unit/test_bkn_metrics.py`** (or `test_metrics_bkn.py` — pick one naming style consistent with the repo) for `BknMetricsResource`.
  - **`packages/python/tests/unit/test_metric_query.py`** for `MetricQueryResource`.
- No E2E in this PR’s scope.

## Documentation checklist (`AGENTS.md`)

Same PR must update:

1. CLI help in `packages/typescript/src/commands/*` (new `bkn-metric.ts` or split files).
2. `skills/kweaver-core/references/metric.md` + `SKILL.md` (include **short Python examples** for `KWeaverClient.metrics` / `metric_query` where appropriate).
3. `packages/typescript/src/cli.ts` `printHelp()` if the `bkn` section lists subcommands.
4. `README.md` / `README.zh.md` and root README(s) if they enumerate `bkn` or Python SDK resources.
5. **Python** docstrings on new public classes/methods (English) and any package-level docs that list resources (e.g. `KWeaverClient` docstring or README section).

## Risks & mitigations

| Risk | Mitigation |
|------|------------|
| Two services, two base paths | Skill + `metric.md` + CLI group `bkn metric` with clear subheadings. |
| Large JSON on CLI | Heredoc / pipe; `metric.md` examples; file input only if an existing `bkn` command already supports it. |
| List default 10 (server) vs 30 (AGENTS) | CLI documents default **30** and sends `limit=30` when user omits `--limit` (or document override policy explicitly in help). |
| OpenAPI drift | String body + links to `bkn-metrics.yaml` and `ontology-query.yaml`. |
| 204 responses | Reuse pattern from `updateObjectType` / delete helpers (empty success body). |
| Shared helpers between `bkn-backend.ts` and `bkn-metrics.ts` | Prefer **exporting** 2–3 small functions/constants from `bkn-backend.ts` over copy-paste; if exports clutter the public surface, use a `bkn-backend-shared.ts` **only** if the team prefers (default: export from `bkn-backend.ts` with clear names). |
| TS / Py drift | Keep path strings and override semantics **identical**; review checklist compares OpenAPI + both SDKs in one PR. |

## Later (optional, not this PR)

- E2E tests against a running environment.
- Stronger typed DTOs in `kweaver.types` (Python) or generated TS types if product standardizes.
- **Python** interactive/CLI for `bkn metric` **only** if the product adds a KWeaver Python entrypoint for BKN; until then, SDK usage is library-only.

## Approval

Confirmed:

- **Full stack (1)**: bkn-backend **management** + ontology-query **query + dry-run** in the **same** PR.
- **TypeScript + Python** + Skill + `bkn` CLI in the **same** PR.
- **`references/metric.md`** is the single reference for both HTTP planes; include **Python** usage snippets.
- **TypeScript**: **string** bodies in public API helpers for metric payloads; **Python**: parsed dict/`Any` over the wire, consistent with other resources.
- **TypeScript module split**: **`bkn-metrics.ts`** (definitions) and **`ontology-query-metrics.ts`** (data + dry-run); **no** new metric code in the existing large `bkn-backend.ts` / `ontology-query.ts` files.
- **Python module split**: **`resources/bkn_metrics.py`** + **`resources/metric_query.py`**; **no** monolithic addition only inside `query.py` unless the team explicitly collapses (default: keep separate).
