import test from "node:test";
import assert from "node:assert/strict";

import { assembleTraceTree } from "../src/trace-core/diagnose/trace-shaper.js";

const baseSpan = (id: string, parent: string | null, attrs: Record<string, unknown> = {}) => ({
  spanId: id,
  parentSpanId: parent,
  name: `span-${id}`,
  startTimeUnixNano: "1700000000000000000",
  endTimeUnixNano: "1700000000010000000",
  status: { code: "OK" },
  attributes: attrs,
});

test("assembleTraceTree builds parent/child index from flat spans", () => {
  const spans = [
    baseSpan("a", null),
    baseSpan("b", "a"),
    baseSpan("c", "a"),
    baseSpan("d", "b"),
  ];
  const tree = assembleTraceTree("tr_1", spans);
  assert.equal(tree.spans.length, 4);
  assert.equal(tree.root?.spanId, "a");
  assert.equal(tree.parentToChildren.get("a")?.length, 2);
  assert.equal(tree.parentToChildren.get("b")?.length, 1);
});

test("assembleTraceTree maps agent.trace.type to SpanKind", () => {
  const spans = [
    baseSpan("a", null, { "agent.trace.type": "model" }),
    baseSpan("b", "a", { "agent.trace.type": "tool" }),
    baseSpan("c", "a", { "agent.trace.type": "retrieval" }),
    baseSpan("d", "a", {}),  // unknown
  ];
  const tree = assembleTraceTree("tr_1", spans);
  assert.equal(tree.byKind.get("llm")?.length, 1);
  assert.equal(tree.byKind.get("tool")?.length, 1);
  assert.equal(tree.byKind.get("retrieval")?.length, 1);
  assert.equal(tree.byKind.get("unknown")?.length, 1);
});

test("assembleTraceTree computes durationMs from start/end nano", () => {
  const tree = assembleTraceTree("tr_1", [baseSpan("a", null)]);
  assert.equal(tree.byId.get("a")?.durationMs, 10);
});

test("assembleTraceTree handles empty span list", () => {
  const tree = assembleTraceTree("tr_1", []);
  assert.equal(tree.spans.length, 0);
  assert.equal(tree.root, null);
});

test("assembleTraceTree maps OTel status code to status field", () => {
  const ok = baseSpan("a", null);
  ok.status = { code: "OK" };
  const err = baseSpan("b", "a");
  err.status = { code: "ERROR" };
  const unset = baseSpan("c", "a");
  unset.status = { code: "UNSET" };
  const tree = assembleTraceTree("tr_1", [ok, err, unset]);
  assert.equal(tree.byId.get("a")?.status, "ok");
  assert.equal(tree.byId.get("b")?.status, "error");
  assert.equal(tree.byId.get("c")?.status, "unset");
});
