import test from "node:test";
import assert from "node:assert/strict";

import { getTracesByConversation, type TraceSpan } from "../src/api/conversations.js";
import {
  buildSpanTree,
  formatTreeView,
  formatPerfView,
  formatEvidenceView,
  formatTraceResult,
} from "../src/utils/trace-views.js";
import { parseAgentTraceArgs } from "../src/commands/agent.js";

const BASE = "https://mock.kweaver.test";
const TOKEN = "test-token";

interface MockCall {
  url: string;
  method: string;
  body: unknown;
}

function mockFetchSequence(responses: unknown[]) {
  const orig = globalThis.fetch;
  const calls: MockCall[] = [];
  let i = 0;

  globalThis.fetch = async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    const method = init?.method ?? "GET";
    let body: unknown = undefined;
    if (init?.body && typeof init.body === "string") {
      try {
        body = JSON.parse(init.body);
      } catch {
        body = init.body;
      }
    }
    calls.push({ url, method, body });
    const r = responses[i++] ?? {};
    const text = typeof r === "string" ? r : JSON.stringify(r);
    return new Response(text, { status: 200 });
  };
  return { calls, restore: () => { globalThis.fetch = orig; } };
}

test("getTracesByConversation: 2-jump emits aggs then terms query against trace-ai _search", async () => {
  const aggResponse = {
    aggregations: {
      tids: {
        buckets: [{ key: "trace-A" }, { key: "trace-B" }],
        sum_other_doc_count: 0,
      },
    },
  };
  const spansResponse = {
    hits: {
      hits: [
        {
          _source: {
            traceId: "trace-A",
            spanId: "s1",
            name: "/api/agent-factory/v1/app/x/chat/completion",
            startTime: "2026-04-01T00:00:00.000Z",
            durationInNanos: 75_000_000_000,
            status: { code: "UNSET" },
            serviceName: "agent-factory",
          },
        },
        {
          _source: {
            traceId: "trace-A",
            spanId: "s2",
            parentSpanId: "s1",
            name: "execute_tool find_skills",
            startTime: "2026-04-01T00:00:01.000Z",
            durationInNanos: 100_000_000,
            status: { code: "OK" },
            attributes: { "tool.name": "find_skills", "tool.arguments": "{\"object_type_id\":\"material\"}" },
          },
        },
      ],
    },
  };

  const mock = mockFetchSequence([aggResponse, spansResponse]);
  try {
    const result = await getTracesByConversation({
      baseUrl: BASE,
      accessToken: TOKEN,
      conversationId: "conv-1",
    });
    assert.equal(mock.calls.length, 2);

    const expectedUrl = `${BASE}/api/agent-observability/v1/traces/_search`;
    assert.equal(mock.calls[0].url, expectedUrl);
    assert.equal(mock.calls[0].method, "POST");
    const body0 = mock.calls[0].body as Record<string, unknown>;
    assert.equal(body0.size, 0);
    const query0 = body0.query as Record<string, unknown>;
    const term = (query0.term as Record<string, unknown>) ?? {};
    assert.equal(term["attributes.gen_ai.conversation.id.keyword"], "conv-1");
    const aggs0 = body0.aggs as Record<string, unknown>;
    assert.ok(aggs0.tids);

    assert.equal(mock.calls[1].url, expectedUrl);
    const body1 = mock.calls[1].body as Record<string, unknown>;
    const query1 = body1.query as Record<string, unknown>;
    const terms = (query1.terms as Record<string, unknown>) ?? {};
    assert.deepEqual(terms["traceId.keyword"], ["trace-A", "trace-B"]);

    assert.deepEqual(result.traceIds, ["trace-A", "trace-B"]);
    assert.equal(result.spans.length, 2);
    assert.equal(result.spans[0].name, "/api/agent-factory/v1/app/x/chat/completion");
    assert.equal(result.spans[1].parentSpanId, "s1");
    assert.equal(result.truncated, false);
  } finally {
    mock.restore();
  }
});

test("getTracesByConversation: empty conversation skips second hop", async () => {
  const mock = mockFetchSequence([{ aggregations: { tids: { buckets: [] } } }]);
  try {
    const result = await getTracesByConversation({
      baseUrl: BASE,
      accessToken: TOKEN,
      conversationId: "missing",
    });
    assert.equal(mock.calls.length, 1);
    assert.deepEqual(result.spans, []);
    assert.deepEqual(result.traceIds, []);
  } finally {
    mock.restore();
  }
});

test("getTracesByConversation: surfaces traceId aggregation truncation", async () => {
  const aggResponse = {
    aggregations: {
      tids: { buckets: [{ key: "trace-A" }], sum_other_doc_count: 7 },
    },
  };
  const spansResponse = { hits: { hits: [] } };
  const mock = mockFetchSequence([aggResponse, spansResponse]);
  try {
    const result = await getTracesByConversation({
      baseUrl: BASE,
      accessToken: TOKEN,
      conversationId: "conv-x",
    });
    assert.equal(result.truncated, true);
  } finally {
    mock.restore();
  }
});

function span(partial: Partial<TraceSpan> & { spanId: string; name: string }): TraceSpan {
  return {
    traceId: "t1",
    startTime: "2026-04-01T00:00:00.000Z",
    durationInNanos: 1_000_000,
    ...partial,
  };
}

test("buildSpanTree: builds parent-child structure and orphans become roots", () => {
  const spans: TraceSpan[] = [
    span({ spanId: "a", name: "root", startTime: "2026-04-01T00:00:00.000Z" }),
    span({ spanId: "b", parentSpanId: "a", name: "child1", startTime: "2026-04-01T00:00:01.000Z" }),
    span({ spanId: "c", parentSpanId: "a", name: "child2", startTime: "2026-04-01T00:00:00.500Z" }),
    span({ spanId: "d", parentSpanId: "missing", name: "orphan", startTime: "2026-04-01T00:00:02.000Z" }),
  ];
  const roots = buildSpanTree(spans);
  assert.equal(roots.length, 2);
  const main = roots.find((r) => r.span.spanId === "a");
  assert.ok(main);
  assert.equal(main!.children.length, 2);
  assert.equal(main!.children[0].span.spanId, "c");
  assert.equal(main!.children[1].span.spanId, "b");
});

test("formatTreeView: renders span name and duration; empty input returns sentinel", () => {
  assert.equal(formatTreeView([]), "(no spans)");
  const out = formatTreeView([
    span({ spanId: "a", name: "root-call", durationInNanos: 12_300_000 }),
    span({ spanId: "b", parentSpanId: "a", name: "child-call", durationInNanos: 5_000_000 }),
  ]);
  assert.match(out, /root-call/);
  assert.match(out, /child-call/);
  assert.match(out, /12\.\d+ms/);
});

test("formatPerfView: aggregates by category", () => {
  const spans: TraceSpan[] = [
    span({ spanId: "1", name: "execute_tool find_skills", durationInNanos: 100_000_000, attributes: { "tool.name": "find_skills" } }),
    span({ spanId: "2", name: "execute_tool find_skills", durationInNanos: 50_000_000, attributes: { "tool.name": "find_skills" } }),
    span({ spanId: "3", name: "chat", durationInNanos: 20_000_000_000, attributes: { "gen_ai.request.model": "deepseek" } }),
    span({ spanId: "4", name: "search_memory_prompt", durationInNanos: 100_000 }),
  ];
  const out = formatPerfView(spans);
  assert.match(out, /LLM \(chat\)/);
  assert.match(out, /tool:find_skills/);
  assert.match(out, /prompt-build/);
});

test("formatEvidenceView: lists tool steps with hits and score", () => {
  const spans: TraceSpan[] = [
    span({
      spanId: "1",
      name: "execute_tool query_object_instance",
      durationInNanos: 41_000_000,
      attributes: {
        "tool.name": "query_object_instance",
        "tool.arguments": '{"ot_id":"material","sku":"MAT-001"}',
        "tool.result": JSON.stringify({ hits: [{ name: "Battery Cell", _score: 1.386 }] }),
      },
    }),
    span({
      spanId: "2",
      name: "chat",
      durationInNanos: 20_000_000_000,
      attributes: { "gen_ai.request.model": "deepseek-v3.2", "gen_ai.usage.input_tokens": 9489, "gen_ai.usage.output_tokens": 612 },
    }),
  ];
  const out = formatEvidenceView(spans);
  assert.match(out, /query_object_instance/);
  assert.match(out, /Battery Cell/);
  assert.match(out, /_score=1\.386/);
  assert.match(out, /deepseek-v3\.2/);
  assert.match(out, /in=9489/);
});

test("formatTraceResult: empty spans returns sentinel; truncated emits warning", () => {
  const empty = formatTraceResult({ conversationId: "c", traceIds: [], spans: [], truncated: false }, "tree");
  assert.match(empty, /no spans/);

  const withSpan = formatTraceResult(
    {
      conversationId: "c",
      traceIds: ["t1"],
      spans: [span({ spanId: "1", name: "root" })],
      truncated: true,
    },
    "tree",
  );
  assert.match(withSpan, /traceId aggregation truncated/);
  assert.match(withSpan, /── Tree ──/);
});

test("parseAgentTraceArgs: accepts new single-arg form", () => {
  const opts = parseAgentTraceArgs(["conv-1"]);
  assert.equal(opts.conversationId, "conv-1");
  assert.equal(opts.agentId, undefined);
  assert.equal(opts.view, "tree");
  assert.equal(opts.json, false);
});

test("parseAgentTraceArgs: accepts legacy two-arg form", () => {
  const opts = parseAgentTraceArgs(["agent-x", "conv-1"]);
  assert.equal(opts.agentId, "agent-x");
  assert.equal(opts.conversationId, "conv-1");
});

test("parseAgentTraceArgs: --view and --json flags", () => {
  const a = parseAgentTraceArgs(["conv-1", "--view", "perf"]);
  assert.equal(a.view, "perf");
  const b = parseAgentTraceArgs(["conv-1", "--view=evidence", "--json"]);
  assert.equal(b.view, "evidence");
  assert.equal(b.json, true);
  assert.throws(() => parseAgentTraceArgs(["conv-1", "--view", "bogus"]));
});

test("parseAgentTraceArgs: rejects missing conversation_id", () => {
  assert.throws(() => parseAgentTraceArgs([]));
  assert.throws(() => parseAgentTraceArgs(["--view", "tree"]));
});
