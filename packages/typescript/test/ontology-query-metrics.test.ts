import test from "node:test";
import assert from "node:assert/strict";

import { metricQueryData, metricDryRun } from "../src/api/ontology-query-metrics.js";

const originalFetch = globalThis.fetch;

test("metricQueryData POSTs to metrics/{metric_id}/data without X-HTTP-Method-Override", async () => {
  globalThis.fetch = async (input, init) => {
    const url = new URL(typeof input === "string" ? input : input.toString());
    const headers = new Headers(init?.headers);
    assert.equal(init?.method, "POST");
    assert.equal(
      url.pathname,
      "/api/ontology-query/v1/knowledge-networks/kn-1/metrics/m-1/data"
    );
    assert.equal(url.searchParams.get("branch"), "main");
    assert.equal(url.searchParams.get("fill_null"), "true");
    assert.equal(headers.get("content-type"), "application/json");
    assert.equal(headers.get("X-HTTP-Method-Override"), null);
    assert.equal(init?.body, "{\"limit\":10}");
    return new Response("{\"datas\":[]}", { status: 200 });
  };

  try {
    const body = await metricQueryData({
      baseUrl: "https://dip.example.com",
      accessToken: "token-abc",
      knId: "kn-1",
      metricId: "m-1",
      body: "{\"limit\":10}",
      businessDomain: "bd_public",
      branch: "main",
      fillNull: true,
    });
    assert.equal(body, "{\"datas\":[]}");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("metricDryRun POSTs to metrics/dry-run without X-HTTP-Method-Override", async () => {
  globalThis.fetch = async (input, init) => {
    const url = new URL(typeof input === "string" ? input : input.toString());
    const headers = new Headers(init?.headers);
    assert.equal(init?.method, "POST");
    assert.equal(
      url.pathname,
      "/api/ontology-query/v1/knowledge-networks/kn-1/metrics/dry-run"
    );
    assert.equal(url.searchParams.get("branch"), "dev");
    assert.equal(headers.get("content-type"), "application/json");
    assert.equal(headers.get("X-HTTP-Method-Override"), null);
    assert.equal(init?.body, "{\"metric_config\":{\"id\":\"x\"}}");
    return new Response("{\"datas\":[]}", { status: 200 });
  };

  try {
    const body = await metricDryRun({
      baseUrl: "https://dip.example.com",
      accessToken: "token-abc",
      knId: "kn-1",
      body: "{\"metric_config\":{\"id\":\"x\"}}",
      branch: "dev",
    });
    assert.equal(body, "{\"datas\":[]}");
  } finally {
    globalThis.fetch = originalFetch;
  }
});
