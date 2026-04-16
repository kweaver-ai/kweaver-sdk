import test from "node:test";
import assert from "node:assert/strict";

import {
  listDatasources,
  getDatasource,
  createDatasource,
  deleteDatasource,
  testDatasource,
  listTables,
  scanMetadata,
  listTablesWithColumns,
} from "../src/api/datasources.js";

const BASE = "https://mock.kweaver.test";
const TOKEN = "test-token-abc";

function mockFetch(response: unknown, statusCode = 200) {
  const orig = globalThis.fetch;
  const calls: Array<{ url: string; method: string; body?: string }> = [];

  globalThis.fetch = async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    const method = init?.method ?? "GET";
    const body = init?.body ? String(init.body) : undefined;
    calls.push({ url, method, body });
    const text = typeof response === "string" ? response : JSON.stringify(response);
    return new Response(text, { status: statusCode });
  };

  return { calls, restore: () => { globalThis.fetch = orig; } };
}

// ── listDatasources → GET /api/vega-backend/v1/catalogs ──────────────────────

test("listDatasources calls GET /api/vega-backend/v1/catalogs", async () => {
  const mock = mockFetch({ entries: [] });
  try {
    await listDatasources({ baseUrl: BASE, accessToken: TOKEN });
    assert.equal(mock.calls.length, 1);
    const url = new URL(mock.calls[0].url);
    assert.equal(url.pathname, "/api/vega-backend/v1/catalogs");
    assert.equal(mock.calls[0].method, "GET");
  } finally {
    mock.restore();
  }
});

test("listDatasources passes keyword and type as query params", async () => {
  const mock = mockFetch({ entries: [] });
  try {
    await listDatasources({ baseUrl: BASE, accessToken: TOKEN, keyword: "foo", type: "mysql" });
    const url = new URL(mock.calls[0].url);
    assert.equal(url.pathname, "/api/vega-backend/v1/catalogs");
    assert.equal(url.searchParams.get("keyword"), "foo");
    assert.equal(url.searchParams.get("type"), "mysql");
  } finally {
    mock.restore();
  }
});

// ── getDatasource → GET /api/vega-backend/v1/catalogs/{id} ───────────────────

test("getDatasource calls GET /api/vega-backend/v1/catalogs/{id}", async () => {
  const mock = mockFetch({ id: "ds-1", name: "test" });
  try {
    await getDatasource({ baseUrl: BASE, accessToken: TOKEN, id: "ds-1" });
    assert.equal(mock.calls.length, 1);
    const url = new URL(mock.calls[0].url);
    assert.equal(url.pathname, "/api/vega-backend/v1/catalogs/ds-1");
    assert.equal(mock.calls[0].method, "GET");
  } finally {
    mock.restore();
  }
});

// ── createDatasource → POST /api/vega-backend/v1/catalogs ────────────────────

test("createDatasource calls POST /api/vega-backend/v1/catalogs with connector_config body", async () => {
  const mock = mockFetch({ id: "new-1" }, 201);
  try {
    await createDatasource({
      baseUrl: BASE,
      accessToken: TOKEN,
      name: "my-ds",
      type: "mysql",
      host: "localhost",
      port: 3306,
      database: "testdb",
      account: "root",
      password: "secret",
    });
    assert.equal(mock.calls.length, 1);
    assert.equal(mock.calls[0].method, "POST");
    const url = new URL(mock.calls[0].url);
    assert.equal(url.pathname, "/api/vega-backend/v1/catalogs");
    const body = JSON.parse(mock.calls[0].body!);
    assert.equal(body.name, "my-ds");
    assert.equal(body.connector_type, "mysql");
    // Should use connector_config, not bin_data
    assert.ok(body.connector_config, "body should have connector_config");
    assert.equal(body.connector_config.host, "localhost");
    assert.equal(body.connector_config.port, 3306);
    // Vega expects "username" not "account", "databases" (array) not "database" (string)
    assert.equal(body.connector_config.username, "root", "should use username, not account");
    assert.deepEqual(body.connector_config.databases, ["testdb"], "should use databases array, not database string");
    assert.equal(body.connector_config.account, undefined, "should not use account");
    assert.equal(body.connector_config.database, undefined, "should not use database");
    assert.equal(body.bin_data, undefined, "should not use bin_data");
  } finally {
    mock.restore();
  }
});

test("createDatasource includes schema in connector_config when provided", async () => {
  const mock = mockFetch({ id: "new-2" }, 201);
  try {
    await createDatasource({
      baseUrl: BASE,
      accessToken: TOKEN,
      name: "pg-ds",
      type: "postgresql",
      host: "pghost",
      port: 5432,
      database: "mydb",
      account: "user",
      password: "pw",
      schema: "public",
    });
    const body = JSON.parse(mock.calls[0].body!);
    assert.equal(body.connector_config.schema, "public");
  } finally {
    mock.restore();
  }
});

// ── deleteDatasource → DELETE /api/vega-backend/v1/catalogs/{id} ─────────────

test("deleteDatasource calls DELETE /api/vega-backend/v1/catalogs/{id}", async () => {
  const mock = mockFetch("{}", 200);
  try {
    await deleteDatasource({ baseUrl: BASE, accessToken: TOKEN, id: "ds-99" });
    assert.equal(mock.calls.length, 1);
    assert.equal(mock.calls[0].method, "DELETE");
    const url = new URL(mock.calls[0].url);
    assert.equal(url.pathname, "/api/vega-backend/v1/catalogs/ds-99");
  } finally {
    mock.restore();
  }
});

// ── testDatasource → POST /api/vega-backend/v1/catalogs/{id}/test-connection ─

test("testDatasource calls POST /api/vega-backend/v1/catalogs/{id}/test-connection", async () => {
  const mock = mockFetch({ status: "ok" });
  try {
    await testDatasource({ baseUrl: BASE, accessToken: TOKEN, id: "ds-1" });
    assert.equal(mock.calls.length, 1);
    assert.equal(mock.calls[0].method, "POST");
    const url = new URL(mock.calls[0].url);
    assert.equal(url.pathname, "/api/vega-backend/v1/catalogs/ds-1/test-connection");
  } finally {
    mock.restore();
  }
});

// ── listTables → GET /api/vega-backend/v1/catalogs/{id}/resources ────────────

test("listTables calls GET /api/vega-backend/v1/catalogs/{id}/resources", async () => {
  const mock = mockFetch({ entries: [] });
  try {
    await listTables({ baseUrl: BASE, accessToken: TOKEN, id: "ds-1" });
    assert.equal(mock.calls.length, 1);
    assert.equal(mock.calls[0].method, "GET");
    const url = new URL(mock.calls[0].url);
    assert.equal(url.pathname, "/api/vega-backend/v1/catalogs/ds-1/resources");
  } finally {
    mock.restore();
  }
});

test("listTables passes keyword, limit, offset as query params", async () => {
  const mock = mockFetch({ entries: [] });
  try {
    await listTables({ baseUrl: BASE, accessToken: TOKEN, id: "ds-1", keyword: "users", limit: 10, offset: 5 });
    const url = new URL(mock.calls[0].url);
    assert.equal(url.pathname, "/api/vega-backend/v1/catalogs/ds-1/resources");
    assert.equal(url.searchParams.get("keyword"), "users");
    assert.equal(url.searchParams.get("limit"), "10");
    assert.equal(url.searchParams.get("offset"), "5");
  } finally {
    mock.restore();
  }
});

// ── scanMetadata → POST /api/vega-backend/v1/catalogs/{id}/discover ──────────

test("scanMetadata calls POST /api/vega-backend/v1/catalogs/{id}/discover", async () => {
  const mock = mockFetch({ status: "success" });
  try {
    await scanMetadata({ baseUrl: BASE, accessToken: TOKEN, id: "ds-1" });
    assert.equal(mock.calls.length, 1);
    assert.equal(mock.calls[0].method, "POST");
    const url = new URL(mock.calls[0].url);
    assert.equal(url.pathname, "/api/vega-backend/v1/catalogs/ds-1/discover");
    // Should use wait=true for synchronous discovery
    assert.equal(url.searchParams.get("wait"), "true");
  } finally {
    mock.restore();
  }
});

// ── listTablesWithColumns → catalogs/{id}/resources + resource fields ────────

test("listTablesWithColumns fetches resource detail when list has no columns", async () => {
  // Simulates real vega-backend: list returns resources without fields,
  // column info is in GET /resources/{id} under source_metadata.columns
  const orig = globalThis.fetch;
  const calls: Array<{ url: string; method: string }> = [];

  globalThis.fetch = async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    const method = init?.method ?? "GET";
    calls.push({ url, method });

    // List resources: returns entries without fields/columns
    if (url.includes("/catalogs/ds-1/resources")) {
      return new Response(JSON.stringify({
        entries: [
          { id: "res-1", name: "users" },
          { id: "res-2", name: "orders" },
        ],
      }), { status: 200 });
    }
    // Resource detail for res-1 — real vega-backend wraps in { entries: [...] }
    if (url.includes("/resources/res-1")) {
      return new Response(JSON.stringify({
        entries: [{
          id: "res-1",
          name: "users",
          source_metadata: {
            columns: [
              { name: "id", type: "int" },
              { name: "email", type: "varchar", comment: "user email" },
            ],
          },
        }],
      }), { status: 200 });
    }
    // Resource detail for res-2
    if (url.includes("/resources/res-2")) {
      return new Response(JSON.stringify({
        entries: [{
          id: "res-2",
          name: "orders",
          source_metadata: {
            columns: [
              { name: "order_id", type: "bigint" },
            ],
          },
        }],
      }), { status: 200 });
    }
    return new Response("{}", { status: 200 });
  };

  try {
    const raw = await listTablesWithColumns({ baseUrl: BASE, accessToken: TOKEN, id: "ds-1" });
    const tables = JSON.parse(raw) as Array<{ name: string; columns: Array<{ name: string; type: string; comment?: string }> }>;

    assert.equal(tables.length, 2);
    assert.equal(tables[0].name, "users");
    assert.equal(tables[0].columns.length, 2);
    assert.equal(tables[0].columns[0].name, "id");
    assert.equal(tables[0].columns[1].name, "email");
    assert.equal(tables[0].columns[1].comment, "user email");
    assert.equal(tables[1].name, "orders");
    assert.equal(tables[1].columns.length, 1);
    assert.equal(tables[1].columns[0].name, "order_id");

    // Should have called: list resources, then GET resource detail for each
    assert.ok(calls.length >= 3, `expected at least 3 calls (list + 2 details), got ${calls.length}`);
    assert.ok(calls.some(c => c.url.includes("/resources/res-1")), "should fetch res-1 detail");
    assert.ok(calls.some(c => c.url.includes("/resources/res-2")), "should fetch res-2 detail");
  } finally {
    globalThis.fetch = orig;
  }
});

test("listTablesWithColumns triggers discover when no resources found and autoScan=true", async () => {
  let callCount = 0;
  const orig = globalThis.fetch;
  const calls: Array<{ url: string; method: string }> = [];

  globalThis.fetch = async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    const method = init?.method ?? "GET";
    calls.push({ url, method });
    callCount++;

    if (callCount === 1) {
      // First call: list resources returns empty
      return new Response(JSON.stringify({ entries: [] }), { status: 200 });
    }
    if (method === "POST" && url.includes("/discover")) {
      // Second call: discover
      return new Response(JSON.stringify({ status: "success" }), { status: 200 });
    }
    // Third call: list resources again after discover
    return new Response(JSON.stringify({
      entries: [{ id: "res-1", name: "orders", fields: [{ name: "id", type: "int" }] }],
    }), { status: 200 });
  };

  try {
    const raw = await listTablesWithColumns({ baseUrl: BASE, accessToken: TOKEN, id: "ds-1" });
    const tables = JSON.parse(raw);
    assert.equal(tables.length, 1);
    assert.equal(tables[0].name, "orders");

    // Should have called: list resources, discover, list resources again
    assert.ok(calls.length >= 2, `expected at least 2 calls, got ${calls.length}`);
    assert.ok(calls.some(c => c.url.includes("/discover") && c.method === "POST"), "should call discover");
  } finally {
    globalThis.fetch = orig;
  }
});
