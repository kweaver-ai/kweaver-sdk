// test/exp-coordinator-multilayer.test.ts
import test from "node:test";
import assert from "node:assert/strict";
import { formatFailureAttribution } from "../src/trace-ai/exp/index.js";
import type { FailureAttribution } from "../src/trace-ai/exp/schemas.js";

test("formatFailureAttribution: renders layer, evidence, queries, target", () => {
  const attribution: FailureAttribution[] = [
    { layer: "kn", evidence: "vehicle_sales missing from KN", affected_queries: ["Q36"], suggested_target: "kn.object_type" },
    { layer: "skill", evidence: "no sort_by in query_object_instance", affected_queries: ["Q52", "Q54"], suggested_target: "skill.content" },
    { layer: "agent", evidence: "wrong concept type selected", affected_queries: ["Q42"], suggested_target: "agent.system_prompt" },
  ];
  const output = formatFailureAttribution(attribution);
  assert.match(output, /\[kn\]/);
  assert.match(output, /Q36/);
  assert.match(output, /kn\.object_type/);
  assert.match(output, /\[skill\]/);
  assert.match(output, /Q52, Q54/);
  assert.match(output, /skill\.content/);
  assert.match(output, /\[agent\]/);
  assert.match(output, /agent\.system_prompt/);
});

test("formatFailureAttribution: empty returns empty string", () => {
  assert.equal(formatFailureAttribution([]).trim(), "");
});

test("formatFailureAttribution: single entry renders without crash", () => {
  const output = formatFailureAttribution([
    { layer: "skill", evidence: "no pagination", affected_queries: ["Q1"], suggested_target: "skill.content" },
  ]);
  assert.match(output, /skill/);
  assert.match(output, /Q1/);
});
