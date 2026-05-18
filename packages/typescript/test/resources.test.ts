import test from "node:test";
import assert from "node:assert/strict";

import { KWeaverClient } from "../src/client.js";
import { listResources } from "../src/api/resources.js";

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
    // 204/205/304 are null-body statuses; Response constructor rejects a body for them
    const nullBody = statusCode === 204 || statusCode === 205 || statusCode === 304;
    return new Response(nullBody ? null : text, { status: statusCode });
  };

  return { calls, restore: () => { globalThis.fetch = orig; } };
}

// ── client exposes new resources ────────────────────────────────────────────

test("KWeaverClient exposes datasources, resources, dataflows, vega, models resources", () => {
  const client = makeClient();
  assert.ok(client.datasources, "datasources resource exists");
  assert.ok(client.resources, "resources resource exists");
  assert.ok(client.dataflows, "dataflows resource exists");
  assert.ok(client.vega, "vega resource exists");
  assert.ok(client.models, "models resource exists");
  assert.ok(client.models.llm, "models.llm exists");
  assert.ok(client.models.small, "models.small exists");
  assert.ok(client.models.invocation, "models.invocation exists");
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

// ── ResourcesResource ───────────────────────────────────────────────────────

test("dataviews.create POSTs to vega-backend /resources with category=table", async () => {
  const mock = mockFetch({ id: "dv-1", name: "test-view", catalog_id: "ds-1", category: "table" });
  try {
    const result = await makeClient().resources.create({
      name: "test-view",
      datasourceId: "ds-1",
      table: "users",
    });
    assert.ok(typeof result === "string");
    assert.equal(result, "dv-1");
    assert.equal(mock.calls[0].method, "POST");
    assert.ok(mock.calls[0].url.includes("/api/vega-backend/v1/resources"));
    const body = JSON.parse(mock.calls[0].body ?? "{}");
    assert.equal(body.catalog_id, "ds-1");
    assert.equal(body.category, "table");
    assert.equal(body.source_identifier, "users");
  } finally {
    mock.restore();
  }
});

test("dataviews.get GETs from vega-backend /resources/{id}", async () => {
  const mock = mockFetch({
    entries: [{
      id: "dv-1",
      name: "test-view",
      catalog_id: "ds-1",
      category: "table",
      source_identifier: "users",
      status: "active",
      schema_definition: [],
    }],
  });
  try {
    const result = await makeClient().resources.get("dv-1");
    assert.equal(result.id, "dv-1");
    assert.equal(result.name, "test-view");
    assert.equal(result.catalog_id, "ds-1");
    assert.equal(result.category, "table");
    assert.ok(mock.calls[0].url.includes("/api/vega-backend/v1/resources/dv-1"));
  } finally {
    mock.restore();
  }
});

test("dataviews.list GETs from vega-backend /resources with catalog_id param", async () => {
  const mock = mockFetch({
    entries: [
      {
        id: "dv-1",
        name: "users",
        catalog_id: "ds-1",
        category: "table",
        source_identifier: "users",
        status: "active",
      },
    ],
  });
  try {
    const result = await makeClient().resources.list({ datasourceId: "ds-1" });
    assert.equal(result.length, 1);
    assert.equal(result[0].id, "dv-1");
    assert.equal(result[0].catalog_id, "ds-1");
    assert.ok(mock.calls[0].url.includes("catalog_id=ds-1"));
    assert.ok(!mock.calls[0].url.includes("data_source_id"));
  } finally {
    mock.restore();
  }
});

test("listResources API helper applies default limit=30", async () => {
  const mock = mockFetch({ entries: [] });
  try {
    await listResources({
      baseUrl: BASE,
      accessToken: TOKEN,
      datasourceId: "ds-1",
    });
    const url = new URL(mock.calls[0].url);
    assert.equal(url.searchParams.get("limit"), "30");
  } finally {
    mock.restore();
  }
});

test("dataviews.delete sends DELETE to vega-backend /resources/{id}", async () => {
  const mock = mockFetch("", 204);
  try {
    await makeClient().resources.delete("dv-1");
    assert.equal(mock.calls[0].method, "DELETE");
    assert.ok(mock.calls[0].url.includes("/api/vega-backend/v1/resources/dv-1"));
    assert.ok(!mock.calls[0].url.includes("data-views"));
  } finally {
    mock.restore();
  }
});

test("dataviews.find uses vega-backend /resources with name param", async () => {
  const mock = mockFetch({
    entries: [
      {
        id: "dv-1",
        name: "users",
        catalog_id: "ds-1",
        category: "table",
        source_identifier: "users",
        status: "active",
      },
    ],
  });
  try {
    const result = await makeClient().resources.find("users", {
      datasourceId: "ds-1",
      exact: true,
      wait: false,
    });
    assert.equal(result.length, 1);
    assert.equal(result[0].name, "users");
    assert.ok(mock.calls[0].url.includes("name=users"));
    assert.ok(!mock.calls[0].url.includes("keyword="));
  } finally {
    mock.restore();
  }
});

test("dataviews.find returns only exact matches when exact true", async () => {
  const mock = mockFetch({
    entries: [
      { id: "dv-1", name: "users", catalog_id: "ds-1", category: "table", source_identifier: "users", status: "active" },
      { id: "dv-2", name: "users_archive", catalog_id: "ds-1", category: "table", source_identifier: "users_archive", status: "active" },
    ],
  });
  try {
    const result = await makeClient().resources.find("users", {
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
    const result = await makeClient().resources.find("missing", {
      datasourceId: "ds-1",
      exact: true,
      wait: false,
    });
    assert.equal(result.length, 0);
  } finally {
    mock.restore();
  }
});

test("dataviews.query POSTs to vega-backend /resources/{id}/data with override header", async () => {
  const mock = mockFetch({ entries: [], total_count: 0 });
  try {
    await makeClient().resources.query("dv-1", { limit: 10, offset: 0 });
    assert.equal(mock.calls[0].method, "POST");
    assert.ok(mock.calls[0].url.includes("/api/vega-backend/v1/resources/dv-1/data"));
    assert.ok(!mock.calls[0].url.includes("mdl-uniquery"));
    const body = JSON.parse(mock.calls[0].body ?? "{}");
    assert.equal(body.limit, 10);
    assert.equal(body.offset, 0);
    assert.equal(body.need_total, false);
  } finally {
    mock.restore();
  }
});

test("dataviews.query passes needTotal in body", async () => {
  const mock = mockFetch({ entries: [], total_count: 5 });
  try {
    await makeClient().resources.query("dv-2", { needTotal: true });
    const body = JSON.parse(mock.calls[0].body ?? "{}");
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
