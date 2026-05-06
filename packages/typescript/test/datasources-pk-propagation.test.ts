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

// ── Per-column PK propagation ─────────────────────────────────────────────────
// The bug: `listTablesWithColumns` reduces every column to {name, type, comment},
// silently dropping any PK indicator the backend exposes. The contract this test
// fixes: when the raw column carries a PK indicator under any of the well-known
// names, the SDK surfaces it as `isPrimaryKey: true`.

test("listTablesWithColumns: propagates is_primary_key from backend column", async () => {
  stubFetch((url) => {
    if (url.includes("/data-connection/v1/metadata/data-source/ds-1")) {
      return new Response(
        JSON.stringify([
          {
            name: "skills",
            columns: [
              { name: "skill_id", type: "varchar", is_primary_key: true },
              { name: "label", type: "varchar" },
            ],
          },
        ]),
        { status: 200 },
      );
    }
    throw new Error(`unexpected url ${url}`);
  });

  try {
    const body = await listTablesWithColumns({
      baseUrl: "https://h.example",
      accessToken: "tok",
      id: "ds-1",
    });
    const tables = JSON.parse(body) as Array<{
      name: string;
      columns: Array<{ name: string; type: string; isPrimaryKey?: boolean }>;
    }>;
    assert.equal(tables.length, 1);
    const cols = tables[0]!.columns;
    assert.equal(cols.find((c) => c.name === "skill_id")!.isPrimaryKey, true);
    assert.notEqual(cols.find((c) => c.name === "label")!.isPrimaryKey, true);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("listTablesWithColumns: propagates MySQL INFORMATION_SCHEMA column_key='PRI'", async () => {
  stubFetch((url) => {
    if (url.includes("/data-connection/v1/metadata/data-source/ds-1")) {
      return new Response(
        JSON.stringify([
          {
            name: "skills",
            columns: [
              { name: "skill_id", type: "varchar", column_key: "PRI" },
              { name: "label", type: "varchar", column_key: "" },
            ],
          },
        ]),
        { status: 200 },
      );
    }
    throw new Error(`unexpected url ${url}`);
  });

  try {
    const body = await listTablesWithColumns({
      baseUrl: "https://h.example",
      accessToken: "tok",
      id: "ds-1",
    });
    const tables = JSON.parse(body) as Array<{
      name: string;
      columns: Array<{ name: string; isPrimaryKey?: boolean }>;
    }>;
    assert.equal(tables[0]!.columns.find((c) => c.name === "skill_id")!.isPrimaryKey, true);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("listTablesWithColumns: propagates table-level primary_keys array", async () => {
  // Composite-PK case: backend emits primary_keys at table level, not per column.
  stubFetch((url) => {
    if (url.includes("/data-connection/v1/metadata/data-source/ds-1")) {
      return new Response(
        JSON.stringify([
          {
            name: "mat_skill",
            primary_keys: ["sku", "skill_id"],
            columns: [
              { name: "sku", type: "varchar" },
              { name: "skill_id", type: "varchar" },
              { name: "rank", type: "int" },
            ],
          },
        ]),
        { status: 200 },
      );
    }
    throw new Error(`unexpected url ${url}`);
  });

  try {
    const body = await listTablesWithColumns({
      baseUrl: "https://h.example",
      accessToken: "tok",
      id: "ds-1",
    });
    const tables = JSON.parse(body) as Array<{
      name: string;
      primaryKeys?: string[];
      columns: Array<{ name: string; isPrimaryKey?: boolean }>;
    }>;
    // Table-level array wins for composite PKs.
    assert.deepEqual(tables[0]!.primaryKeys, ["sku", "skill_id"]);
    // And the per-column flag is materialized so downstream callers can use either.
    const byName = Object.fromEntries(tables[0]!.columns.map((c) => [c.name, c]));
    assert.equal(byName.sku!.isPrimaryKey, true);
    assert.equal(byName.skill_id!.isPrimaryKey, true);
    assert.notEqual(byName.rank!.isPrimaryKey, true);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("listTablesWithColumns: leaves columns unflagged when backend returns no PK info", async () => {
  // Regression guard: today's behavior must keep working — sample-based detection
  // remains the fallback when backend doesn't expose PK metadata.
  stubFetch((url) => {
    if (url.includes("/data-connection/v1/metadata/data-source/ds-1")) {
      return new Response(
        JSON.stringify([
          {
            name: "skills",
            columns: [
              { name: "skill_id", type: "varchar" },
              { name: "label", type: "varchar" },
            ],
          },
        ]),
        { status: 200 },
      );
    }
    throw new Error(`unexpected url ${url}`);
  });

  try {
    const body = await listTablesWithColumns({
      baseUrl: "https://h.example",
      accessToken: "tok",
      id: "ds-1",
    });
    const tables = JSON.parse(body) as Array<{
      name: string;
      primaryKeys?: string[];
      columns: Array<{ name: string; isPrimaryKey?: boolean }>;
    }>;
    assert.equal(tables[0]!.primaryKeys, undefined);
    for (const c of tables[0]!.columns) {
      assert.notEqual(c.isPrimaryKey, true);
    }
  } finally {
    globalThis.fetch = originalFetch;
  }
});
