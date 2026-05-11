import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { assembleTraceTree } from "../src/trace-core/diagnose/trace-shaper.js";
import { predicate } from "../src/trace-core/diagnose/builtin-rules/tool-loop-no-state-change.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function loadTree(fixturePath: string) {
  const raw = JSON.parse(await fs.readFile(fixturePath, "utf8")) as { hits: { hits: { _source: any }[] } };
  return assembleTraceTree("tr_x", raw.hits.hits.map((h) => h._source));
}

test("tool_loop_no_state_change: fires on synthetic fixture", async () => {
  const tree = await loadTree(path.join(__dirname, "fixtures/trace-diagnose/synthetic/tool-loop-no-state-change.json"));
  const hits = predicate(tree, { min_consecutive: 3 });
  assert.equal(hits.length, 1);
  assert.equal(hits[0].evidenceSpans.length, 3);
  assert.deepEqual(hits[0].evidenceSpans, ["t1", "t2", "t3"]);
  assert.equal(hits[0].bindings.tool_name, "retrieval");
  assert.equal(hits[0].bindings.loop_count, 3);
  assert.equal(hits[0].bindings.max_count, 2);
});

test("tool_loop_no_state_change: does NOT fire when args differ", async () => {
  const spans = [
    { spanId: "t1", parentSpanId: null, name: "tool", startTimeUnixNano: "0", endTimeUnixNano: "1", attributes: { "agent.trace.type": "tool", "gen_ai.tool.name": "retrieval", "gen_ai.tool.args": { q: "a" } } },
    { spanId: "t2", parentSpanId: "t1", name: "tool", startTimeUnixNano: "1", endTimeUnixNano: "2", attributes: { "agent.trace.type": "tool", "gen_ai.tool.name": "retrieval", "gen_ai.tool.args": { q: "b" } } },
    { spanId: "t3", parentSpanId: "t1", name: "tool", startTimeUnixNano: "2", endTimeUnixNano: "3", attributes: { "agent.trace.type": "tool", "gen_ai.tool.name": "retrieval", "gen_ai.tool.args": { q: "c" } } },
  ];
  const tree = assembleTraceTree("tr_x", spans);
  const hits = predicate(tree, { min_consecutive: 3 });
  assert.equal(hits.length, 0);
});

test("tool_loop_no_state_change: does NOT fire when state changes between calls", async () => {
  const spans = [
    { spanId: "t1", parentSpanId: null, name: "tool", startTimeUnixNano: "0", endTimeUnixNano: "1", attributes: { "agent.trace.type": "tool", "gen_ai.tool.name": "x", "gen_ai.tool.args": {}, "gen_ai.conversation.state": "v1" } },
    { spanId: "t2", parentSpanId: "t1", name: "tool", startTimeUnixNano: "1", endTimeUnixNano: "2", attributes: { "agent.trace.type": "tool", "gen_ai.tool.name": "x", "gen_ai.tool.args": {}, "gen_ai.conversation.state": "v2" } },
    { spanId: "t3", parentSpanId: "t1", name: "tool", startTimeUnixNano: "2", endTimeUnixNano: "3", attributes: { "agent.trace.type": "tool", "gen_ai.tool.name": "x", "gen_ai.tool.args": {}, "gen_ai.conversation.state": "v3" } },
  ];
  const tree = assembleTraceTree("tr_x", spans);
  const hits = predicate(tree, { min_consecutive: 3 });
  assert.equal(hits.length, 0);
});

test("tool_loop_no_state_change: respects min_consecutive param", async () => {
  // 2 same calls — should NOT fire with default 3
  const spans = [
    { spanId: "t1", parentSpanId: null, name: "tool", startTimeUnixNano: "0", endTimeUnixNano: "1", attributes: { "agent.trace.type": "tool", "gen_ai.tool.name": "x", "gen_ai.tool.args": {} } },
    { spanId: "t2", parentSpanId: "t1", name: "tool", startTimeUnixNano: "1", endTimeUnixNano: "2", attributes: { "agent.trace.type": "tool", "gen_ai.tool.name": "x", "gen_ai.tool.args": {} } },
  ];
  const tree = assembleTraceTree("tr_x", spans);
  assert.equal(predicate(tree, { min_consecutive: 3 }).length, 0);
  // But should fire with min_consecutive=2
  assert.equal(predicate(tree, { min_consecutive: 2 }).length, 1);
});
