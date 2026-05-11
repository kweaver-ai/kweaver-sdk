import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { assembleTraceTree } from "../src/trace-core/diagnose/trace-shaper.js";
import { predicate } from "../src/trace-core/diagnose/builtin-rules/tool-error-swallowed.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function loadTree(p: string) {
  const raw = JSON.parse(await fs.readFile(p, "utf8")) as { hits: { hits: { _source: any }[] } };
  return assembleTraceTree("tr_x", raw.hits.hits.map((h) => h._source));
}

test("tool_error_swallowed: fires when next LLM prompt lacks error", async () => {
  const tree = await loadTree(path.join(__dirname, "fixtures/trace-diagnose/synthetic/tool-error-swallowed.json"));
  const hits = predicate(tree, {});
  assert.equal(hits.length, 1);
  assert.deepEqual(hits[0].evidenceSpans, ["t1", "l1"]);
  assert.equal(hits[0].bindings.tool_name, "retrieval");
});

test("tool_error_swallowed: does NOT fire when next prompt mentions the error", async () => {
  const spans = [
    { spanId: "t1", parentSpanId: null, name: "tool", startTimeUnixNano: "0", endTimeUnixNano: "1", status: { code: "ERROR" }, attributes: { "agent.trace.type": "tool", "gen_ai.tool.name": "retrieval", "error.message": "timeout" } },
    { spanId: "l1", parentSpanId: "t1", name: "chat", startTimeUnixNano: "1", endTimeUnixNano: "2", status: { code: "OK" }, attributes: { "agent.trace.type": "model", "gen_ai.prompt": "User: please retry; previous attempt timeout" } },
  ];
  const tree = assembleTraceTree("tr_x", spans);
  assert.equal(predicate(tree, {}).length, 0);
});

test("tool_error_swallowed: does NOT fire when no LLM span follows", async () => {
  const spans = [
    { spanId: "t1", parentSpanId: null, name: "tool", startTimeUnixNano: "0", endTimeUnixNano: "1", status: { code: "ERROR" }, attributes: { "agent.trace.type": "tool", "gen_ai.tool.name": "x", "error.message": "e" } },
  ];
  const tree = assembleTraceTree("tr_x", spans);
  assert.equal(predicate(tree, {}).length, 0);
});
