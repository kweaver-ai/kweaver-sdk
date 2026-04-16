import test from "node:test";
import assert from "node:assert/strict";

import { KWeaverClient } from "../src/client.js";

const BASE = "https://mock.kweaver.test";
const TOKEN = "test-token-abc";

function makeClient(): KWeaverClient {
  return new KWeaverClient({ baseUrl: BASE, accessToken: TOKEN });
}

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

// ── client exposes new resources ────────────────────────────────────────────

test("KWeaverClient exposes datasources, dataviews, dataflows, vega resources", () => {
  const client = makeClient();
  assert.ok(client.datasources, "datasources resource exists");
  assert.ok(client.dataviews, "dataviews resource exists");
  assert.ok(client.dataflows, "dataflows resource exists");
  assert.ok(client.vega, "vega resource exists");
});

// ── DataSourcesResource ─────────────────────────────────────────────────────

test("datasources.list returns array from entries wrapper", async () => {
  const mock = mockFetch({ entries: [{ id: "ds-1", name: "MySQL" }] });
  try {
    const client = makeClient();
    const result = await client.datasources.list();
    assert.deepEqual(result, [{ id: "ds-1", name: "MySQL" }]);
    assert.equal(mock.calls[0].method, "GET");
  } finally {
    mock.restore();
  }
});

test("datasources.list returns plain array", async () => {
  const mock = mockFetch([{ id: "ds-2" }]);
  try {
    const result = await makeClient().datasources.list();
    assert.deepEqual(result, [{ id: "ds-2" }]);
  } finally {
    mock.restore();
  }
});

test("datasources.get returns parsed object", async () => {
  const mock = mockFetch({ id: "ds-1", name: "MySQL", type: "mysql" });
  try {
    const result = await makeClient().datasources.get("ds-1");
    assert.deepEqual(result, { id: "ds-1", name: "MySQL", type: "mysql" });
    assert.ok(mock.calls[0].url.includes("/ds-1"));
  } finally {
    mock.restore();
  }
});

test("datasources.delete sends DELETE request", async () => {
  const mock = mockFetch("", 200);
  try {
    await makeClient().datasources.delete("ds-1");
    assert.equal(mock.calls[0].method, "DELETE");
    assert.ok(mock.calls[0].url.includes("/ds-1"));
  } finally {
    mock.restore();
  }
});

test("datasources.listTables returns array", async () => {
  const mock = mockFetch({ entries: [{ id: "t1", name: "users" }] });
  try {
    const result = await makeClient().datasources.listTables("ds-1");
    assert.deepEqual(result, [{ id: "t1", name: "users" }]);
  } finally {
    mock.restore();
  }
});

// ── DataViewsResource ───────────────────────────────────────────────────────

test("dataviews.create returns view id", async () => {
  const mock = mockFetch([{ id: "dv-1" }]);
  try {
    const result = await makeClient().dataviews.create({
      name: "test-view",
      datasourceId: "ds-1",
      table: "users",
    });
    assert.ok(typeof result === "string");
    assert.equal(mock.calls[0].method, "POST");
  } finally {
    mock.restore();
  }
});

test("dataviews.get returns DataView", async () => {
  const mock = mockFetch({
    id: "dv-1",
    name: "test-view",
    query_type: "SQL",
    data_source_id: "ds-1",
    fields: [],
  });
  try {
    const result = await makeClient().dataviews.get("dv-1");
    assert.deepEqual(result, {
      id: "dv-1",
      name: "test-view",
      query_type: "SQL",
      datasource_id: "ds-1",
    });
  } finally {
    mock.restore();
  }
});

test("dataviews.list returns DataView[] from entries wrapper", async () => {
  const mock = mockFetch({
    entries: [
      {
        id: "dv-1",
        name: "users",
        query_type: "SQL",
        data_source_id: "ds-1",
        fields: [],
      },
    ],
  });
  try {
    const result = await makeClient().dataviews.list({ datasourceId: "ds-1" });
    assert.equal(result.length, 1);
    assert.equal(result[0].id, "dv-1");
    assert.equal(result[0].fields, undefined);
    assert.ok(mock.calls[0].url.includes("catalog_id=ds-1"));
  } finally {
    mock.restore();
  }
});

test("dataviews.delete sends DELETE request", async () => {
  const mock = mockFetch("", 200);
  try {
    await makeClient().dataviews.delete("dv-1");
    assert.equal(mock.calls[0].method, "DELETE");
    assert.ok(mock.calls[0].url.includes("/resources/dv-1"));
  } finally {
    mock.restore();
  }
});

test("dataviews.find exact returns match on first attempt", async () => {
  const mock = mockFetch({
    entries: [
      {
        id: "dv-1",
        name: "users",
        query_type: "SQL",
        data_source_id: "ds-1",
        fields: [],
      },
    ],
  });
  try {
    const result = await makeClient().dataviews.find("users", {
      datasourceId: "ds-1",
      exact: true,
      wait: false,
    });
    assert.equal(result.length, 1);
    assert.equal(result[0].name, "users");
    assert.ok(mock.calls[0].url.includes("keyword=users"));
  } finally {
    mock.restore();
  }
});

test("dataviews.find returns only exact matches when exact true", async () => {
  const mock = mockFetch({
    entries: [
      { id: "dv-1", name: "users", query_type: "SQL", data_source_id: "ds-1", fields: [] },
      { id: "dv-2", name: "users_archive", query_type: "SQL", data_source_id: "ds-1", fields: [] },
    ],
  });
  try {
    const result = await makeClient().dataviews.find("users", {
      datasourceId: "ds-1",
      exact: true,
      wait: false,
    });
    assert.equal(result.length, 1);
    assert.equal(result[0].name, "users");
  } finally {
    mock.restore();
  }
});

test("dataviews.find exact returns empty when wait false and not found", async () => {
  const mock = mockFetch({ entries: [] });
  try {
    const result = await makeClient().dataviews.find("missing", {
      datasourceId: "ds-1",
      exact: true,
      wait: false,
    });
    assert.equal(result.length, 0);
  } finally {
    mock.restore();
  }
});

test("dataviews.query sends POST to vega-backend resources data path", async () => {
  const mock = mockFetch({ columns: [], entries: [], total_count: 0 });
  try {
    await makeClient().dataviews.query("dv-1", { limit: 10, offset: 0 });
    assert.equal(mock.calls[0].method, "POST");
    assert.ok(mock.calls[0].url.includes("/api/vega-backend/v1/resources/dv-1/data"));
    const body = JSON.parse(mock.calls[0].body ?? "{}");
    assert.equal(body.limit, 10);
    assert.equal(body.offset, 0);
    assert.equal(body.need_total, false);
  } finally {
    mock.restore();
  }
});

test("dataviews.query passes sql in body when provided", async () => {
  const mock = mockFetch({ entries: [[1, "a"]] });
  try {
    await makeClient().dataviews.query("dv-2", {
      sql: "SELECT id FROM t",
      needTotal: true,
    });
    const body = JSON.parse(mock.calls[0].body ?? "{}");
    assert.equal(body.sql, "SELECT id FROM t");
    assert.equal(body.need_total, true);
  } finally {
    mock.restore();
  }
});

// ── DataflowsResource ──────────────────────────────────────────────────────

test("dataflows.create returns dag id", async () => {
  const mock = mockFetch({ id: "dag-001" });
  try {
    const result = await makeClient().dataflows.create({
      title: "test",
      trigger_config: { operator: "manual" },
      steps: [{ id: "s1", title: "step", operator: "op", parameters: {} }],
    });
    assert.equal(result, "dag-001");
    assert.equal(mock.calls[0].method, "POST");
  } finally {
    mock.restore();
  }
});

test("dataflows.run sends POST to run-instance", async () => {
  const mock = mockFetch({});
  try {
    await makeClient().dataflows.run("dag-001");
    assert.equal(mock.calls[0].method, "POST");
    assert.ok(mock.calls[0].url.includes("/run-instance/dag-001"));
  } finally {
    mock.restore();
  }
});

test("dataflows.delete sends DELETE (best-effort)", async () => {
  const mock = mockFetch("", 500);
  try {
    // Should not throw even on 500
    await makeClient().dataflows.delete("dag-001");
    assert.equal(mock.calls[0].method, "DELETE");
  } finally {
    mock.restore();
  }
});

// ── VegaResource ────────────────────────────────────────────────────────────

test("vega.health returns parsed response", async () => {
  const mock = mockFetch({ entries: [] });
  try {
    const result = await makeClient().vega.health();
    assert.ok(result && typeof result === "object");
  } finally {
    mock.restore();
  }
});

test("vega.listCatalogs returns array", async () => {
  const mock = mockFetch({ entries: [{ id: "cat-1", name: "PG Catalog" }] });
  try {
    const result = await makeClient().vega.listCatalogs();
    assert.deepEqual(result, [{ id: "cat-1", name: "PG Catalog" }]);
  } finally {
    mock.restore();
  }
});

test("vega.getCatalog returns parsed object", async () => {
  const mock = mockFetch({ id: "cat-1", name: "PG Catalog" });
  try {
    const result = await makeClient().vega.getCatalog("cat-1");
    assert.deepEqual(result, { id: "cat-1", name: "PG Catalog" });
  } finally {
    mock.restore();
  }
});

test("vega.listResources returns array", async () => {
  const mock = mockFetch({ data: [{ id: "res-1" }] });
  try {
    const result = await makeClient().vega.listResources();
    assert.deepEqual(result, [{ id: "res-1" }]);
  } finally {
    mock.restore();
  }
});

test("vega.listConnectorTypes returns array", async () => {
  const mock = mockFetch([{ type: "postgresql", name: "PostgreSQL" }]);
  try {
    const result = await makeClient().vega.listConnectorTypes();
    assert.deepEqual(result, [{ type: "postgresql", name: "PostgreSQL" }]);
  } finally {
    mock.restore();
  }
});

test("vega.getResource returns parsed object", async () => {
  const mock = mockFetch({ id: "res-1", name: "orders" });
  try {
    const result = await makeClient().vega.getResource("res-1");
    assert.deepEqual(result, { id: "res-1", name: "orders" });
  } finally {
    mock.restore();
  }
});

