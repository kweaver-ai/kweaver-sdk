import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { assembleTraceTree } from "../src/trace-core/diagnose/trace-shaper.js";
import { predicate } from "../src/trace-core/diagnose/builtin-rules/llm-response-truncated-no-continue.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function loadTree(p: string) {
  const raw = JSON.parse(await fs.readFile(p, "utf8")) as { hits: { hits: { _source: any }[] } };
  return assembleTraceTree("tr_x", raw.hits.hits.map((h) => h._source));
}

test("llm_response_truncated_no_continue: fires when truncated and no follow-up LLM span", async () => {
  const tree = await loadTree(path.join(__dirname, "fixtures/trace-diagnose/synthetic/llm-response-truncated-no-continue.json"));
  const hits = predicate(tree, {});
  assert.equal(hits.length, 1);
  assert.deepEqual(hits[0].evidenceSpans, ["l1"]);
});

test("llm_response_truncated_no_continue: does NOT fire when a continuation LLM span follows", async () => {
  const spans = [
    { spanId: "l1", parentSpanId: null, name: "chat", startTimeUnixNano: "0", endTimeUnixNano: "1", attributes: { "agent.trace.type": "model", "gen_ai.response.finish_reason": "length", "gen_ai.conversation.id": "c1" } },
    { spanId: "l2", parentSpanId: "l1", name: "chat", startTimeUnixNano: "1", endTimeUnixNano: "2", attributes: { "agent.trace.type": "model", "gen_ai.response.finish_reason": "stop", "gen_ai.conversation.id": "c1" } },
  ];
  const tree = assembleTraceTree("tr_x", spans);
  assert.equal(predicate(tree, {}).length, 0);
});

test("llm_response_truncated_no_continue: does NOT fire when finish_reason != length", async () => {
  const spans = [
    { spanId: "l1", parentSpanId: null, name: "chat", startTimeUnixNano: "0", endTimeUnixNano: "1", attributes: { "agent.trace.type": "model", "gen_ai.response.finish_reason": "stop" } },
  ];
  const tree = assembleTraceTree("tr_x", spans);
  assert.equal(predicate(tree, {}).length, 0);
});
