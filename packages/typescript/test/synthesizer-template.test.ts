import test from "node:test";
import assert from "node:assert/strict";

import { templateSynthesize } from "../src/trace-ai/diagnose/synthesizer-template.js";
import type { Finding } from "../src/trace-ai/diagnose/types.js";

const finding = (overrides: Partial<Finding> = {}): Finding => ({
  ruleId: "r1",
  judgmentKind: "symbolic",
  severity: "medium",
  symptom: "sym1",
  likelyCause: "lc1",
  evidence: { spans: ["s1"], excerpt: "ex" },
  suggestedFix: { target: "t", change: "c" },
  confidence: "low",
  verifyWith: { suggestedEvalCase: { queryId: null, query: null, assertions: [] } },
  ...overrides,
});

test("templateSynthesize: empty findings → 'No findings' headline, null root cause", () => {
  const s = templateSynthesize([]);
  assert.equal(s.headline, "No findings");
  assert.equal(s.primaryRootCause, null);
  assert.deepEqual(s.fixPriority, []);
  assert.deepEqual(s.crossFindingLinks, []);
});

test("templateSynthesize: single finding → headline references it; root cause = [0]", () => {
  const s = templateSynthesize([finding({ ruleId: "tool_loop", symptom: "tool_loop_sym" })]);
  assert.match(s.headline, /tool_loop_sym/);
  assert.deepEqual(s.primaryRootCause?.findingIds, [0]);
  assert.equal(s.fixPriority.length, 1);
});

test("templateSynthesize: multiple findings → sorted by severity (high > medium > low), highest is root cause", () => {
  const findings = [
    finding({ ruleId: "low_one", severity: "low" }),
    finding({ ruleId: "high_one", severity: "high" }),
    finding({ ruleId: "med_one", severity: "medium" }),
  ];
  const s = templateSynthesize(findings);
  // root cause should reference the high-severity finding's index in the original array
  assert.deepEqual(s.primaryRootCause?.findingIds, [1]);
  assert.equal(s.fixPriority[0].findingId, 1);
  assert.equal(s.fixPriority[1].findingId, 2);
  assert.equal(s.fixPriority[2].findingId, 0);
});

test("templateSynthesize: cross-finding links populate when ≥50% span overlap", () => {
  const findings = [
    finding({ ruleId: "ra", evidence: { spans: ["s1", "s2", "s3"], excerpt: "" } }),
    finding({ ruleId: "rb", evidence: { spans: ["s2", "s3"], excerpt: "" } }),
  ];
  const s = templateSynthesize(findings);
  assert.equal(s.crossFindingLinks.length, 1);
  assert.deepEqual(s.crossFindingLinks[0].findingIds, [0, 1]);
});

test("templateSynthesize: cross-finding links empty when no span overlap", () => {
  const findings = [
    finding({ ruleId: "ra", evidence: { spans: ["s1"], excerpt: "" } }),
    finding({ ruleId: "rb", evidence: { spans: ["s9"], excerpt: "" } }),
  ];
  const s = templateSynthesize(findings);
  assert.deepEqual(s.crossFindingLinks, []);
});

test("templateSynthesize: deterministic — same input → identical output", () => {
  const findings = [finding(), finding({ ruleId: "r2" })];
  const a = templateSynthesize(findings);
  const b = templateSynthesize(findings);
  assert.deepEqual(a, b);
});
