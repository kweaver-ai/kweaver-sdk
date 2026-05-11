import test from "node:test";
import assert from "node:assert/strict";

import {
  fetchRawSpansByConversation,
  TRACE_SEARCH_PATH,
  TraceFetchError,
} from "../src/api/agent-observability.js";

interface MockCall { url: string; method: string; body: unknown; headers: Headers; }

function mockFetchSequence(responses: Array<unknown | { status: number; body: unknown }>) {
  const orig = globalThis.fetch;
  const calls: MockCall[] = [];
  let i = 0;
  globalThis.fetch = async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    let body: unknown;
    if (init?.body && typeof init.body === "string") {
      try { body = JSON.parse(init.body); } catch { body = init.body; }
    }
    calls.push({ url, method: init?.method ?? "GET", body, headers: new Headers(init?.headers) });
    const r = responses[i++] ?? {};
    if (r && typeof r === "object" && "status" in r && "body" in r) {
      const { status, body: rb } = r as { status: number; body: unknown };
      return new Response(typeof rb === "string" ? rb : JSON.stringify(rb), { status });
    }
    return new Response(typeof r === "string" ? r : JSON.stringify(r), { status: 200 });
  };
  return { calls, restore: () => { globalThis.fetch = orig; } };
}

test("TRACE_SEARCH_PATH points at agent-observability", () => {
  assert.equal(TRACE_SEARCH_PATH, "/api/agent-observability/v1/traces/_search");
});

test("fetchRawSpansByConversation issues agg then spans queries with correct bodies", async () => {
  const m = mockFetchSequence([
    { aggregations: { tids: { buckets: [{ key: "tr_x" }, { key: "tr_y" }], sum_other_doc_count: 0 } } },
    { hits: { hits: [
      { _source: { traceId: "tr_x", spanId: "a" } },
      { _source: { traceId: "tr_y", spanId: "b" } },
    ] } },
  ]);
  try {
    const r = await fetchRawSpansByConversation({
      baseUrl: "https://mock.kweaver.test",
      accessToken: "tk",
      businessDomain: "bd_public",
      conversationId: "conv_1",
    });
    assert.deepEqual(r.traceIds, ["tr_x", "tr_y"]);
    assert.equal(r.rawSources.length, 2);
    assert.equal(r.truncated, false);
    assert.equal(m.calls.length, 2);
    const agg = m.calls[0].body as { query?: { term?: Record<string, string> }; aggs?: unknown };
    assert.equal(agg.query?.term?.["attributes.gen_ai.conversation.id.keyword"], "conv_1");
    const spans = m.calls[1].body as { query?: { terms?: Record<string, string[]> }; sort?: unknown };
    assert.deepEqual(spans.query?.terms?.["traceId.keyword"], ["tr_x", "tr_y"]);
  } finally {
    m.restore();
  }
});

test("fetchRawSpansByConversation marks truncated when sum_other_doc_count > 0", async () => {
  const m = mockFetchSequence([
    { aggregations: { tids: { buckets: [{ key: "tr_x" }], sum_other_doc_count: 5 } } },
    { hits: { hits: [{ _source: { traceId: "tr_x", spanId: "a" } }] } },
  ]);
  try {
    const r = await fetchRawSpansByConversation({
      baseUrl: "https://mock.kweaver.test",
      accessToken: "tk",
      businessDomain: "bd_public",
      conversationId: "c",
    });
    assert.equal(r.truncated, true);
  } finally {
    m.restore();
  }
});

test("fetchRawSpansByConversation skips hop 2 on empty buckets", async () => {
  const m = mockFetchSequence([{ aggregations: { tids: { buckets: [] } } }]);
  try {
    const r = await fetchRawSpansByConversation({
      baseUrl: "https://mock.kweaver.test",
      accessToken: "tk",
      businessDomain: "bd_public",
      conversationId: "c",
    });
    assert.equal(r.rawSources.length, 0);
    assert.equal(r.traceIds.length, 0);
    assert.equal(m.calls.length, 1);
  } finally {
    m.restore();
  }
});

test("fetchRawSpansByConversation fixture-compat: flat hits payload skips hop 2", async () => {
  const m = mockFetchSequence([
    { hits: { hits: [
      { _source: { traceId: "tr_flat", spanId: "x" } },
      { _source: { traceId: "tr_flat", spanId: "y" } },
    ] } },
  ]);
  try {
    const r = await fetchRawSpansByConversation({
      baseUrl: "https://mock.kweaver.test",
      accessToken: "tk",
      businessDomain: "bd_public",
      conversationId: "c",
    });
    assert.deepEqual(r.traceIds, ["tr_flat"]);
    assert.equal(r.rawSources.length, 2);
    assert.equal(m.calls.length, 1);
  } finally {
    m.restore();
  }
});

test("fetchRawSpansByConversation passes Authorization for real tokens", async () => {
  const m = mockFetchSequence([{ aggregations: { tids: { buckets: [] } } }]);
  try {
    await fetchRawSpansByConversation({
      baseUrl: "https://mock.kweaver.test",
      accessToken: "abc-token",
      businessDomain: "bd_public",
      conversationId: "c",
    });
    assert.equal(m.calls[0].headers.get("authorization"), "Bearer abc-token");
    assert.equal(m.calls[0].headers.get("x-business-domain"), "bd_public");
  } finally {
    m.restore();
  }
});

test("fetchRawSpansByConversation omits Authorization for __NO_AUTH__", async () => {
  const m = mockFetchSequence([{ aggregations: { tids: { buckets: [] } } }]);
  try {
    await fetchRawSpansByConversation({
      baseUrl: "http://no-auth.kweaver.test",
      accessToken: "__NO_AUTH__",
      businessDomain: "bd_public",
      conversationId: "c",
    });
    assert.equal(m.calls[0].headers.get("authorization"), null);
  } finally {
    m.restore();
  }
});

test("fetchRawSpansByConversation throws TraceFetchError with status on non-2xx", async () => {
  const m = mockFetchSequence([{ status: 502, body: "Bad Gateway" }]);
  try {
    await assert.rejects(
      () => fetchRawSpansByConversation({
        baseUrl: "https://mock.kweaver.test",
        accessToken: "tk",
        businessDomain: "bd_public",
        conversationId: "c",
      }),
      (err: unknown) => {
        assert.ok(err instanceof TraceFetchError);
        assert.equal((err as TraceFetchError).status, 502);
        return true;
      },
    );
  } finally {
    m.restore();
  }
});
