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
