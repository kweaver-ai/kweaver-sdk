import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { assembleTraceTree } from "../src/trace-ai/diagnose/trace-shaper.js";
import { predicate } from "../src/trace-ai/diagnose/builtin-rules/excessive-tool-calls-per-turn.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function loadTree(p: string) {
  const raw = JSON.parse(await fs.readFile(p, "utf8")) as { hits: { hits: { _source: any }[] } };
  return assembleTraceTree("tr_x", raw.hits.hits.map((h) => h._source));
}

test("excessive_tool_calls_per_turn: fires when tool count exceeds default 10", async () => {
  const tree = await loadTree(path.join(__dirname, "fixtures/trace-diagnose/synthetic/excessive-tool-calls-per-turn.json"));
  const hits = predicate(tree, { max_tool_calls_per_turn: 10 });
  assert.equal(hits.length, 1);
  assert.equal(hits[0].evidenceSpans.length, 12);
  assert.equal(hits[0].bindings.count, 12);
  assert.equal(hits[0].bindings.max_calls, 10);
});

test("excessive_tool_calls_per_turn: does NOT fire when count == max", async () => {
  const spans = [
    { spanId: "t1", parentSpanId: null, name: "tool", startTimeUnixNano: "0", endTimeUnixNano: "1", attributes: { "agent.trace.type": "tool" } },
    { spanId: "t2", parentSpanId: "t1", name: "tool", startTimeUnixNano: "1", endTimeUnixNano: "2", attributes: { "agent.trace.type": "tool" } },
  ];
  const tree = assembleTraceTree("tr_x", spans);
  assert.equal(predicate(tree, { max_tool_calls_per_turn: 2 }).length, 0);
});

test("excessive_tool_calls_per_turn: respects param override", async () => {
  const spans = [
    { spanId: "t1", parentSpanId: null, name: "tool", startTimeUnixNano: "0", endTimeUnixNano: "1", attributes: { "agent.trace.type": "tool" } },
    { spanId: "t2", parentSpanId: "t1", name: "tool", startTimeUnixNano: "1", endTimeUnixNano: "2", attributes: { "agent.trace.type": "tool" } },
    { spanId: "t3", parentSpanId: "t2", name: "tool", startTimeUnixNano: "2", endTimeUnixNano: "3", attributes: { "agent.trace.type": "tool" } },
  ];
  const tree = assembleTraceTree("tr_x", spans);
  assert.equal(predicate(tree, { max_tool_calls_per_turn: 2 }).length, 1);
});
