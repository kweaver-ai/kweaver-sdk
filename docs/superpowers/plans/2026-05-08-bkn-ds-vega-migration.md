# BKN create-from-ds → vega catalogs Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Migrate the two SDK functions that `bkn create-from-ds` depends on (`listTablesWithColumns`, `scanMetadata`) from data-connection to vega-backend catalogs, in both TypeScript and Python. Update `bkn create-from-ds` / `bkn create-from-csv` to expect a vega catalog id and reject legacy datasource UUIDs with a clear hint.

**Architecture:** Thin adapter — keep public function signatures stable, swap underlying HTTP calls. Reuse the existing vega catalogs client (`api/vega.ts` / `resources/vega/catalogs.py`). `listTablesWithColumns` becomes `listVegaCatalogResources(category="table")` + concurrent `getVegaResource(rid)` × N. `scanMetadata` becomes `discoverVegaCatalog(wait=true)`. All other ds functions stay on data-connection.

**Tech Stack:** TypeScript (Node, native test runner), Python (httpx, pytest), vega-backend `/api/vega-backend/v1/catalogs/*` & `/api/vega-backend/v1/resources/*`.

**Spec:** [`docs/superpowers/specs/2026-05-08-bkn-ds-vega-migration-design.md`](../specs/2026-05-08-bkn-ds-vega-migration-design.md)

---

## File Structure

**Modify:**
- `packages/typescript/src/api/datasources.ts` — replace impl of `listTablesWithColumns`, `scanMetadata`, `scanDatasourceMetadata`
- `packages/python/src/kweaver/resources/datasources.py` — replace impl of `DataSourcesResource.list_tables`, `DataSourcesResource.scan_metadata`
- `packages/typescript/src/commands/bkn-ops.ts` — add UUID-prevalidation in `parseKnCreateFromDsArgs` & `parseKnCreateFromCsvArgs`; update help/usage strings

**Test (rewrite or add):**
- `packages/typescript/test/datasources-pk-propagation.test.ts` — replace data-connection mocks with vega resources flow
- `packages/typescript/test/datasources-scan.test.ts` — replace data-connection scan mocks with vega discover
- `packages/typescript/test/bkn-create-from-ds.test.ts` — add UUID-rejection cases
- `packages/python/tests/unit/test_datasources.py` — replace `test_list_tables` mocks; add scan_metadata test

**Untouched** (kept on data-connection): `testDatasource`, `createDatasource`, `listDatasources`, `getDatasource`, `deleteDatasource`, `listTables` (TS) / Python `test`/`create`/`list`/`get`/`delete`. CLI subcommands `kweaver ds list/get/tables/connect/delete` unchanged.

---

## Task 1: Set up isolated worktree

**Files:** none (workspace bootstrapping)

- [ ] **Step 1.1: Create worktree off main**

Run:

```bash
git -C /Users/xupeng/dev/github/kweaver-sdk worktree add -b feat/issue-114-bkn-ds-vega-migration ../kweaver-sdk-issue-114 main
cd ../kweaver-sdk-issue-114
```

Expected: new directory `../kweaver-sdk-issue-114` with branch `feat/issue-114-bkn-ds-vega-migration`.

- [ ] **Step 1.2: Verify clean baseline**

Run:

```bash
cd ../kweaver-sdk-issue-114
pnpm -C packages/typescript test 2>&1 | tail -20
```

Expected: existing tests pass on `main`.

- [ ] **Step 1.3: Verify Python baseline**

Run:

```bash
cd ../kweaver-sdk-issue-114/packages/python
python -m pytest tests/unit/test_datasources.py -q 2>&1 | tail -10
```

Expected: existing datasource tests pass.

---

## Task 2: TS — Rewrite `scanMetadata` test for vega discover

**Files:**
- Test: `packages/typescript/test/datasources-scan.test.ts` (overwrite)

- [ ] **Step 2.1: Replace test file**

Overwrite `packages/typescript/test/datasources-scan.test.ts` with:

```typescript
import test from "node:test";
import assert from "node:assert/strict";

import { scanDatasourceMetadata, scanMetadata } from "../src/api/datasources.js";

const originalFetch = globalThis.fetch;

interface CallRecord {
  method: string;
  url: string;
  body?: string;
}

function stubFetch(handler: (call: CallRecord) => Response | Promise<Response>) {
  const calls: CallRecord[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const call: CallRecord = {
      method: (init?.method ?? "GET").toUpperCase(),
      url: typeof input === "string" ? input : input.toString(),
      body: typeof init?.body === "string" ? init.body : undefined,
    };
    calls.push(call);
    return handler(call);
  }) as typeof fetch;
  return calls;
}

test("scanMetadata: POSTs vega discover with wait=true", async () => {
  const calls = stubFetch((c) => {
    if (
      c.method === "POST" &&
      c.url.includes("/vega-backend/v1/catalogs/cat-1/discover")
    ) {
      return new Response(JSON.stringify({ task_id: "vega-task-9" }), { status: 200 });
    }
    throw new Error(`unexpected ${c.method} ${c.url}`);
  });

  try {
    const body = await scanMetadata({
      baseUrl: "https://h.example",
      accessToken: "tok",
      id: "cat-1",
      businessDomain: "bd_public",
    });
    assert.ok(body.includes("vega-task-9"), "should return discover response body");
    const discoverCall = calls.find((c) => c.url.includes("/discover"));
    assert.ok(discoverCall, "must call vega discover");
    const u = new URL(discoverCall!.url);
    assert.equal(u.searchParams.get("wait"), "true", "wait must be true");
    assert.equal(
      calls.filter((c) => c.url.includes("/data-connection/")).length,
      0,
      "must not touch data-connection",
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("scanDatasourceMetadata: delegates to vega discover (no GET-then-scan dance)", async () => {
  const calls = stubFetch((c) => {
    if (c.method === "POST" && c.url.includes("/vega-backend/v1/catalogs/cat-1/discover")) {
      return new Response(JSON.stringify({ task_id: "vega-task-1" }), { status: 200 });
    }
    throw new Error(`unexpected ${c.method} ${c.url}`);
  });

  try {
    const body = await scanDatasourceMetadata({
      baseUrl: "https://h.example",
      accessToken: "tok",
      id: "cat-1",
      businessDomain: "bd_public",
    });
    assert.ok(body.includes("vega-task-1"));
    assert.equal(
      calls.filter((c) => c.url.includes("/data-connection/")).length,
      0,
      "must not touch data-connection",
    );
    assert.equal(
      calls.filter((c) => c.method === "GET" && c.url.includes("/datasource/")).length,
      0,
      "must not look up legacy ds_type",
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("scanMetadata: surfaces vega 404 with HttpError", async () => {
  stubFetch(() => new Response("not found", { status: 404, statusText: "Not Found" }));

  try {
    await assert.rejects(
      () =>
        scanMetadata({
          baseUrl: "https://h.example",
          accessToken: "tok",
          id: "missing",
          businessDomain: "bd_public",
        }),
      /404/,
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});
```

- [ ] **Step 2.2: Run, expect FAIL**

Run:

```bash
pnpm -C packages/typescript exec node --test test/datasources-scan.test.ts 2>&1 | tail -20
```

Expected: FAIL — `scanMetadata` still hits `/data-connection/v1/metadata/scan`, so the unexpected-url branch throws.

---

## Task 3: TS — Implement migrated `scanMetadata` & simplify `scanDatasourceMetadata`

**Files:**
- Modify: `packages/typescript/src/api/datasources.ts:378-452`

- [ ] **Step 3.1: Replace `scanMetadata` body and `scanDatasourceMetadata` body**

In `packages/typescript/src/api/datasources.ts`, replace the block from `export interface ScanMetadataOptions {` (line ~378) through end of `scanDatasourceMetadata` (line ~452) with:

```typescript
import { discoverVegaCatalog } from "./vega.js";

export interface ScanMetadataOptions {
  baseUrl: string;
  accessToken: string;
  id: string;
  /** Retained for signature compatibility; ignored — vega catalog already knows its connector_type. */
  dsType?: string;
  businessDomain?: string;
}

/**
 * Trigger a metadata scan for a vega catalog and wait for completion.
 * `id` is a **vega catalog id** (e.g. `d7nicrcjto2s73d9g67g`), not a legacy
 * data-connection datasource UUID.
 */
export async function scanMetadata(options: ScanMetadataOptions): Promise<string> {
  const { baseUrl, accessToken, id, businessDomain = "bd_public" } = options;
  return discoverVegaCatalog({
    baseUrl,
    accessToken,
    id,
    wait: true,
    businessDomain,
  });
}

export interface ScanDatasourceMetadataOptions {
  baseUrl: string;
  accessToken: string;
  id: string;
  businessDomain?: string;
}

/**
 * Trigger a metadata scan and wait for completion. `id` is a vega catalog id.
 *
 * Historically this looked up the legacy `ds_type` to build a data-connection
 * scan body; vega catalogs already carry their own `connector_type`, so the
 * lookup is gone.
 */
export async function scanDatasourceMetadata(
  options: ScanDatasourceMetadataOptions,
): Promise<string> {
  return scanMetadata(options);
}
```

Note: the `import { discoverVegaCatalog }` line goes at the top of the file with the other imports (don't keep it inline). If TS already had no `vega.js` import, add it next to the existing imports.

- [ ] **Step 3.2: Run, expect PASS**

Run:

```bash
pnpm -C packages/typescript exec node --test test/datasources-scan.test.ts 2>&1 | tail -20
```

Expected: 3 tests pass.

- [ ] **Step 3.3: Commit**

```bash
git add packages/typescript/src/api/datasources.ts packages/typescript/test/datasources-scan.test.ts
git commit -m "$(cat <<'EOF'
feat(sdk-ts): migrate scanMetadata to vega discoverVegaCatalog

scanMetadata and scanDatasourceMetadata now POST /api/vega-backend/v1/catalogs/{id}/discover?wait=true.
Drops the legacy GET-datasource then POST-scan dance — vega catalogs carry
their own connector_type. id semantics: now a vega catalog id, not a
data-connection datasource UUID. Public signatures unchanged.

Refs #114.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: TS — Rewrite `listTablesWithColumns` test for vega resources flow

**Files:**
- Test: `packages/typescript/test/datasources-pk-propagation.test.ts` (overwrite)

- [ ] **Step 4.1: Replace test file**

Overwrite `packages/typescript/test/datasources-pk-propagation.test.ts` with:

```typescript
import test from "node:test";
import assert from "node:assert/strict";

import { listTablesWithColumns } from "../src/api/datasources.js";

const originalFetch = globalThis.fetch;

function stubFetch(handler: (url: string, init?: RequestInit) => Response | Promise<Response>) {
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    return handler(url, init);
  }) as typeof fetch;
}

// Vega resource detail shape — confirmed against admin platform 2026-05-08:
// GET /api/vega-backend/v1/resources/{id} returns
//   { id, name, category, source_metadata: { columns: [...] }, ... }
// where each column has { name, type, orig_type, column_key, ... }.

function resourceListResponse(catalogId: string, items: Array<{ id: string; name: string }>) {
  return new Response(
    JSON.stringify({
      entries: items.map((it) => ({
        id: it.id,
        catalog_id: catalogId,
        name: it.name,
        category: "table",
      })),
      total_count: items.length,
    }),
    { status: 200 },
  );
}

function resourceDetailResponse(
  rid: string,
  name: string,
  columns: Array<Record<string, unknown>>,
  extra: Record<string, unknown> = {},
) {
  return new Response(
    JSON.stringify({
      entries: [
        {
          id: rid,
          name,
          category: "table",
          source_metadata: { columns },
          ...extra,
        },
      ],
    }),
    { status: 200 },
  );
}

test("listTablesWithColumns: vega resources list + per-resource detail → table shape", async () => {
  stubFetch((url) => {
    if (url.includes("/vega-backend/v1/catalogs/cat-1/resources")) {
      return resourceListResponse("cat-1", [{ id: "r1", name: "skills" }]);
    }
    if (url.includes("/vega-backend/v1/resources/r1")) {
      return resourceDetailResponse("r1", "skills", [
        { name: "skill_id", type: "varchar", is_primary_key: true },
        { name: "label", type: "varchar" },
      ]);
    }
    throw new Error(`unexpected url ${url}`);
  });

  try {
    const body = await listTablesWithColumns({
      baseUrl: "https://h.example",
      accessToken: "tok",
      id: "cat-1",
    });
    const tables = JSON.parse(body) as Array<{
      name: string;
      columns: Array<{ name: string; type: string; isPrimaryKey?: boolean }>;
      primaryKeys?: string[];
    }>;
    assert.equal(tables.length, 1);
    assert.equal(tables[0]!.name, "skills");
    const cols = tables[0]!.columns;
    assert.equal(cols.find((c) => c.name === "skill_id")!.isPrimaryKey, true);
    assert.notEqual(cols.find((c) => c.name === "label")!.isPrimaryKey, true);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("listTablesWithColumns: column_key='PRI' propagates as isPrimaryKey", async () => {
  stubFetch((url) => {
    if (url.includes("/vega-backend/v1/catalogs/cat-1/resources")) {
      return resourceListResponse("cat-1", [{ id: "r1", name: "skills" }]);
    }
    if (url.includes("/vega-backend/v1/resources/r1")) {
      return resourceDetailResponse("r1", "skills", [
        { name: "skill_id", type: "varchar", column_key: "PRI" },
        { name: "label", type: "varchar", column_key: "" },
      ]);
    }
    throw new Error(`unexpected url ${url}`);
  });

  try {
    const body = await listTablesWithColumns({
      baseUrl: "https://h.example",
      accessToken: "tok",
      id: "cat-1",
    });
    const tables = JSON.parse(body);
    const cols = tables[0].columns;
    assert.equal(cols.find((c: { name: string }) => c.name === "skill_id").isPrimaryKey, true);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("listTablesWithColumns: table-level primary_keys[] surfaces as primaryKeys", async () => {
  stubFetch((url) => {
    if (url.includes("/vega-backend/v1/catalogs/cat-1/resources")) {
      return resourceListResponse("cat-1", [{ id: "r1", name: "orders" }]);
    }
    if (url.includes("/vega-backend/v1/resources/r1")) {
      return resourceDetailResponse(
        "r1",
        "orders",
        [
          { name: "order_id", type: "integer" },
          { name: "tenant_id", type: "varchar" },
        ],
        { primary_keys: ["order_id", "tenant_id"] },
      );
    }
    throw new Error(`unexpected url ${url}`);
  });

  try {
    const body = await listTablesWithColumns({
      baseUrl: "https://h.example",
      accessToken: "tok",
      id: "cat-1",
    });
    const tables = JSON.parse(body);
    assert.deepEqual(tables[0].primaryKeys, ["order_id", "tenant_id"]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("listTablesWithColumns: empty resources + autoScan triggers discover then re-lists", async () => {
  let listCalls = 0;
  let discoverCalls = 0;
  stubFetch((url, init) => {
    if (url.includes("/vega-backend/v1/catalogs/cat-1/resources") && (init?.method ?? "GET") === "GET") {
      listCalls += 1;
      if (listCalls === 1) {
        return resourceListResponse("cat-1", []);
      }
      return resourceListResponse("cat-1", [{ id: "r1", name: "skills" }]);
    }
    if (url.includes("/vega-backend/v1/catalogs/cat-1/discover")) {
      discoverCalls += 1;
      return new Response(JSON.stringify({ task_id: "task-1" }), { status: 200 });
    }
    if (url.includes("/vega-backend/v1/resources/r1")) {
      return resourceDetailResponse("r1", "skills", [{ name: "skill_id", type: "varchar" }]);
    }
    throw new Error(`unexpected url ${url}`);
  });

  try {
    const body = await listTablesWithColumns({
      baseUrl: "https://h.example",
      accessToken: "tok",
      id: "cat-1",
      autoScan: true,
    });
    const tables = JSON.parse(body);
    assert.equal(tables.length, 1);
    assert.equal(discoverCalls, 1, "discover called exactly once");
    assert.equal(listCalls, 2, "resources list called twice (initial + post-scan)");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("listTablesWithColumns: per-resource fetch failure surfaces (not silently dropped)", async () => {
  stubFetch((url) => {
    if (url.includes("/vega-backend/v1/catalogs/cat-1/resources")) {
      return resourceListResponse("cat-1", [
        { id: "r1", name: "skills" },
        { id: "r2", name: "orders" },
      ]);
    }
    if (url.includes("/vega-backend/v1/resources/r1")) {
      return resourceDetailResponse("r1", "skills", [{ name: "id", type: "integer" }]);
    }
    if (url.includes("/vega-backend/v1/resources/r2")) {
      return new Response("boom", { status: 500, statusText: "Internal Server Error" });
    }
    throw new Error(`unexpected url ${url}`);
  });

  try {
    await assert.rejects(
      () =>
        listTablesWithColumns({
          baseUrl: "https://h.example",
          accessToken: "tok",
          id: "cat-1",
        }),
      /500|r2/,
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});
```

- [ ] **Step 4.2: Run, expect FAIL**

Run:

```bash
pnpm -C packages/typescript exec node --test test/datasources-pk-propagation.test.ts 2>&1 | tail -30
```

Expected: FAIL — `listTablesWithColumns` still hits `/data-connection/v1/metadata/data-source/...`.

---

## Task 5: TS — Implement migrated `listTablesWithColumns`

**Files:**
- Modify: `packages/typescript/src/api/datasources.ts:275-376` (replace `listTablesWithColumns` body, retain `isColumnPrimaryKey` & `extractPrimaryKeys` helpers)

- [ ] **Step 5.1: Replace `listTablesWithColumns` body**

In `packages/typescript/src/api/datasources.ts`, replace the entire `listTablesWithColumns` function (line ~275 through ~354) with the implementation below. Keep the `isColumnPrimaryKey` and `extractPrimaryKeys` helpers (they sit just below the function).

Add a `listVegaCatalogResources, getVegaResource` import from `./vega.js` at the top of the file (next to the existing imports; merge with the `discoverVegaCatalog` import added in Task 3).

```typescript
export interface ListTablesWithColumnsOptions {
  baseUrl: string;
  accessToken: string;
  /** A vega catalog id, not a legacy data-connection datasource UUID. */
  id: string;
  keyword?: string;
  limit?: number;
  offset?: number;
  businessDomain?: string;
  autoScan?: boolean;
}

interface VegaResourceListEntry {
  id: string;
  name: string;
  category?: string;
}

interface VegaResourceDetail {
  id: string;
  name: string;
  source_metadata?: { columns?: Array<Record<string, unknown>> };
  primary_keys?: string[];
  [key: string]: unknown;
}

/**
 * List tables with column details from a vega catalog.
 *
 * Two-stage fetch:
 *   1. GET /api/vega-backend/v1/catalogs/{id}/resources?category=table — list summaries
 *   2. For each resource: GET /api/vega-backend/v1/resources/{rid} — pull source_metadata.columns
 *
 * If the catalog has no resources and `autoScan=true`, triggers a discover and
 * retries the list once.
 *
 * `id` is a **vega catalog id**.
 */
export async function listTablesWithColumns(
  options: ListTablesWithColumnsOptions,
): Promise<string> {
  const {
    baseUrl,
    accessToken,
    id,
    keyword,
    limit,
    offset,
    businessDomain = "bd_public",
    autoScan = true,
  } = options;

  async function listResourceSummaries(): Promise<VegaResourceListEntry[]> {
    const body = await listVegaCatalogResources({
      baseUrl,
      accessToken,
      id,
      category: "table",
      limit,
      offset,
      businessDomain,
    });
    const parsed = JSON.parse(body) as
      | Array<VegaResourceListEntry>
      | { entries?: VegaResourceListEntry[]; data?: VegaResourceListEntry[] };
    let items = Array.isArray(parsed) ? parsed : (parsed.entries ?? parsed.data ?? []);
    if (keyword) {
      const k = keyword.toLowerCase();
      items = items.filter((it) => it.name.toLowerCase().includes(k));
    }
    return items;
  }

  let summaries = await listResourceSummaries();
  if (summaries.length === 0 && autoScan) {
    await scanMetadata({ baseUrl, accessToken, id, businessDomain });
    summaries = await listResourceSummaries();
  }

  const details = await Promise.all(
    summaries.map(async (s) => {
      const body = await getVegaResource({
        baseUrl,
        accessToken,
        id: s.id,
        businessDomain,
      });
      const parsed = JSON.parse(body) as
        | VegaResourceDetail
        | { entries?: VegaResourceDetail[]; data?: VegaResourceDetail[] };
      if (Array.isArray((parsed as { entries?: unknown }).entries)) {
        const arr = (parsed as { entries: VegaResourceDetail[] }).entries;
        if (arr.length === 0) {
          throw new Error(`vega resource ${s.id} returned empty entries`);
        }
        return arr[0]!;
      }
      if (Array.isArray((parsed as { data?: unknown }).data)) {
        const arr = (parsed as { data: VegaResourceDetail[] }).data;
        if (arr.length === 0) {
          throw new Error(`vega resource ${s.id} returned empty data`);
        }
        return arr[0]!;
      }
      return parsed as VegaResourceDetail;
    }),
  );

  const tables: Array<{
    name: string;
    columns: Array<{ name: string; type: string; comment?: string; isPrimaryKey?: boolean }>;
    primaryKeys?: string[];
  }> = [];

  for (const d of details) {
    const columnsRaw = (d.source_metadata?.columns ?? []) as Array<Record<string, unknown>>;
    const tablePkArray = extractPrimaryKeys(d as unknown as Record<string, unknown>);
    const columns = columnsRaw.map((c) => {
      const name = String(c.name ?? c.field_name ?? "");
      const flagged = isColumnPrimaryKey(c) || tablePkArray.includes(name);
      return {
        name,
        type: String(c.type ?? c.field_type ?? "varchar"),
        comment: typeof c.description === "string"
          ? c.description
          : (typeof c.comment === "string" ? c.comment : undefined),
        ...(flagged ? { isPrimaryKey: true } : {}),
      };
    });
    const synthesizedPks = tablePkArray.length > 0
      ? tablePkArray
      : columns.filter((c) => c.isPrimaryKey).map((c) => c.name);

    tables.push({
      name: d.name,
      columns,
      ...(synthesizedPks.length > 0 ? { primaryKeys: synthesizedPks } : {}),
    });
  }

  return JSON.stringify(tables);
}
```

The original `listTables` function (data-connection) stays intact — `kweaver ds tables` still uses it.

- [ ] **Step 5.2: Run, expect PASS**

Run:

```bash
pnpm -C packages/typescript exec node --test test/datasources-pk-propagation.test.ts 2>&1 | tail -30
```

Expected: 5 tests pass.

- [ ] **Step 5.3: Run full TS test suite**

Run:

```bash
pnpm -C packages/typescript test 2>&1 | tail -30
```

Expected: all tests pass. Existing tests in `bkn-create-from-ds.test.ts`, `ds-connect-dedup.test.ts`, `ds-import-csv.test.ts` should still pass (they don't depend on the migrated functions' wire format).

- [ ] **Step 5.4: Commit**

```bash
git add packages/typescript/src/api/datasources.ts packages/typescript/test/datasources-pk-propagation.test.ts
git commit -m "$(cat <<'EOF'
feat(sdk-ts): migrate listTablesWithColumns to vega catalogs

Two-stage fetch: GET /catalogs/{id}/resources?category=table then per-resource
GET /resources/{rid}, extracting source_metadata.columns. Concurrent N+1 with
Promise.all. PK extraction logic (is_primary_key / column_key=PRI / table-level
primary_keys[]) preserved verbatim. id is now a vega catalog id; return shape
unchanged for downstream parity.

Refs #114.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: Python — Migrate `DataSourcesResource.scan_metadata` (TDD)

**Files:**
- Modify: `packages/python/src/kweaver/resources/datasources.py` — `scan_metadata` method (lines ~114-139)
- Test: `packages/python/tests/unit/test_datasources.py` — add scan_metadata test

- [ ] **Step 6.1: Add failing test**

Append to `packages/python/tests/unit/test_datasources.py`:

```python
def test_scan_metadata_calls_vega_discover(capture: RequestCapture):
    def handler(req: httpx.Request) -> httpx.Response:
        if req.method == "POST" and "/vega-backend/v1/catalogs/cat-1/discover" in str(req.url):
            return httpx.Response(200, json={"task_id": "vega-task-1"})
        raise AssertionError(f"unexpected {req.method} {req.url}")

    client = make_client(handler, capture)
    result = client.datasources.scan_metadata("cat-1")
    assert "vega-task-1" in result or result == "vega-task-1" or "task_id" in result
    # wait=true must be in the query
    last_url = capture.last_url()
    assert "wait=true" in last_url, f"expected wait=true in {last_url}"
    # must NOT touch data-connection
    for call in capture.all_urls():
        assert "/data-connection/" not in call, f"unexpected data-connection call: {call}"
```

If `RequestCapture` doesn't have `all_urls()`, inspect `tests/conftest.py` and add the helper, or replace the assertion with iterating `capture.records` (the existing capture pattern).

- [ ] **Step 6.2: Run, expect FAIL**

Run:

```bash
cd packages/python && python -m pytest tests/unit/test_datasources.py::test_scan_metadata_calls_vega_discover -xvs 2>&1 | tail -20
```

Expected: FAIL — current `scan_metadata` calls `/api/data-connection/v1/datasource/...` first.

- [ ] **Step 6.3: Replace `scan_metadata` impl**

In `packages/python/src/kweaver/resources/datasources.py`, replace the `scan_metadata` method (lines ~114-139) with:

```python
    def scan_metadata(self, id: str, *, ds_type: str = "mysql") -> str:
        """Trigger a metadata scan for a vega catalog and wait for completion.

        `id` is a **vega catalog id** (e.g. ``d7nicrcjto2s73d9g67g``), not a
        legacy data-connection datasource UUID. ``ds_type`` is retained for
        signature compatibility but ignored — vega catalogs carry their own
        ``connector_type``.

        Returns the discover endpoint's response body as a JSON string.
        """
        import json as _json

        result = self._http.post(
            f"/api/vega-backend/v1/catalogs/{id}/discover",
            params={"wait": "true"},
        )
        if isinstance(result, str):
            return result
        return _json.dumps(result)
```

If `self._http.post` already returns dict on JSON responses, the conversion at the end yields a JSON string — matching the TS function's `Promise<string>` return for parity.

If the test asserts on `"task_id" in result`, the JSON-stringified payload satisfies it.

- [ ] **Step 6.4: Run, expect PASS**

Run:

```bash
cd packages/python && python -m pytest tests/unit/test_datasources.py::test_scan_metadata_calls_vega_discover -xvs 2>&1 | tail -10
```

Expected: PASS.

- [ ] **Step 6.5: Commit**

```bash
git add packages/python/src/kweaver/resources/datasources.py packages/python/tests/unit/test_datasources.py
git commit -m "$(cat <<'EOF'
feat(sdk-py): migrate DataSourcesResource.scan_metadata to vega discover

POSTs /api/vega-backend/v1/catalogs/{id}/discover?wait=true. Drops the legacy
get-then-scan dance — vega catalogs carry their own connector_type. id is now
a vega catalog id. ds_type kwarg retained for signature compatibility but
ignored.

Refs #114.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 7: Python — Migrate `DataSourcesResource.list_tables` (TDD)

**Files:**
- Modify: `packages/python/src/kweaver/resources/datasources.py` — `list_tables` method (lines ~141-200)
- Test: `packages/python/tests/unit/test_datasources.py` — replace `test_list_tables`

- [ ] **Step 7.1: Replace existing `test_list_tables` and add new cases**

In `packages/python/tests/unit/test_datasources.py`, replace `test_list_tables` (and any other list_tables tests) with:

```python
def test_list_tables_via_vega_resources(capture: RequestCapture):
    def handler(req: httpx.Request) -> httpx.Response:
        url = str(req.url)
        if "/vega-backend/v1/catalogs/cat-1/resources" in url and req.method == "GET":
            return httpx.Response(
                200,
                json={
                    "entries": [
                        {"id": "r1", "catalog_id": "cat-1", "name": "skills", "category": "table"},
                        {"id": "r2", "catalog_id": "cat-1", "name": "orders", "category": "table"},
                    ],
                    "total_count": 2,
                },
            )
        if "/vega-backend/v1/resources/r1" in url:
            return httpx.Response(
                200,
                json={
                    "entries": [
                        {
                            "id": "r1",
                            "name": "skills",
                            "category": "table",
                            "source_metadata": {
                                "columns": [
                                    {"name": "skill_id", "type": "varchar"},
                                    {"name": "label", "type": "varchar"},
                                ]
                            },
                        }
                    ]
                },
            )
        if "/vega-backend/v1/resources/r2" in url:
            return httpx.Response(
                200,
                json={
                    "entries": [
                        {
                            "id": "r2",
                            "name": "orders",
                            "category": "table",
                            "source_metadata": {"columns": []},
                        }
                    ]
                },
            )
        raise AssertionError(f"unexpected {req.method} {req.url}")

    client = make_client(handler, capture)
    tables = client.datasources.list_tables("cat-1", auto_scan=False)
    names = sorted(t.name for t in tables)
    assert names == ["orders", "skills"]
    skills = next(t for t in tables if t.name == "skills")
    assert [c.name for c in skills.columns] == ["skill_id", "label"]
    # must NOT touch data-connection
    for call in capture.all_urls():
        assert "/data-connection/" not in call, f"leak: {call}"


def test_list_tables_empty_with_auto_scan_triggers_discover(capture: RequestCapture):
    list_calls = {"n": 0}

    def handler(req: httpx.Request) -> httpx.Response:
        url = str(req.url)
        if "/vega-backend/v1/catalogs/cat-1/resources" in url and req.method == "GET":
            list_calls["n"] += 1
            if list_calls["n"] == 1:
                return httpx.Response(200, json={"entries": [], "total_count": 0})
            return httpx.Response(
                200,
                json={
                    "entries": [
                        {"id": "r1", "catalog_id": "cat-1", "name": "skills", "category": "table"}
                    ],
                    "total_count": 1,
                },
            )
        if "/vega-backend/v1/catalogs/cat-1/discover" in url and req.method == "POST":
            return httpx.Response(200, json={"task_id": "t1"})
        if "/vega-backend/v1/resources/r1" in url:
            return httpx.Response(
                200,
                json={
                    "entries": [
                        {
                            "id": "r1",
                            "name": "skills",
                            "source_metadata": {
                                "columns": [{"name": "id", "type": "integer"}]
                            },
                        }
                    ]
                },
            )
        raise AssertionError(f"unexpected {req.method} {req.url}")

    client = make_client(handler, capture)
    tables = client.datasources.list_tables("cat-1", auto_scan=True)
    assert len(tables) == 1
    assert list_calls["n"] == 2
```

If `RequestCapture` lacks `all_urls()`, add it next to the existing helpers in `tests/conftest.py`:

```python
def all_urls(self) -> list[str]:
    return [str(r.url) for r in self.records]
```

- [ ] **Step 7.2: Run, expect FAIL**

Run:

```bash
cd packages/python && python -m pytest tests/unit/test_datasources.py -k "list_tables" -xvs 2>&1 | tail -20
```

Expected: FAIL on the new tests — current impl hits `/data-connection/`.

- [ ] **Step 7.3: Replace `list_tables` impl**

In `packages/python/src/kweaver/resources/datasources.py`, replace the `list_tables` method (lines ~141-200) with:

```python
    def list_tables(
        self,
        id: str,
        *,
        keyword: str | None = None,
        limit: int | None = None,
        offset: int | None = None,
        auto_scan: bool = True,
    ) -> list[Table]:
        """List tables with columns from a **vega catalog**.

        Two-stage fetch:
          1. GET /api/vega-backend/v1/catalogs/{id}/resources?category=table
          2. For each resource: GET /api/vega-backend/v1/resources/{rid}, pulling source_metadata.columns

        If the catalog has no table resources and `auto_scan=True`, triggers a
        discover and retries the list once.

        `id` is a **vega catalog id**.
        """

        def _list_summaries() -> list[dict[str, Any]]:
            params: dict[str, Any] = {"category": "table"}
            if limit is not None:
                params["limit"] = limit
            if offset is not None:
                params["offset"] = offset
            data = self._http.get(
                f"/api/vega-backend/v1/catalogs/{id}/resources",
                params=params,
            )
            items = (
                data
                if isinstance(data, list)
                else (data.get("entries") or data.get("data") or [])
            )
            if keyword:
                k = keyword.lower()
                items = [it for it in items if k in str(it.get("name", "")).lower()]
            return items

        summaries = _list_summaries()
        if not summaries and auto_scan:
            self.scan_metadata(id)
            summaries = _list_summaries()

        tables: list[Table] = []
        for s in summaries:
            rid = s.get("id", "")
            if not rid:
                continue
            detail_raw = self._http.get(f"/api/vega-backend/v1/resources/{rid}")
            detail = detail_raw
            if isinstance(detail_raw, dict):
                entries = detail_raw.get("entries") or detail_raw.get("data")
                if isinstance(entries, list) and entries:
                    detail = entries[0]
            if not isinstance(detail, dict):
                continue
            columns_raw = (detail.get("source_metadata") or {}).get("columns") or []
            tables.append(
                Table(
                    name=detail.get("name", s.get("name", "")),
                    columns=[
                        Column(
                            name=c.get("name", c.get("field_name", "")),
                            type=c.get("type", c.get("field_type", "varchar")),
                            comment=c.get("description") or c.get("comment"),
                        )
                        for c in columns_raw
                    ],
                )
            )
        return tables
```

- [ ] **Step 7.4: Run, expect PASS**

Run:

```bash
cd packages/python && python -m pytest tests/unit/test_datasources.py -xvs 2>&1 | tail -30
```

Expected: all tests in `test_datasources.py` pass — old `test_list_tables` was replaced; create / list / get / delete / test connectivity tests still pass (they touch the unmigrated paths).

- [ ] **Step 7.5: Commit**

```bash
git add packages/python/src/kweaver/resources/datasources.py packages/python/tests/unit/test_datasources.py packages/python/tests/conftest.py
git commit -m "$(cat <<'EOF'
feat(sdk-py): migrate DataSourcesResource.list_tables to vega catalogs

Two-stage fetch: GET /catalogs/{id}/resources?category=table then per-resource
GET /resources/{rid}, extracting source_metadata.columns. id is now a vega
catalog id; return shape unchanged.

Refs #114.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 8: TS — Add UUID-rejection guard for `bkn create-from-ds` and `bkn create-from-csv` (TDD)

**Files:**
- Test: `packages/typescript/test/bkn-create-from-ds.test.ts` (append cases)
- Modify: `packages/typescript/src/commands/bkn-ops.ts` — `parseKnCreateFromDsArgs` (~L588), `parseKnCreateFromCsvArgs` (~L985), and any usage / help banner

- [ ] **Step 8.1: Append failing tests**

Append to `packages/typescript/test/bkn-create-from-ds.test.ts`:

```typescript
test("parseKnCreateFromDsArgs: rejects legacy datasource UUID", () => {
  const uuid = "dfaf719c-4c41-4661-9ec9-25c263ff8c46";
  assert.throws(
    () =>
      parseKnCreateFromDsArgs([
        uuid,
        "--name",
        "kn1",
      ]),
    /vega catalog id/i,
  );
});

test("parseKnCreateFromDsArgs: accepts short vega catalog id", () => {
  const opts = parseKnCreateFromDsArgs([
    "d7nicrcjto2s73d9g67g",
    "--name",
    "kn1",
  ]);
  assert.equal(opts.dsId, "d7nicrcjto2s73d9g67g");
});

test("parseKnCreateFromCsvArgs: rejects legacy datasource UUID", () => {
  const uuid = "dfaf719c-4c41-4661-9ec9-25c263ff8c46";
  assert.throws(
    () =>
      parseKnCreateFromCsvArgs([
        uuid,
        "--name",
        "kn1",
        "--files",
        "/tmp/a.csv",
      ]),
    /vega catalog id/i,
  );
});
```

- [ ] **Step 8.2: Run, expect FAIL**

Run:

```bash
pnpm -C packages/typescript exec node --test test/bkn-create-from-ds.test.ts 2>&1 | tail -20
```

Expected: 3 new tests fail (UUIDs are accepted today).

- [ ] **Step 8.3: Add helper + wire into both parsers**

In `packages/typescript/src/commands/bkn-ops.ts`, near the top of the file (after imports), add:

```typescript
const UUID_V4_RE = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

function assertVegaCatalogId(id: string): void {
  if (UUID_V4_RE.test(id)) {
    throw new Error(
      `bkn create-from-ds expects a vega catalog id, got UUID '${id}'. ` +
      `This looks like a legacy data-connection datasource UUID. ` +
      `Run \`kweaver vega catalog list --keyword <name>\` to find the corresponding catalog id.`,
    );
  }
}
```

Then in `parseKnCreateFromDsArgs` (the function around line ~588), after `dsId` is finalized and before the final `return`, add:

```typescript
  assertVegaCatalogId(dsId);
```

Same line in `parseKnCreateFromCsvArgs` (around line ~985), after its `dsId` is finalized:

```typescript
  assertVegaCatalogId(dsId);
```

- [ ] **Step 8.4: Run, expect PASS**

Run:

```bash
pnpm -C packages/typescript exec node --test test/bkn-create-from-ds.test.ts 2>&1 | tail -20
```

Expected: all tests including new 3 pass.

- [ ] **Step 8.5: Update CLI usage / help string**

In `packages/typescript/src/commands/bkn-ops.ts`, locate the usage string for `kweaver bkn create-from-ds` (and `create-from-csv`) — typically a multi-line template literal printed when `--help` is passed or args are missing. Update the description of the positional argument from "datasource id" / "ds_id" to:

> vega catalog id (use `kweaver vega catalog list` to find one; legacy data-connection datasource UUIDs are no longer accepted)

Also check `packages/typescript/src/cli.ts` if it has help text for `bkn create-from-ds`/`create-from-csv` and update accordingly.

- [ ] **Step 8.6: Run full TS suite**

Run:

```bash
pnpm -C packages/typescript test 2>&1 | tail -30
```

Expected: all pass.

- [ ] **Step 8.7: Commit**

```bash
git add packages/typescript/src/commands/bkn-ops.ts packages/typescript/src/cli.ts packages/typescript/test/bkn-create-from-ds.test.ts
git commit -m "$(cat <<'EOF'
feat(bkn-ops): require vega catalog id for create-from-ds/create-from-csv

Adds UUID-shape prevalidation in both arg parsers. Rejects legacy
data-connection datasource UUIDs with a hint pointing users to
'kweaver vega catalog list'. Help text updated accordingly.

Refs #114.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 9: E2E validation on admin platform

**Files:** none (validation only)

- [ ] **Step 9.1: Authenticate**

Run:

```bash
kweaver auth use admin
kweaver auth whoami admin
```

Expected: token present, user `admin` on `https://115.190.186.186`.

- [ ] **Step 9.2: Pick a test catalog**

Run:

```bash
kweaver vega catalog list --limit 20 2>&1 | grep -E '"id"|"name"|"connector_type"|"type"' | head -40
```

Expected: pick a `type: physical` catalog with `connector_type: postgresql` or `mysql`. Note its `id`. The probed catalog `d7nicrcjto2s73d9g67g` (postgres_172_31_12_93) is a known working baseline.

- [ ] **Step 9.3: Run end-to-end via the migrated SDK**

Build the local TS SDK then invoke through the CLI in this worktree:

```bash
pnpm -C packages/typescript build
node packages/typescript/dist/cli.js bkn create-from-ds d7nicrcjto2s73d9g67g --name e2e_issue114_$(date +%s) --pretty 2>&1 | tail -40
```

Expected: BKN created, no `data-connection` URL appears in any verbose log path. If anything 404s, capture the exact URL and re-check the migration.

- [ ] **Step 9.4: Negative case — pass legacy UUID**

```bash
node packages/typescript/dist/cli.js bkn create-from-ds dfaf719c-4c41-4661-9ec9-25c263ff8c46 --name should_fail 2>&1 | tail -5
```

Expected: exits non-zero with the "looks like a legacy data-connection datasource UUID" hint.

- [ ] **Step 9.5: Python parity smoke**

```bash
cd packages/python
python -c "
from kweaver import KWeaverClient
import os
c = KWeaverClient(base_url=os.environ['KWEAVER_BASE_URL'], token=os.environ['KWEAVER_TOKEN'])
tables = c.datasources.list_tables('d7nicrcjto2s73d9g67g', auto_scan=False)
print(f'fetched {len(tables)} tables; first column of first table:', tables[0].columns[0].name if tables and tables[0].columns else 'n/a')
"
```

Expected: prints non-empty table count and a column name. (Set `KWEAVER_BASE_URL` / `KWEAVER_TOKEN` from `~/.kweaver/state.json` first; refer to the credentials memory.)

- [ ] **Step 9.6: Verify untouched paths still work**

```bash
node packages/typescript/dist/cli.js ds list --limit 3 2>&1 | tail -20
node packages/typescript/dist/cli.js ds tables dfaf719c-4c41-4661-9ec9-25c263ff8c46 2>&1 | tail -10
```

Expected: both succeed against data-connection (these were intentionally not migrated).

- [ ] **Step 9.7: No commit; record results in PR description**

E2E results go in the PR body. If anything fails, file a bug back to whichever task introduced the regression and re-execute.

---

## Task 10: Open PR

**Files:** none

- [ ] **Step 10.1: Push branch**

```bash
git push -u origin feat/issue-114-bkn-ds-vega-migration
```

- [ ] **Step 10.2: Open PR linking #114**

```bash
gh pr create --title "feat(sdk): migrate bkn create-from-ds path to vega catalogs (#114)" --body "$(cat <<'EOF'
## Summary
- Migrates the SDK functions `bkn create-from-ds` depends on (`listTablesWithColumns`, `scanMetadata`, and Python equivalents) from `data-connection` to `vega-backend` catalogs.
- `bkn create-from-ds` and `bkn create-from-csv` now expect a vega catalog id; legacy datasource UUIDs are rejected with a clear hint.
- Other ds subcommands (`ds list/get/connect/tables/delete`) intentionally remain on data-connection — see the spec for rationale.

## Test plan
- [ ] TS unit: `pnpm -C packages/typescript test`
- [ ] Python unit: `cd packages/python && python -m pytest tests/unit/test_datasources.py`
- [ ] E2E: `bkn create-from-ds <vega-catalog-id> --name e2e_…` on admin platform succeeds end-to-end with no data-connection traffic
- [ ] Negative: passing a UUID exits with the migration hint
- [ ] Untouched: `ds list` and `ds tables <legacy-uuid>` still work

Closes #114 (partial — see spec for the deliberately-deferred remainder).

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 10.3: Cleanup worktree (optional, after merge)**

```bash
cd /Users/xupeng/dev/github/kweaver-sdk
git worktree remove ../kweaver-sdk-issue-114
```

---

## Self-Review Notes

- Spec coverage: every spec section maps to a task — `listTablesWithColumns` → Tasks 4-5, `scanMetadata` → Tasks 2-3, Python parity → Tasks 6-7, `bkn-ops` UUID guard → Task 8, E2E → Task 9.
- No placeholders: every step contains exact code or commands.
- Type consistency: `assertVegaCatalogId` and `UUID_V4_RE` defined once in Task 8; `listVegaCatalogResources`/`getVegaResource`/`discoverVegaCatalog` are imported from the existing `api/vega.ts` (not redefined).
- Out of scope (per spec): `testDatasource`/`createDatasource`/`listDatasources`/`getDatasource`/`deleteDatasource`/`listTables`/`ds CLI` paths and `_crypto`/`makeBinData` are left untouched; no task modifies them.
