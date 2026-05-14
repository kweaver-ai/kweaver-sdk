import test from "node:test";
import assert from "node:assert/strict";

import { extractUserQueryFromTrace } from "../src/trace-ai/diagnose/query-extractor.js";
import type { TraceTree, Span } from "../src/trace-ai/diagnose/types.js";

function fakeTree(spans: Partial<Span>[]): TraceTree {
  const fullSpans = spans.map((s) => ({
    spanId: s.spanId ?? "x",
    parentSpanId: null,
    name: s.name ?? "n",
    kind: "unknown" as const,
    startTimeUnixNano: "0",
    endTimeUnixNano: "0",
    durationMs: 0,
    status: "ok" as const,
    attributes: s.attributes ?? {},
    events: s.events,
  }));
  return {
    traceId: "t",
    spans: fullSpans,
    byId: new Map(fullSpans.map((s) => [s.spanId, s])),
    parentToChildren: new Map(),
    byKind: new Map(),
    root: fullSpans[0] ?? null,
  };
}

test("extractUserQueryFromTrace returns last user message from gen_ai.input.messages", () => {
  const tree = fakeTree([
    {
      attributes: {
        "gen_ai.input.messages": JSON.stringify([
          { role: "system", content: "you are an agent" },
          { role: "user", content: "hello" },
          { role: "assistant", content: "hi" },
          { role: "user", content: "what's 2+2?" },
        ]),
      },
    },
  ]);
  assert.equal(extractUserQueryFromTrace(tree), "what's 2+2?");
});

test("extractUserQueryFromTrace returns null when no span has gen_ai.input.messages", () => {
  const tree = fakeTree([{ attributes: { "other.attr": "x" } }]);
  assert.equal(extractUserQueryFromTrace(tree), null);
});

test("extractUserQueryFromTrace returns null when input.messages is not parseable JSON", () => {
  const tree = fakeTree([{ attributes: { "gen_ai.input.messages": "not json" } }]);
  assert.equal(extractUserQueryFromTrace(tree), null);
});

test("extractUserQueryFromTrace returns null when no user message in input.messages", () => {
  const tree = fakeTree([
    {
      attributes: {
        "gen_ai.input.messages": JSON.stringify([
          { role: "system", content: "x" },
          { role: "assistant", content: "y" },
        ]),
      },
    },
  ]);
  assert.equal(extractUserQueryFromTrace(tree), null);
});

// ── event path (dolphin otel_listener) ───────────────────────────────────────

test("extractUserQueryFromTrace reads from event attributes (primary path)", () => {
  const tree = fakeTree([
    {
      name: "chat deepseek-chat",
      attributes: {},
      events: [
        {
          name: "gen_ai.client.inference.operation.details",
          attributes: {
            "gen_ai.input.messages": JSON.stringify([
              { role: "system", content: "you are an agent" },
              { role: "user", content: "充电桩有多少家企业？" },
            ]),
            "gen_ai.output.messages": JSON.stringify([
              { role: "assistant", content: "78家" },
            ]),
          },
        },
      ],
    },
  ]);
  assert.equal(extractUserQueryFromTrace(tree), "充电桩有多少家企业？");
});

test("extractUserQueryFromTrace prefers event path over span.attributes fallback", () => {
  const tree = fakeTree([
    {
      attributes: {
        "gen_ai.input.messages": JSON.stringify([{ role: "user", content: "from-span-attr" }]),
      },
      events: [
        {
          name: "gen_ai.client.inference.operation.details",
          attributes: {
            "gen_ai.input.messages": JSON.stringify([{ role: "user", content: "from-event" }]),
          },
        },
      ],
    },
  ]);
  assert.equal(extractUserQueryFromTrace(tree), "from-event");
});

test("extractUserQueryFromTrace falls back to span.attributes when no events", () => {
  const tree = fakeTree([
    {
      attributes: {
        "gen_ai.input.messages": JSON.stringify([{ role: "user", content: "fallback-query" }]),
      },
      events: [],
    },
  ]);
  assert.equal(extractUserQueryFromTrace(tree), "fallback-query");
});

test("extractUserQueryFromTrace returns null when events present but no gen_ai.input.messages", () => {
  const tree = fakeTree([
    {
      attributes: {},
      events: [{ name: "some.other.event", attributes: { "other.key": "value" } }],
    },
  ]);
  assert.equal(extractUserQueryFromTrace(tree), null);
});
