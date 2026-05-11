import test from "node:test";
import assert from "node:assert/strict";

import { getSpansByConversationId, isoToNanos } from "../src/api/trace.js";

interface MockCall { url: string; method: string; body: unknown; headers: Headers; }

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
    calls.push({ url, method, body, headers: new Headers(init?.headers) });
    const r = responses[i++] ?? {};
    return new Response(typeof r === "string" ? r : JSON.stringify(r), { status: 200 });
  };
  return { calls, restore: () => { globalThis.fetch = orig; } };
}

test("getSpansByConversationId POSTs agent-observability search twice (agg → spans)", async () => {
  const m = mockFetchSequence([
    { aggregations: { tids: { buckets: [{ key: "tr_abc" }], sum_other_doc_count: 0 } } },
    { hits: { hits: [
      { _source: { traceId: "tr_abc", spanId: "a", parentSpanId: null, name: "root", startTimeUnixNano: "0", endTimeUnixNano: "1000000", attributes: {} } },
      { _source: { traceId: "tr_abc", spanId: "b", parentSpanId: "a", name: "child", startTimeUnixNano: "0", endTimeUnixNano: "500000", attributes: {} } },
    ] } },
  ]);
  try {
    const result = await getSpansByConversationId({
      baseUrl: "https://mock.kweaver.test",
      token: "tk",
      businessDomain: "bd_public",
      conversationId: "conv_de39",
    });
    assert.equal(result.spans.length, 2);
    assert.deepEqual(result.traceIds, ["tr_abc"]);
    assert.equal(result.truncated, false);
    assert.equal(m.calls.length, 2);
    for (const c of m.calls) {
      assert.match(c.url, /\/api\/agent-observability\/v1\/traces\/_search$/);
      assert.equal(c.method, "POST");
    }
    const aggBody = m.calls[0].body as { query?: { term?: Record<string, string> } };
    assert.equal(aggBody.query?.term?.["attributes.gen_ai.conversation.id.keyword"], "conv_de39");
    const spansBody = m.calls[1].body as { query?: { terms?: Record<string, string[]> } };
    assert.deepEqual(spansBody.query?.terms?.["traceId.keyword"], ["tr_abc"]);
  } finally {
    m.restore();
  }
});

test("getSpansByConversationId returns empty when aggregation has no buckets", async () => {
  const m = mockFetchSequence([{ aggregations: { tids: { buckets: [] } } }]);
  try {
    const result = await getSpansByConversationId({
      baseUrl: "https://mock.kweaver.test",
      token: "tk",
      businessDomain: "bd_public",
      conversationId: "conv_missing",
    });
    assert.equal(result.spans.length, 0);
    assert.equal(result.traceIds.length, 0);
    assert.equal(m.calls.length, 1, "should not issue spans query when no traceIds");
  } finally {
    m.restore();
  }
});

test("getSpansByConversationId sets Authorization header when token is real", async () => {
  const m = mockFetchSequence([{ aggregations: { tids: { buckets: [] } } }]);
  try {
    await getSpansByConversationId({
      baseUrl: "https://mock.kweaver.test",
      token: "abc-token",
      businessDomain: "bd_public",
      conversationId: "c",
    });
    assert.equal(m.calls[0].headers.get("Authorization"), "Bearer abc-token");
    assert.equal(m.calls[0].headers.get("X-Business-Domain"), "bd_public");
  } finally {
    m.restore();
  }
});

test("getSpansByConversationId omits Authorization for no-auth platforms", async () => {
  const m = mockFetchSequence([{ aggregations: { tids: { buckets: [] } } }]);
  try {
    await getSpansByConversationId({
      baseUrl: "http://no-auth.kweaver.test",
      token: "__NO_AUTH__",
      businessDomain: "bd_public",
      conversationId: "c",
    });
    assert.equal(m.calls[0].headers.get("Authorization"), null);
  } finally {
    m.restore();
  }
});

test("getSpansByConversationId fixture-compat: flat hits response skips hop 2", async () => {
  // Existing e2e fixtures are direct OpenSearch hits payloads with no aggregations
  // block; the function should accept those as the spans response without a second call.
  const m = mockFetchSequence([
    { hits: { hits: [
      { _source: { traceId: "tr_synth", spanId: "x", parentSpanId: null, startTimeUnixNano: "0", endTimeUnixNano: "1000000", attributes: {} } },
    ] } },
  ]);
  try {
    const result = await getSpansByConversationId({
      baseUrl: "https://mock.kweaver.test",
      token: "tk",
      businessDomain: "bd_public",
      conversationId: "conv_flat",
    });
    assert.equal(result.spans.length, 1);
    assert.deepEqual(result.traceIds, ["tr_synth"]);
    assert.equal(m.calls.length, 1);
  } finally {
    m.restore();
  }
});

test("getSpansByConversationId converts ISO timestamps to nanos strings", async () => {
  const m = mockFetchSequence([
    { aggregations: { tids: { buckets: [{ key: "tr_iso" }] } } },
    { hits: { hits: [
      { _source: { traceId: "tr_iso", spanId: "s1", parentSpanId: "", name: "root",
                   startTime: "2026-05-07T02:08:00.144736158Z",
                   endTime:   "2026-05-07T02:08:00.158932311Z",
                   attributes: {} } },
    ] } },
  ]);
  try {
    const result = await getSpansByConversationId({
      baseUrl: "https://mock.kweaver.test",
      token: "tk",
      businessDomain: "bd_public",
      conversationId: "c",
    });
    assert.equal(result.spans.length, 1);
    const s = result.spans[0];
    assert.equal(s.parentSpanId, null, "empty parentSpanId should normalize to null (root)");
    // 2026-05-07T02:08:00Z = 1778119680 seconds since epoch; expect
    // 1778119680_144736158 ns and 1778119680_158932311 ns.
    assert.equal(s.startTimeUnixNano, "1778119680144736158");
    assert.equal(s.endTimeUnixNano, "1778119680158932311");
  } finally {
    m.restore();
  }
});

test("isoToNanos handles fractional and non-fractional inputs", () => {
  assert.equal(isoToNanos("2026-05-07T02:08:00.144736158Z"), "1778119680144736158");
  assert.equal(isoToNanos("2026-05-07T02:08:00Z"), "1778119680000000000");
  assert.equal(isoToNanos(undefined), undefined);
  assert.equal(isoToNanos("not-a-date"), undefined);
});
