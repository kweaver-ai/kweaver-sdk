import test from "node:test";
import assert from "node:assert/strict";

import { RuleSchema, ReportSchema } from "../src/trace-ai/diagnose/schemas.js";
import { rubricOutputToZod, OutputSchemaConversionError } from "../src/trace-ai/diagnose/output-schema-converter.js";

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

// ── rubric branch ───────────────────────────────────────────────────────────

const validRubricRule = {
  schema_version: "diagnosis-rule/v1",
  id: "tool_retry_intent_mismatch",
  severity: "high",
  symptom: "repeated_tool_call_without_state_change",
  taxonomy: { signals_axis: "execution", ms_class: "retry_loop" },
  suggested_fix: { target: "decision_agent.prompt", change_template: "..." },
  verify_with: { assertion_templates: [] },
  rubric: {
    judge_question: "Was this retry legitimate or stale_results handling failure?",
    inputs: [
      { kind: "user_intent", source: "extract_from_root_attr:gen_ai.user.message" },
      { kind: "span_sequence", source: "filter_by_kind:[tool,llm]" },
    ],
    output_schema: {
      type: "object",
      required: ["category", "reasoning", "severity", "first_violating_step_id"],
      properties: {
        category: { type: "string", enum: ["legitimate_retry", "stale_results", "prompt_confusion", "other"] },
        reasoning: { type: "string" },
        severity: { type: "string", enum: ["low", "medium", "high"] },
        first_violating_step_id: { type: "string" },
        evidence_span_ids: { type: "array", items: { type: "string" } },
      },
    },
    agent_binding: { provider: "claude-code", prompt_template_ref: "builtin:rubric-judge-v1" },
  },
};

test("RuleSchema accepts a valid rubric rule", () => {
  const ok = RuleSchema.safeParse(validRubricRule);
  assert.equal(ok.success, true, ok.success ? "" : JSON.stringify((ok as any).error?.issues));
});

test("RuleSchema rejects rubric rule whose output_schema.required omits first_violating_step_id", () => {
  const bad = {
    ...validRubricRule,
    rubric: {
      ...validRubricRule.rubric,
      output_schema: {
        ...validRubricRule.rubric.output_schema,
        required: ["category", "reasoning", "severity"],  // missing the convergence key
      },
    },
  };
  const r = RuleSchema.safeParse(bad);
  assert.equal(r.success, false);
  if (!r.success) {
    assert.match(JSON.stringify(r.error.issues), /first_violating_step_id/);
  }
});

test("RuleSchema rejects rule that defines BOTH predicate and rubric (XOR)", () => {
  const bad = { ...validRubricRule, predicate: "builtin:foo" };
  assert.equal(RuleSchema.safeParse(bad).success, false);
});

// ── output schema → zod converter ───────────────────────────────────────────

test("rubricOutputToZod: produces a zod schema that round-trips a valid response", () => {
  const parsed = RuleSchema.parse(validRubricRule);
  const zodSchema = rubricOutputToZod(parsed.rubric!);
  const result = zodSchema.safeParse({
    category: "stale_results",
    reasoning: "tool returned identical empty result twice",
    severity: "high",
    first_violating_step_id: "sp_3",
    evidence_span_ids: ["sp_3", "sp_4"],
  });
  assert.equal(result.success, true, result.success ? "" : JSON.stringify((result as any).error?.issues));
});

test("rubricOutputToZod: enforces enum constraint on category", () => {
  const parsed = RuleSchema.parse(validRubricRule);
  const zodSchema = rubricOutputToZod(parsed.rubric!);
  const result = zodSchema.safeParse({
    category: "not_in_enum",
    reasoning: "x",
    severity: "high",
    first_violating_step_id: "sp_3",
  });
  assert.equal(result.success, false);
});

test("rubricOutputToZod: rejects unsupported type 'integer'", () => {
  assert.throws(
    () => rubricOutputToZod({
      judge_question: "q",
      inputs: [],
      output_schema: {
        type: "object",
        required: ["first_violating_step_id", "count"],
        properties: {
          first_violating_step_id: { type: "string" },
          count: { type: "integer" },  // unsupported
        },
      },
      agent_binding: { provider: "x", prompt_template_ref: "builtin:y" },
    }),
    OutputSchemaConversionError,
  );
});

test("rubricOutputToZod: nested array of objects works", () => {
  const zodSchema = rubricOutputToZod({
    judge_question: "q",
    inputs: [],
    output_schema: {
      type: "object",
      required: ["first_violating_step_id", "details"],
      properties: {
        first_violating_step_id: { type: "string" },
        details: {
          type: "array",
          items: {
            type: "object",
            required: ["k"],
            properties: { k: { type: "string" }, v: { type: "number" } },
          },
        },
      },
    },
    agent_binding: { provider: "x", prompt_template_ref: "builtin:y" },
  });
  const ok = zodSchema.safeParse({
    first_violating_step_id: "sp",
    details: [{ k: "a", v: 1 }, { k: "b" }],
  });
  assert.equal(ok.success, true);
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
