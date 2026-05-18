// test/exp-triage-attribution.test.ts
import test from "node:test";
import assert from "node:assert/strict";
import { parseTriageOutput } from "../src/trace-ai/exp/providers/triage-client.js";

test("parseTriageOutput: parses verdict + summary + failure_attribution + next_change", () => {
  const raw = JSON.stringify({
    verdict: "continue",
    summary: "outcome=0.29",
    failure_attribution: [
      { layer: "kn", evidence: "no vehicle_sales", affected_queries: ["Q36"], suggested_target: "kn.object_type" },
      { layer: "skill", evidence: "no sort_by", affected_queries: ["Q52", "Q54"], suggested_target: "skill.content" },
    ],
    next_change: {
      target: "kn.object_type",
      hypothesis: "add vehicle_sales",
      patch: { kn_id: "kn-x", add_object_types: [], add_relation_types: [] },
    },
  });
  const result = parseTriageOutput(raw);
  assert.equal(result.verdict, "continue");
  assert.equal(result.failure_attribution.length, 2);
  assert.equal(result.failure_attribution[0].layer, "kn");
  assert.equal(result.failure_attribution[0].suggested_target, "kn.object_type");
  assert.deepEqual(result.failure_attribution[1].affected_queries, ["Q52", "Q54"]);
  assert.ok(result.next_change);
  assert.equal(result.next_change!.target, "kn.object_type");
});

test("parseTriageOutput: throws when verdict=continue but next_change missing", () => {
  const raw = JSON.stringify({ verdict: "continue", summary: "x", failure_attribution: [] });
  assert.throws(() => parseTriageOutput(raw), /next_change/);
});

test("parseTriageOutput: publish/abort omit next_change", () => {
  const pub = parseTriageOutput(JSON.stringify({ verdict: "publish", summary: "done" }));
  assert.equal(pub.next_change, undefined);
  const ab = parseTriageOutput(JSON.stringify({ verdict: "abort", summary: "stuck" }));
  assert.equal(ab.next_change, undefined);
});

test("parseTriageOutput: missing failure_attribution defaults to []", () => {
  const result = parseTriageOutput(JSON.stringify({ verdict: "publish", summary: "great" }));
  assert.deepEqual(result.failure_attribution, []);
});

test("parseTriageOutput: throws on invalid verdict", () => {
  assert.throws(() => parseTriageOutput(JSON.stringify({ verdict: "maybe", summary: "?" })), /verdict/);
});

test("parseTriageOutput: throws on non-JSON input", () => {
  assert.throws(() => parseTriageOutput("not json"), /JSON/);
});

test("parseTriageOutput: throws on invalid failure_attribution item", () => {
  const raw = JSON.stringify({
    verdict: "continue", summary: "x",
    failure_attribution: [{ layer: "database", evidence: "x", affected_queries: [], suggested_target: "kn.object_type" }],
  });
  assert.throws(() => parseTriageOutput(raw));
});
