import test from "node:test";
import assert from "node:assert/strict";

import { aggregate } from "../src/trace-ai/scan/aggregator.js";
import type { Report } from "../src/trace-ai/diagnose/types.js";

function fakeReport(traceId: string, findings: Array<{ ruleId: string; severity: "low" | "medium" | "high" }>): Report {
  return {
    schemaVersion: "trace-diagnose-report/v1",
    trace: { traceId, agentId: "01KR_x", tenant: null },
    run: { diagnosedAt: "x", cliVersion: "0.7.4", mode: "hybrid", rulesApplied: [], rulesSkipped: [], synthesizerMode: "template" },
    summary: { headline: "h", primaryRootCause: null, fixPriority: [], crossFindingLinks: [] },
    findings: findings.map((f, i) => ({
      ruleId: f.ruleId,
      judgmentKind: "symbolic",
      severity: f.severity,
      symptom: "s",
      likelyCause: "l",
      evidence: { spans: [`sp_${traceId}_${i}`], excerpt: "e" },
      suggestedFix: { target: "t", change: "c" },
      confidence: "low",
      verifyWith: { suggestedEvalCase: { queryId: null, query: null, assertions: [] } },
    })),
  };
}

test("aggregate: rule_frequency counts each rule across reports", () => {
  const reports = [
    fakeReport("tr_1", [{ ruleId: "rule_a", severity: "high" }, { ruleId: "rule_b", severity: "medium" }]),
    fakeReport("tr_2", [{ ruleId: "rule_a", severity: "high" }]),
    fakeReport("tr_3", [{ ruleId: "rule_b", severity: "low" }]),
  ];
  const agg = aggregate(reports);
  const a = agg.rule_frequency.find((r) => r.rule_id === "rule_a")!;
  const b = agg.rule_frequency.find((r) => r.rule_id === "rule_b")!;
  assert.equal(a.count, 2);
  assert.deepEqual(a.severity_breakdown, { high: 2, medium: 0, low: 0 });
  assert.equal(b.count, 2);
  assert.deepEqual(b.severity_breakdown, { high: 0, medium: 1, low: 1 });
});

test("aggregate: rule_frequency sorted by count descending", () => {
  const reports = [
    fakeReport("tr_1", [{ ruleId: "rule_a", severity: "high" }]),
    fakeReport("tr_2", [{ ruleId: "rule_b", severity: "high" }, { ruleId: "rule_b", severity: "high" }]),
    fakeReport("tr_3", [{ ruleId: "rule_b", severity: "high" }]),
  ];
  const agg = aggregate(reports);
  assert.equal(agg.rule_frequency[0].rule_id, "rule_b");
  assert.equal(agg.rule_frequency[1].rule_id, "rule_a");
});

test("aggregate: deterministic — same input → identical output (rule_id tie-break alphabetical)", () => {
  const r1 = fakeReport("tr_1", [{ ruleId: "z_rule", severity: "high" }, { ruleId: "a_rule", severity: "high" }]);
  const a = aggregate([r1]);
  const b = aggregate([r1]);
  assert.deepEqual(a, b);
  // Same count both → alphabetical
  assert.equal(a.rule_frequency[0].rule_id, "a_rule");
  assert.equal(a.rule_frequency[1].rule_id, "z_rule");
});

test("aggregate: empty reports → empty rule_frequency", () => {
  const agg = aggregate([]);
  assert.deepEqual(agg.rule_frequency, []);
});

test("aggregate: severity_breakdown sum equals count", () => {
  const reports = [
    fakeReport("tr_1", [{ ruleId: "r", severity: "high" }, { ruleId: "r", severity: "medium" }, { ruleId: "r", severity: "low" }]),
  ];
  const agg = aggregate(reports);
  const item = agg.rule_frequency[0];
  assert.equal(item.severity_breakdown.high + item.severity_breakdown.medium + item.severity_breakdown.low, item.count);
});
