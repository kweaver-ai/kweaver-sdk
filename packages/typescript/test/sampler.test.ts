import test from "node:test";
import assert from "node:assert/strict";

import { sample } from "../src/trace-ai/scan/sampler.js";
import type { Report } from "../src/trace-ai/diagnose/types.js";

function rep(traceId: string, findings: Array<{ ruleId: string; severity: "low" | "medium" | "high"; judgmentKind?: "symbolic" | "rubric"; likelyCause?: string }>): Report {
  return {
    schemaVersion: "trace-diagnose-report/v1",
    trace: { traceId, agentId: "01KR_x", tenant: null },
    run: { diagnosedAt: "x", cliVersion: "0.7.4", mode: "hybrid", rulesApplied: [], rulesSkipped: [], synthesizerMode: "template" },
    summary: { headline: `h-${traceId}`, primaryRootCause: null, fixPriority: [], crossFindingLinks: [] },
    findings: findings.map((f, i) => ({
      ruleId: f.ruleId,
      judgmentKind: f.judgmentKind ?? "symbolic",
      severity: f.severity,
      symptom: "s",
      likelyCause: f.likelyCause ?? f.ruleId,
      evidence: { spans: [`sp_${traceId}_${i}`], excerpt: `e-${traceId}` },
      suggestedFix: { target: "t", change: "c" },
      confidence: "low",
      verifyWith: { suggestedEvalCase: { queryId: null, query: null, assertions: [] } },
    })),
  };
}

test("sample: dominant rule threshold max(3, 5% of N) — N=10 uses 3", () => {
  const reports = [
    ...[1, 2, 3].map((i) => rep(`tr_${i}`, [{ ruleId: "dominant", severity: "high" }])),
    ...[4, 5, 6, 7, 8, 9, 10].map((i) => rep(`tr_${i}`, [{ ruleId: "rare", severity: "low" }])),
  ];
  const out = sample(reports);
  // dominant fired 3 → meets max(3, 5%*10=1) threshold → included
  assert.ok(out.samples.some((s) => s.selected_as.includes("dominant")));
});

test("sample: dominant rule threshold max(3, 5% of N) — N=100 uses 5", () => {
  const reports = [
    ...Array.from({ length: 4 }, (_, i) => rep(`tr_${i}`, [{ ruleId: "borderline", severity: "high" }])),
    ...Array.from({ length: 96 }, (_, i) => rep(`tr_pad_${i}`, [])),
  ];
  const out = sample(reports);
  // 4 occurrences < max(3, 5%*100=5) → NOT included
  assert.ok(!out.samples.some((s) => s.selected_as.includes("borderline")));
});

test("sample: top-1 per dominant rule by severity", () => {
  const reports = [
    rep("tr_lo", [{ ruleId: "r_dom", severity: "low" }]),
    rep("tr_hi", [{ ruleId: "r_dom", severity: "high" }]),
    rep("tr_md", [{ ruleId: "r_dom", severity: "medium" }]),
  ];
  const out = sample(reports);
  const picked = out.samples.find((s) => s.selected_as.includes("r_dom"));
  assert.ok(picked);
  assert.equal(picked!.trace_id, "tr_hi");
});

test("sample: K=5 hard cap — even with 10 dominant rules, output capped at 5", () => {
  const reports = Array.from({ length: 30 }, (_, i) => {
    const ruleIdx = i % 10;
    return rep(`tr_${i}`, [{ ruleId: `rule_${ruleIdx}`, severity: "high" }]);
  });
  const out = sample(reports);
  assert.ok(out.samples.length <= 5);
});

test("sample: outliers — rubric finding with likelyCause='other' is selected as outlier when no dominant samples saturate K", () => {
  const reports = [
    rep("tr_dom", [{ ruleId: "r_dom", severity: "high" }, { ruleId: "r_dom", severity: "high" }, { ruleId: "r_dom", severity: "high" }]),
    rep("tr_fp1", [{ ruleId: "r_rare", severity: "low", judgmentKind: "rubric", likelyCause: "other" }]),
    rep("tr_dup1", [{ ruleId: "r_dom", severity: "high" }]),
    rep("tr_dup2", [{ ruleId: "r_dom", severity: "high" }]),
  ];
  const out = sample(reports);
  const outlier = out.samples.find((s) => s.selected_as.includes("outlier"));
  assert.ok(outlier, "expected one outlier sample");
});

test("sample: deterministic — same input → identical output", () => {
  const reports = [
    rep("tr_a", [{ ruleId: "r_dom", severity: "high" }]),
    rep("tr_b", [{ ruleId: "r_dom", severity: "high" }]),
    rep("tr_c", [{ ruleId: "r_dom", severity: "high" }]),
  ];
  const a = sample(reports);
  const b = sample(reports);
  assert.deepEqual(a, b);
});
