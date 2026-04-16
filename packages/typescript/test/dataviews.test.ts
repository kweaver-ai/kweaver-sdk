import test from "node:test";
import assert from "node:assert/strict";

import {
  createDataView,
  listDataViews,
  getDataView,
  deleteDataView,
  queryDataView,
  parseDataView,
} from "../src/api/dataviews.js";

const BASE = "https://mock.kweaver.test";
const TOKEN = "test-token-abc";

function mockFetch(response: unknown, statusCode = 200) {
  const orig = globalThis.fetch;
  const calls: Array<{ url: string; method: string; body?: string; headers?: Record<string, string> }> = [];

  globalThis.fetch = async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    const method = init?.method ?? "GET";
    const body = init?.body ? String(init.body) : undefined;
    const headers = init?.headers as Record<string, string> | undefined;
    calls.push({ url, method, body, headers });
    const text = typeof response === "string" ? response : JSON.stringify(response);
    return new Response(text, { status: statusCode });
  };

  return { calls, restore: () => { globalThis.fetch = orig; } };
}

// ── createDataView → POST /api/vega-backend/v1/resources ─────────────────────

test("createDataView calls POST /api/vega-backend/v1/resources", async () => {
  const mock = mockFetch({ id: "res-1" }, 201);
  try {
    await createDataView({
      baseUrl: BASE,
      accessToken: TOKEN,
      name: "my-view",
      datasourceId: "cat-1",
      table: "users",
    });
    assert.equal(mock.calls[0].method, "POST");
    const url = new URL(mock.calls[0].url);
    assert.equal(url.pathname, "/api/vega-backend/v1/resources");
    assert.ok(!url.pathname.includes("mdl-data-model"), "should not use mdl-data-model");
  } finally {
    mock.restore();
  }
});

test("createDataView sends catalog_id in body", async () => {
  const mock = mockFetch({ id: "res-1" }, 201);
  try {
    await createDataView({
      baseUrl: BASE,
      accessToken: TOKEN,
      name: "my-view",
      datasourceId: "cat-1",
      table: "users",
      fields: [{ name: "id", type: "int" }, { name: "email", type: "varchar" }],
    });
    const body = JSON.parse(mock.calls[0].body!);
    assert.equal(body.catalog_id, "cat-1");
    assert.equal(body.name, "my-view");
  } finally {
    mock.restore();
  }
});

// ── listDataViews → GET /api/vega-backend/v1/resources ───────────────────────

test("listDataViews calls GET /api/vega-backend/v1/resources", async () => {
  const mock = mockFetch({ entries: [] });
  try {
    await listDataViews({ baseUrl: BASE, accessToken: TOKEN });
    assert.equal(mock.calls[0].method, "GET");
    const url = new URL(mock.calls[0].url);
    assert.equal(url.pathname, "/api/vega-backend/v1/resources");
    assert.ok(!url.pathname.includes("mdl-data-model"), "should not use mdl-data-model");
  } finally {
    mock.restore();
  }
});

test("listDataViews passes catalog_id filter", async () => {
  const mock = mockFetch({ entries: [] });
  try {
    await listDataViews({ baseUrl: BASE, accessToken: TOKEN, datasourceId: "cat-1" });
    const url = new URL(mock.calls[0].url);
    assert.equal(url.searchParams.get("catalog_id"), "cat-1");
  } finally {
    mock.restore();
  }
});

// ── getDataView → GET /api/vega-backend/v1/resources/{id} ────────────────────

test("getDataView calls GET /api/vega-backend/v1/resources/{id}", async () => {
  const mock = mockFetch({ id: "res-1", name: "my-view", query_type: "SQL", catalog_id: "cat-1" });
  try {
    await getDataView({ baseUrl: BASE, accessToken: TOKEN, id: "res-1" });
    assert.equal(mock.calls[0].method, "GET");
    const url = new URL(mock.calls[0].url);
    assert.equal(url.pathname, "/api/vega-backend/v1/resources/res-1");
    assert.ok(!url.pathname.includes("mdl-data-model"), "should not use mdl-data-model");
  } finally {
    mock.restore();
  }
});

// ── deleteDataView → DELETE /api/vega-backend/v1/resources/{id} ──────────────

test("deleteDataView calls DELETE /api/vega-backend/v1/resources/{id}", async () => {
  const mock = mockFetch("{}", 200);
  try {
    await deleteDataView({ baseUrl: BASE, accessToken: TOKEN, id: "res-1" });
    assert.equal(mock.calls[0].method, "DELETE");
    const url = new URL(mock.calls[0].url);
    assert.equal(url.pathname, "/api/vega-backend/v1/resources/res-1");
    assert.ok(!url.pathname.includes("mdl-data-model"), "should not use mdl-data-model");
  } finally {
    mock.restore();
  }
});

// ── queryDataView → POST /api/vega-backend/v1/resources/{id}/data ────────────

test("queryDataView calls POST /api/vega-backend/v1/resources/{id}/data", async () => {
  const mock = mockFetch({ entries: [], columns: [] });
  try {
    await queryDataView({ baseUrl: BASE, accessToken: TOKEN, id: "res-1" });
    assert.equal(mock.calls[0].method, "POST");
    const url = new URL(mock.calls[0].url);
    assert.equal(url.pathname, "/api/vega-backend/v1/resources/res-1/data");
    assert.ok(!url.pathname.includes("mdl-uniquery"), "should not use mdl-uniquery");
  } finally {
    mock.restore();
  }
});

// ── parseDataView: must read source_metadata.columns from vega resource ──────

test("parseDataView extracts fields from source_metadata.columns", () => {
  const raw = {
    id: "res-1",
    name: "users",
    query_type: "SQL",
    catalog_id: "cat-1",
    source_metadata: {
      columns: [
        { name: "id", type: "int" },
        { name: "email", type: "varchar", comment: "user email" },
      ],
    },
  };
  const dv = parseDataView(raw as Record<string, unknown>);
  assert.equal(dv.id, "res-1");
  assert.ok(dv.fields, "fields should be populated from source_metadata.columns");
  assert.equal(dv.fields!.length, 2);
  assert.equal(dv.fields![0].name, "id");
  assert.equal(dv.fields![1].name, "email");
  assert.equal(dv.fields![1].comment, "user email");
});

test("queryDataView sends x-http-method-override GET header", async () => {
  const mock = mockFetch({ entries: [] });
  try {
    await queryDataView({ baseUrl: BASE, accessToken: TOKEN, id: "res-1", limit: 10, offset: 5 });
    assert.equal(mock.calls[0].headers?.["x-http-method-override"], "GET");
    const body = JSON.parse(mock.calls[0].body!);
    assert.equal(body.limit, 10);
    assert.equal(body.offset, 5);
  } finally {
    mock.restore();
  }
});
