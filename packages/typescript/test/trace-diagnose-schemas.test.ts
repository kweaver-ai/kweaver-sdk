import test from "node:test";
import assert from "node:assert/strict";

import { RuleSchema, ReportSchema } from "../src/trace-core/diagnose/schemas.js";

test("RuleSchema accepts a minimal valid symbolic rule", () => {
  const ok = RuleSchema.safeParse({
    schema_version: "diagnosis-rule/v1",
    id: "tool_loop_no_state_change",
    severity: "high",
    symptom: "repeated_tool_call_without_state_change",
    taxonomy: { signals_axis: "execution", ms_class: "retry_loop" },
    suggested_fix: { target: "decision_agent.prompt", change_template: "add stop condition" },
    verify_with: { assertion_templates: ["tool_call_count(retrieval) <= 2"] },
    predicate: "builtin:tool_loop_no_state_change",
    params: { min_consecutive: 3 },
  });
  assert.equal(ok.success, true);
});

test("RuleSchema rejects a rule missing taxonomy", () => {
  const bad = RuleSchema.safeParse({
    schema_version: "diagnosis-rule/v1",
    id: "rule_x",
    severity: "high",
    symptom: "s",
    suggested_fix: { target: "t", change_template: "c" },
    verify_with: { assertion_templates: [] },
    predicate: "builtin:x",
  });
  assert.equal(bad.success, false);
});

test("RuleSchema rejects a rule with neither predicate nor rubric", () => {
  const bad = RuleSchema.safeParse({
    schema_version: "diagnosis-rule/v1",
    id: "rule_x",
    severity: "high",
    symptom: "s",
    taxonomy: { signals_axis: "execution", ms_class: "retry_loop" },
    suggested_fix: { target: "t", change_template: "c" },
    verify_with: { assertion_templates: [] },
  });
  assert.equal(bad.success, false);
});

test("ReportSchema accepts a minimal symbolic-only report", () => {
  const ok = ReportSchema.safeParse({
    schema_version: "trace-diagnose-report/v1",
    trace: { trace_id: "tr_x", agent_id: null, tenant: null },
    run: {
      diagnosed_at: "2026-05-11T10:00:00Z",
      cli_version: "0.7.4",
      mode: "symbolic-only",
      rules_applied: ["tool_loop_no_state_change"],
      rules_skipped: [],
      synthesizer_mode: "template",
    },
    summary: {
      headline: "see findings[0]",
      primary_root_cause: null,
      fix_priority: [],
      cross_finding_links: [],
    },
    findings: [],
  });
  assert.equal(ok.success, true);
});
