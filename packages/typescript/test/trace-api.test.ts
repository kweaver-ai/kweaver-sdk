import test from "node:test";
import assert from "node:assert/strict";

import { getTraceById } from "../src/api/trace.js";

interface MockCall { url: string; method: string; body: unknown; }

function mockFetchSequence(responses: unknown[]) {
  const orig = globalThis.fetch;
  const calls: MockCall[] = [];
  let i = 0;
  globalThis.fetch = async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    const method = init?.method ?? "GET";
    let body: unknown;
    if (init?.body && typeof init.body === "string") {
      try { body = JSON.parse(init.body); } catch { body = init.body; }
    }
    calls.push({ url, method, body });
    const r = responses[i++] ?? {};
    return new Response(typeof r === "string" ? r : JSON.stringify(r), { status: 200 });
  };
  return { calls, restore: () => { globalThis.fetch = orig; } };
}

test("getTraceById POSTs _search with a traceId term query", async () => {
  const m = mockFetchSequence([
    { hits: { hits: [
      { _source: { spanId: "a", parentSpanId: null, name: "root", startTimeUnixNano: "0", endTimeUnixNano: "1000000", attributes: {} } },
      { _source: { spanId: "b", parentSpanId: "a", name: "child", startTimeUnixNano: "0", endTimeUnixNano: "500000", attributes: {} } },
    ] } },
  ]);
  try {
    const spans = await getTraceById({
      baseUrl: "https://mock.kweaver.test",
      token: "tk",
      businessDomain: "bd_public",
      traceId: "tr_de39",
    });
    assert.equal(spans.length, 2);
    assert.equal(m.calls.length, 1);
    assert.match(m.calls[0].url, /\/api\/trace-ai\/_search$/);
    assert.equal(m.calls[0].method, "POST");
    const body = m.calls[0].body as { query?: { term?: { traceId?: string } } };
    assert.equal(body.query?.term?.traceId, "tr_de39");
  } finally {
    m.restore();
  }
});

test("getTraceById returns empty array when hits is empty", async () => {
  const m = mockFetchSequence([{ hits: { hits: [] } }]);
  try {
    const spans = await getTraceById({
      baseUrl: "https://mock.kweaver.test",
      token: "tk",
      businessDomain: "bd_public",
      traceId: "tr_missing",
    });
    assert.equal(spans.length, 0);
  } finally {
    m.restore();
  }
});

test("getTraceById sets Authorization header from token", async () => {
  const m = mockFetchSequence([{ hits: { hits: [] } }]);
  const origFetch = globalThis.fetch;
  let seenHeaders: Headers | undefined;
  globalThis.fetch = async (input, init) => {
    seenHeaders = new Headers(init?.headers);
    return origFetch(input, init);
  };
  try {
    await getTraceById({
      baseUrl: "https://mock.kweaver.test",
      token: "abc-token",
      businessDomain: "bd_public",
      traceId: "tr_x",
    });
    assert.equal(seenHeaders?.get("Authorization"), "Bearer abc-token");
  } finally {
    m.restore();
  }
});
