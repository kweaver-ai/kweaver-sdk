import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { assembleTraceTree } from "../src/trace-core/diagnose/trace-shaper.js";
import { predicate } from "../src/trace-core/diagnose/builtin-rules/retrieval-empty-no-fallback.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function loadTree(p: string) {
  const raw = JSON.parse(await fs.readFile(p, "utf8")) as { hits: { hits: { _source: any }[] } };
  return assembleTraceTree("tr_x", raw.hits.hits.map((h) => h._source));
}

test("retrieval_empty_no_fallback: fires when next span is LLM after empty retrieval", async () => {
  const tree = await loadTree(path.join(__dirname, "fixtures/trace-diagnose/synthetic/retrieval-empty-no-fallback.json"));
  const hits = predicate(tree, {});
  assert.equal(hits.length, 1);
  assert.deepEqual(hits[0].evidenceSpans, ["r1", "l1"]);
});

test("retrieval_empty_no_fallback: does NOT fire when next span is another retrieval", async () => {
  const spans = [
    { spanId: "r1", parentSpanId: null, name: "retrieval", startTimeUnixNano: "0", endTimeUnixNano: "1", attributes: { "agent.trace.type": "retrieval", "gen_ai.retrieval.result_count": 0 } },
    { spanId: "r2", parentSpanId: "r1", name: "retrieval", startTimeUnixNano: "1", endTimeUnixNano: "2", attributes: { "agent.trace.type": "retrieval", "gen_ai.retrieval.result_count": 5 } },
  ];
  const tree = assembleTraceTree("tr_x", spans);
  assert.equal(predicate(tree, {}).length, 0);
});

test("retrieval_empty_no_fallback: does NOT fire when retrieval has results", async () => {
  const spans = [
    { spanId: "r1", parentSpanId: null, name: "retrieval", startTimeUnixNano: "0", endTimeUnixNano: "1", attributes: { "agent.trace.type": "retrieval", "gen_ai.retrieval.result_count": 3 } },
    { spanId: "l1", parentSpanId: "r1", name: "chat", startTimeUnixNano: "1", endTimeUnixNano: "2", attributes: { "agent.trace.type": "model" } },
  ];
  const tree = assembleTraceTree("tr_x", spans);
  assert.equal(predicate(tree, {}).length, 0);
});
