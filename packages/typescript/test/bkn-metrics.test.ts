import test from "node:test";
import assert from "node:assert/strict";

import {
  listMetrics,
  createMetrics,
  searchMetrics,
  validateMetrics,
  getMetric,
  updateMetric,
  deleteMetric,
  getMetrics,
  deleteMetrics,
} from "../src/api/bkn-metrics.js";

const originalFetch = globalThis.fetch;

test("listMetrics sends GET to /metrics with query params", async () => {
  globalThis.fetch = async (input, init) => {
    const url = typeof input === "string" ? input : input.toString();
    assert.equal(init?.method, "GET");
    assert.ok(url.includes("/api/bkn-backend/v1/knowledge-networks/kn-1/metrics?"));
    assert.ok(url.includes("limit=30"));
    assert.ok(url.includes("branch=main"));
    assert.ok(url.includes("name_pattern=cpu"));
    return new Response('{"entries":[],"total_count":0}', { status: 200 });
  };
  try {
    const body = await listMetrics({
      baseUrl: "https://host",
      accessToken: "t",
      knId: "kn-1",
      limit: 30,
      branch: "main",
      namePattern: "cpu",
    });
    assert.equal(body, '{"entries":[],"total_count":0}');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("createMetrics POST with X-HTTP-Method-Override POST", async () => {
  globalThis.fetch = async (input, init) => {
    const headers = new Headers(init?.headers);
    assert.equal(init?.method, "POST");
    assert.equal(headers.get("X-HTTP-Method-Override"), "POST");
    assert.equal(headers.get("content-type"), "application/json");
    assert.equal(init?.body, '{"entries":[]}');
    return new Response('["id1"]', { status: 201 });
  };
  try {
    const body = await createMetrics({
      baseUrl: "https://host",
      accessToken: "t",
      knId: "kn-1",
      body: '{"entries":[]}',
    });
    assert.equal(body, '["id1"]');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("searchMetrics POST with X-HTTP-Method-Override GET", async () => {
  globalThis.fetch = async (input, init) => {
    const headers = new Headers(init?.headers);
    assert.equal(init?.method, "POST");
    assert.equal(headers.get("X-HTTP-Method-Override"), "GET");
    assert.equal(init?.body, '{"limit":20}');
    return new Response("{}", { status: 200 });
  };
  try {
    await searchMetrics({
      baseUrl: "https://host",
      accessToken: "t",
      knId: "kn-1",
      body: '{"limit":20}',
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("validateMetrics POST to /metrics/validation", async () => {
  globalThis.fetch = async (input, init) => {
    const url = typeof input === "string" ? input : input.toString();
    assert.equal(init?.method, "POST");
    assert.ok(url.includes("/metrics/validation?"));
    assert.ok(url.includes("import_mode=normal"));
    return new Response('{"valid":true}', { status: 200 });
  };
  try {
    const body = await validateMetrics({
      baseUrl: "https://host",
      accessToken: "t",
      knId: "kn-1",
      body: '{"entries":[]}',
      importMode: "normal",
    });
    assert.equal(body, '{"valid":true}');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("getMetric GET /metrics/:id", async () => {
  globalThis.fetch = async (input, init) => {
    const url = typeof input === "string" ? input : input.toString();
    assert.equal(init?.method, "GET");
    assert.ok(url.endsWith("/metrics/m1?branch=main"));
    return new Response('{"id":"m1"}', { status: 200 });
  };
  try {
    const body = await getMetric({
      baseUrl: "https://host",
      accessToken: "t",
      knId: "kn-1",
      metricId: "m1",
      branch: "main",
    });
    assert.equal(body, '{"id":"m1"}');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("updateMetric PUT and accepts 204 empty body", async () => {
  globalThis.fetch = async (input, init) => {
    assert.equal(init?.method, "PUT");
    assert.equal(init?.body, '{"comment":"x"}');
    return new Response(null, { status: 204 });
  };
  try {
    const body = await updateMetric({
      baseUrl: "https://host",
      accessToken: "t",
      knId: "kn-1",
      metricId: "m1",
      body: '{"comment":"x"}',
    });
    assert.equal(body, "");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("deleteMetric DELETE and accepts 204", async () => {
  globalThis.fetch = async (input, init) => {
    assert.equal(init?.method, "DELETE");
    return new Response(null, { status: 204 });
  };
  try {
    const body = await deleteMetric({
      baseUrl: "https://host",
      accessToken: "t",
      knId: "kn-1",
      metricId: "m1",
    });
    assert.equal(body, "");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("getMetrics GET comma-separated ids in path", async () => {
  globalThis.fetch = async (input, init) => {
    const url = typeof input === "string" ? input : input.toString();
    assert.equal(init?.method, "GET");
    assert.ok(url.includes("/metrics/a,b"));
    return new Response('{"entries":[]}', { status: 200 });
  };
  try {
    const body = await getMetrics({
      baseUrl: "https://host",
      accessToken: "t",
      knId: "kn-1",
      metricIds: "a,b",
    });
    assert.equal(body, '{"entries":[]}');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("deleteMetrics DELETE batch path", async () => {
  globalThis.fetch = async (input, init) => {
    assert.equal(init?.method, "DELETE");
    return new Response(null, { status: 204 });
  };
  try {
    const body = await deleteMetrics({
      baseUrl: "https://host",
      accessToken: "t",
      knId: "kn-1",
      metricIds: "a,b",
    });
    assert.equal(body, "");
  } finally {
    globalThis.fetch = originalFetch;
  }
});
