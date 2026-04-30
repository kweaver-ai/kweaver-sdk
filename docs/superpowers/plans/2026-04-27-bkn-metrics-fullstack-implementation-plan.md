# BKN Metrics Full Stack — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship bkn-backend metric definition APIs, ontology-query metric data/dry-run, `kweaver bkn metric` CLI, Python `BknMetricsResource` + `MetricQueryResource`, Skill reference, and docs in one PR per `docs/superpowers/specs/2026-04-24-bkn-metric-query-skill-design.md`.

**Architecture:** Two TypeScript API modules (`bkn-metrics.ts`, `ontology-query-metrics.ts`) avoid bloating `bkn-backend.ts` / `ontology-query.ts`. Two Python modules (`bkn_metrics.py`, `metric_query.py`) mirror the same HTTP split. CLI dispatches `metric` like `object-type`. No E2E; UT only.

**Tech Stack:** Node `node:test`, TypeScript, `fetch` mocks; Python `pytest`, `httpx` via existing `tests.conftest` `make_client` / `RequestCapture`.

**Git:** Plan steps may show example `git commit` commands; **only commit when the author explicitly confirms** (per team policy).

**Spec:** `docs/superpowers/specs/2026-04-24-bkn-metric-query-skill-design.md`

---

## File map (create / modify)

| Action | Path | Responsibility |
|--------|------|------------------|
| Create | `packages/typescript/src/api/bkn-metrics.ts` | bkn-backend metrics HTTP API |
| Create | `packages/typescript/src/api/ontology-query-metrics.ts` | ontology-query `metricQueryData`, `metricDryRun` |
| Modify | `packages/typescript/src/api/bkn-backend.ts` | Export `knUrl` (and if needed a small `bknFetch` helper for POST with extra headers) |
| Create | `packages/typescript/test/bkn-metrics.test.ts` | UT for `bkn-metrics.ts` |
| Create | `packages/typescript/test/ontology-query-metrics.test.ts` | UT for `ontology-query-metrics.ts` |
| Create | `packages/typescript/src/commands/bkn-metric.ts` | `runKnMetricCommand`, help text |
| Modify | `packages/typescript/src/commands/bkn.ts` | Import + `if (subcommand === "metric")`; extend `KN_HELP` / `KN_HELP` quick list |
| Modify | `packages/typescript/src/cli.ts` | `printHelp()` if `bkn` subgroup lines are listed |
| Modify | `packages/typescript/src/index.ts` | Re-export new public symbols |
| Create | `packages/python/src/kweaver/resources/bkn_metrics.py` | `BknMetricsResource` |
| Create | `packages/python/src/kweaver/resources/metric_query.py` | `MetricQueryResource` |
| Modify | `packages/python/src/kweaver/_client.py` | `self.metrics`, `self.metric_query` |
| Modify | `packages/python/src/kweaver/resources/__init__.py` | Optional exports |
| Create | `packages/python/tests/unit/test_bkn_metrics.py` | UT |
| Create | `packages/python/tests/unit/test_metric_query.py` | UT |
| Create | `skills/kweaver-core/references/metric.md` | Reference |
| Modify | `skills/kweaver-core/SKILL.md` | Triggers + link to `metric.md` |
| Modify | `packages/typescript/README.md`, `README.zh.md`, root README(s) | If they list `bkn` subcommands or SDK features |

---

### Task 1: Export `knUrl` from `bkn-backend.ts`

**Files:**
- Modify: `packages/typescript/src/api/bkn-backend.ts`
- Test: run `make -C packages/typescript test` (existing `bkn-backend.test.ts` must still pass)

- [ ] **Step 1:** Change `function knUrl(` to `export function knUrl(` (same signature: `baseUrl`, `knId`, `path`).

- [ ] **Step 2:** Run tests.

```bash
cd /home/workspaces/ADP/kweaver-sdk && make -C packages/typescript test
```

Expected: PASS (no behavior change).

- [ ] **Step 3:** Commit (optional — confirm with project owner before any `git commit`).

```bash
git add packages/typescript/src/api/bkn-backend.ts
git commit -m "refactor(api): export knUrl from bkn-backend for bkn-metrics module"
```

---

### Task 2: Add `ontology-query-metrics.ts` with `metricQueryData` and `metricDryRun`

**Files:**
- Create: `packages/typescript/src/api/ontology-query-metrics.ts`
- Create: `packages/typescript/test/ontology-query-metrics.test.ts`
- Modify: `packages/typescript/src/index.ts` (re-export)

- [ ] **Step 1:** Create `ontology-query-metrics.ts` with:

```typescript
import { fetchWithRetry } from "./ontology-query.js";
import { buildHeaders } from "./headers.js";
import type { OntologyQueryBaseOptions } from "./ontology-query.js";

export interface MetricQueryDataOptions extends OntologyQueryBaseOptions {
  metricId: string;
  body: string;
  branch?: string;
  fillNull?: boolean;
}

export interface MetricDryRunOptions extends OntologyQueryBaseOptions {
  body: string;
  branch?: string;
  fillNull?: boolean;
}

function appendMetricQueryParams(url: URL, branch: string | undefined, fillNull: boolean | undefined): void {
  if (branch !== undefined) url.searchParams.set("branch", branch);
  if (fillNull !== undefined) url.searchParams.set("fill_null", String(fillNull));
}

export async function metricQueryData(options: MetricQueryDataOptions): Promise<string> {
  const {
    baseUrl,
    accessToken,
    knId,
    metricId,
    body,
    businessDomain = "bd_public",
    branch,
    fillNull,
  } = options;
  const base = baseUrl.replace(/\/+$/, "");
  const url = new URL(
    `${base}/api/ontology-query/v1/knowledge-networks/${encodeURIComponent(knId)}/metrics/${encodeURIComponent(metricId)}/data`
  );
  appendMetricQueryParams(url, branch, fillNull);
  const headers: Record<string, string> = {
    ...buildHeaders(accessToken, businessDomain),
    "content-type": "application/json",
  };
  return fetchWithRetry(url.toString(), { method: "POST", headers, body });
}

export async function metricDryRun(options: MetricDryRunOptions): Promise<string> {
  const { baseUrl, accessToken, knId, body, businessDomain = "bd_public", branch, fillNull } = options;
  const base = baseUrl.replace(/\/+$/, "");
  const url = new URL(
    `${base}/api/ontology-query/v1/knowledge-networks/${encodeURIComponent(knId)}/metrics/dry-run`
  );
  appendMetricQueryParams(url, branch, fillNull);
  const headers: Record<string, string> = {
    ...buildHeaders(accessToken, businessDomain),
    "content-type": "application/json",
  };
  return fetchWithRetry(url.toString(), { method: "POST", headers, body });
}
```

**Note:** If `OntologyQueryBaseOptions` is not exported from `ontology-query.ts`, add `export` to that interface in `ontology-query.ts` (same PR).

- [ ] **Step 2:** Add test file `ontology-query-metrics.test.ts` — copy the style of `ontology-query.test.ts` (mock `globalThis.fetch`). Assert for `metricQueryData`:
  - URL ends with `/metrics/m-1/data`
  - Query `branch=main` and `fill_null=true` when options set
  - Headers include `content-type: application/json`, no `X-HTTP-Method-Override`
  - Method `POST`, body passthrough

- [ ] **Step 3:** Run `make -C packages/typescript test` — expect PASS.

- [ ] **Step 4:** Export from `packages/typescript/src/index.ts` in the same block as other `ontology-query` exports (search for `objectTypeQuery`).

---

### Task 3: Implement `bkn-metrics.ts` (full bkn-backend metric surface)

**Files:**
- Create: `packages/typescript/src/api/bkn-metrics.ts`
- Modify: `packages/typescript/src/index.ts`

- [ ] **Step 1:** Implement using `knUrl` from `./bkn-backend.js`, `buildHeaders` + `HttpError` from existing modules. Pattern: GET uses `fetch` like `bknGet` inline or import; POST with override needs custom `fetch` with headers `X-HTTP-Method-Override: POST` | `GET` and `content-type: application/json`.

**Function checklist (must all exist):**

- `listMetrics` — GET `metrics` + query params per spec (`name_pattern`, `sort`, `direction`, `offset`, `limit`, `tag`, `group_id`, `branch`)
- `createMetrics` — POST `metrics`, header `X-HTTP-Method-Override: POST`, body string
- `searchMetrics` — POST `metrics`, header `X-HTTP-Method-Override: GET`, body string
- `validateMetrics` — POST `metrics/validation`, body string, query `branch`, `strict_mode`, `import_mode`
- `getMetric` — GET `metrics/:id`
- `updateMetric` — PUT `metrics/:id`, body string; accept 204 empty
- `deleteMetric` — DELETE `metrics/:id`; accept 204
- `getMetrics` — GET `metrics/:ids` (comma-separated)
- `deleteMetrics` — DELETE `metrics/:ids`

**204 handling:** read `response.text()`; if `!response.ok` throw `HttpError`; if ok return `""` or raw text for 200 JSON responses.

- [ ] **Step 2:** Export types: `ListMetricsOptions`, `CreateMetricsOptions`, etc., following `CreateConceptGroupOptions` style in `bkn-backend.ts`.

- [ ] **Step 3:** Re-export public functions from `packages/typescript/src/index.ts`.

---

### Task 4: Unit tests `bkn-metrics.test.ts`

**Files:**
- Create: `packages/typescript/test/bkn-metrics.test.ts`

- [ ] **Step 1:** One test per major behavior: `listMetrics` GET URL + query; `createMetrics` POST + `X-HTTP-Method-Override: POST`; `searchMetrics` POST + override `GET`; `validateMetrics` path `.../validation`; `getMetrics` comma IDs; `deleteMetrics` DELETE.

- [ ] **Step 2:** Run `make -C packages/typescript test` — PASS.

---

### Task 5: CLI `bkn-metric.ts` and wire `bkn.ts`

**Files:**
- Create: `packages/typescript/src/commands/bkn-metric.ts`
- Modify: `packages/typescript/src/commands/bkn.ts`

- [ ] **Step 1:** Implement `runKnMetricCommand(args: string[])`:
  - Parse `--help` → print English help listing subcommands (`list`, `get`, `create`, `search`, `validate`, `update`, `delete`, `query`, `dry-run`). `get` / `delete` accept comma-separated metric ids (batch path).
  - Reuse `ensureValidToken`, `formatCallOutput`, `parseOntologyQueryFlags` / `resolveBusinessDomain` where applicable (see `bkn-schema.ts` + `bkn-utils.ts`).
  - `list`: default `--limit` to **30** when not passed (AGENTS.md).
  - `query` / `dry-run`: call `metricQueryData` / `metricDryRun`; support `--branch`, `--fill-null`, `--pretty`, `-bd`.

- [ ] **Step 2:** In `bkn.ts`, add `if (subcommand === "metric") return runKnMetricCommand(rest);` and add one line to the quick-reference block in `KN_HELP` (e.g. `metric list|get|...`).

- [ ] **Step 3:** Manual smoke: `node packages/typescript/dist/cli.js bkn metric --help` after build (or `npm test` only in CI).

---

### Task 6: `cli.ts` printHelp and README sync

**Files:**
- Modify: `packages/typescript/src/cli.ts`
- Modify: `packages/typescript/README.md`, `packages/typescript/README.zh.md`, root `README.md` / `README.zh.md` **if** they enumerate `bkn` subcommands

- [ ] **Step 1:** Update `printHelp()` only if it contains a static list of `bkn` children that should include `metric`.

- [ ] **Step 2:** AGENTS.md checklist: CLI + skill + README alignment.

---

### Task 7: Skill `metric.md` + `SKILL.md`

**Files:**
- Create: `skills/kweaver-core/references/metric.md`
- Modify: `skills/kweaver-core/SKILL.md`

- [ ] **Step 1:** `metric.md`: sections for bkn-backend paths, ontology-query paths, TS function names, CLI examples, Python examples (after Task 9), distinction from Vega, link to OpenAPI paths in kweaver-core.

- [ ] **Step 2:** `SKILL.md`: add trigger lines (中文/English) and bullet pointing to `references/metric.md`.

---

### Task 8: Python `BknMetricsResource`

**Files:**
- Create: `packages/python/src/kweaver/resources/bkn_metrics.py`
- Modify: `packages/python/src/kweaver/_client.py`

- [ ] **Step 1:** Define `_BASE = "/api/bkn-backend/v1/knowledge-networks"` and class `BknMetricsResource` with methods matching Task 3. Use `self._http.get/post/put/delete`. For POST to `.../metrics` with body, set headers `X-HTTP-Method-Override` to `"POST"` or `"GET"` as required. Use `params` for query string on GET list.

- [ ] **Step 2:** In `KWeaverClient.__init__`, add:

```python
from kweaver.resources.bkn_metrics import BknMetricsResource
from kweaver.resources.metric_query import MetricQueryResource
# ...
self.metrics = BknMetricsResource(self._http)
self.metric_query = MetricQueryResource(self._http)
```

- [ ] **Step 3:** English docstrings on the class and each public method.

---

### Task 9: Python `MetricQueryResource`

**Files:**
- Create: `packages/python/src/kweaver/resources/metric_query.py`

- [ ] **Step 1:** Methods `data(self, kn_id: str, metric_id: str, body: dict[str, Any] | None = None, *, branch: str | None = None, fill_null: bool = False) -> Any` and `dry_run(self, kn_id: str, body: dict[str, Any], *, branch: str | None = None, fill_null: bool = False) -> Any` posting to the same paths as TS. **No** `X-HTTP-Method-Override`. Use extended timeout (e.g. `timeout=120.0`) like `query.py` `instances` if long queries are expected.

- [ ] **Step 2:** Wire already done in Task 8.

---

### Task 10: Python unit tests

**Files:**
- Create: `packages/python/tests/unit/test_bkn_metrics.py`
- Create: `packages/python/tests/unit/test_metric_query.py`

- [ ] **Step 1:** Use `from tests.conftest import RequestCapture, make_client` — same pattern as `test_query.py`. Assert last URL path, method, headers (override), JSON body for one method each (e.g. `list` with limit 30 default, `create` with override POST, `data` with POST no override).

- [ ] **Step 2:** Run:

```bash
make -C packages/python test
```

Expected: PASS.

---

### Task 11: Final verification (repo contract)

- [ ] **Step 1:** From repo root:

```bash
make test
```

Expected: all UT green (TypeScript + Python per root Makefile).

- [ ] **Step 2:** Optional coverage:

```bash
make test-cover
```

- [ ] **Step 3:** `make ci` or project CI entry if different — ensure lint + coverage pass.

---

## Plan self-review (author checklist)

| Spec section | Covered by task |
|-------------|-----------------|
| `bkn-metrics.ts` + HTTP table | Task 1–4 |
| `ontology-query-metrics.ts` | Task 2 |
| CLI `bkn metric` | Task 5–6 |
| Skill + `metric.md` | Task 7 |
| Python resources + client | Task 8–9 |
| Python + TS tests | Task 2, 4, 10 |
| `AGENTS.md` doc sync | Tasks 5–7 |
| No E2E | Implicit — only `make test` |
| `limit` 30 / query guidance 50 | Task 5 (list default), `metric.md` text |

**Placeholder scan:** This plan does not use "TBD" for required behavior; function names in Task 3 are enumerated. Implementers must paste full `bkn-metrics.ts` code in the editor (Task 3 Step 1) following `bkn-metrics.yaml` — if any header casing differs, match existing `bkn-backend` / server expectations (`X-HTTP-Method-Override` vs `x-http-method-override` — follow TypeScript `buildHeaders` / fetch norm: use `X-HTTP-Method-Override` in code as in `ontology-query.ts`).

**Type consistency:** `KWeaverClient.metrics` and `metric_query` property names are fixed in Task 8; `metric.md` must use the same.

---

**Plan complete and saved to** `docs/superpowers/plans/2026-04-27-bkn-metrics-fullstack-implementation-plan.md`.

**执行方式（二选一）**

1. **Subagent 驱动（推荐）** — 每个任务用独立子代理执行，任务间可审查，适合并行度低、需频繁对齐时。需配合 **superpowers:subagent-driven-development**。

2. **本会话内联执行** — 在本聊天中按任务顺序实现，用 **superpowers:executing-plans** 做批处理与检查点。

你想用哪一种？
