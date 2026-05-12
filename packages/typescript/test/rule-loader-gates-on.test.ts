import test from "node:test";
import assert from "node:assert/strict";

import { RuleSchema } from "../src/trace-ai/diagnose/schemas.js";

const minimalRubricYaml = {
  schema_version: "diagnosis-rule/v1",
  id: "r_g",
  severity: "high",
  symptom: "x",
  taxonomy: { signals_axis: "execution", ms_class: "retry_loop" },
  suggested_fix: { target: "agent.prompt", change_template: "fix" },
  verify_with: { assertion_templates: [] },
  rubric: {
    judge_question: "q",
    inputs: [{ kind: "user_intent", source: "extract_from_root_attr:gen_ai.user.message" }],
    output_schema: {
      type: "object",
      required: ["category", "reasoning", "severity", "first_violating_step_id"],
      properties: {
        category: { type: "string", enum: ["a", "b"] },
        reasoning: { type: "string" },
        severity: { type: "string", enum: ["low", "medium", "high"] },
        first_violating_step_id: { type: "string" },
      },
    },
    agent_binding: { provider: "stub", prompt_template_ref: "builtin:rubric-judge-v1" },
  },
};

test("RuleSchema: gates_on absent → parses with gates_on undefined", () => {
  const parsed = RuleSchema.parse(minimalRubricYaml);
  assert.equal(parsed.rubric?.gates_on, undefined);
});

test("RuleSchema: gates_on present → parsed as string array", () => {
  const withGates = { ...minimalRubricYaml, rubric: { ...minimalRubricYaml.rubric, gates_on: ["tool_loop_no_state_change"] } };
  const parsed = RuleSchema.parse(withGates);
  assert.deepEqual(parsed.rubric?.gates_on, ["tool_loop_no_state_change"]);
});

test("RuleSchema: gates_on multiple symbolic ids", () => {
  const withGates = { ...minimalRubricYaml, rubric: { ...minimalRubricYaml.rubric, gates_on: ["rule_a", "rule_b"] } };
  const parsed = RuleSchema.parse(withGates);
  assert.deepEqual(parsed.rubric?.gates_on, ["rule_a", "rule_b"]);
});

test("RuleSchema: gates_on must be string array (rejects number)", () => {
  const bad = { ...minimalRubricYaml, rubric: { ...minimalRubricYaml.rubric, gates_on: [123] } };
  const r = RuleSchema.safeParse(bad);
  assert.equal(r.success, false);
});
