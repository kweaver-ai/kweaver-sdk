import test from "node:test";
import assert from "node:assert/strict";

import { assembleReport } from "../src/trace-ai/diagnose/report-assembler.js";
import type { Hit, Rule, Summary } from "../src/trace-ai/diagnose/types.js";

const ruleA: Rule = {
  schemaVersion: "diagnosis-rule/v1",
  id: "rule_a",
  severity: "high",
  symptom: "sym_a",
  taxonomy: { signalsAxis: "execution", msClass: "retry_loop" },
  suggestedFix: { target: "agent.prompt", changeTemplate: "stop after {{count}} retries" },
  verifyWith: { assertionTemplates: ["count({{tool}}) <= 2"] },
  predicateRef: "builtin:rule_a",
  rubric: null,
  params: {},
  sourcePath: "mem:rule_a",
};

const summary: Summary = {
  headline: "h",
  primaryRootCause: null,
  fixPriority: [],
  crossFindingLinks: [],
};

test("assembleReport: renders changeTemplate with hit bindings", () => {
  const hits = new Map<string, Hit[]>([
    ["rule_a", [{
      evidenceSpans: ["s1", "s2"],
      excerpt: "x",
      bindings: { count: 3, tool: "retrieval" },
    }]],
  ]);
  const r = assembleReport({
    traceId: "tr_x",
    agentId: null,
    tenant: null,
    cliVersion: "0.7.4",
    rules: [ruleA],
    hits,
    summary,
  });
  assert.equal(r.findings.length, 1);
  assert.equal(r.findings[0].suggestedFix.change, "stop after 3 retries");
  assert.deepEqual(r.findings[0].verifyWith.suggestedEvalCase.assertions, ["count(retrieval) <= 2"]);
});

test("assembleReport: zero hits → empty findings, summary preserved", () => {
  const r = assembleReport({
    traceId: "tr_x",
    agentId: null,
    tenant: null,
    cliVersion: "0.7.4",
    rules: [ruleA],
    hits: new Map([["rule_a", []]]),
    summary: { headline: "No findings", primaryRootCause: null, fixPriority: [], crossFindingLinks: [] },
  });
  assert.equal(r.findings.length, 0);
  assert.equal(r.summary.headline, "No findings");
});

test("assembleReport: writes rules_applied and rules_skipped correctly", () => {
  const r = assembleReport({
    traceId: "tr_x",
    agentId: null,
    tenant: null,
    cliVersion: "0.7.4",
    rules: [ruleA],
    hits: new Map([["rule_a", []]]),
    summary,
  });
  assert.deepEqual(r.run.rulesApplied, ["rule_a"]);
  assert.deepEqual(r.run.rulesSkipped, []);
  assert.equal(r.run.mode, "symbolic-only");
  assert.equal(r.run.synthesizerMode, "template");
});

test("assembleReport: output passes ReportSchema (raw form)", async () => {
  const { ReportSchema } = await import("../src/trace-ai/diagnose/schemas.js");
  const { reportToYamlObject } = await import("../src/trace-ai/diagnose/report-assembler.js");
  const r = assembleReport({
    traceId: "tr_x",
    agentId: null,
    tenant: null,
    cliVersion: "0.7.4",
    rules: [ruleA],
    hits: new Map([["rule_a", []]]),
    summary,
  });
  const raw = reportToYamlObject(r);
  const result = ReportSchema.safeParse(raw);
  assert.equal(result.success, true);
});
