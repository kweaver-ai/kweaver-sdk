import test from "node:test";
import assert from "node:assert/strict";

import { RuleSchema } from "../src/trace-ai/diagnose/schemas.js";
import { rubricOutputToZod } from "../src/trace-ai/diagnose/output-schema-converter.js";
import {
  evaluateRubricRules,
  resolveRubricInput,
  AgentBindingError,
} from "../src/trace-ai/diagnose/agent-binding.js";
import { AgentRegistry } from "../src/agent-providers/registry.js";
import {
  PromptTemplateRegistry,
} from "../src/agent-providers/prompt-template.js";
import { StubAgentProvider } from "../src/agent-providers/providers/stub.js";
import type { Rule, RubricSpec, Span, TraceTree } from "../src/trace-ai/diagnose/types.js";

function makeSpan(partial: Partial<Span> & Pick<Span, "spanId" | "kind">): Span {
  return {
    parentSpanId: null,
    name: partial.spanId,
    startTimeUnixNano: "0",
    endTimeUnixNano: "1000000",
    durationMs: 1,
    status: "ok",
    attributes: {},
    ...partial,
  } as Span;
}

function makeTree(spans: Span[], rootAttrs: Record<string, unknown> = {}): TraceTree {
  const root = makeSpan({ spanId: "root", kind: "unknown", attributes: rootAttrs });
  const all = [root, ...spans];
  const byId = new Map<string, Span>();
  const byKind = new Map<Span["kind"], Span[]>();
  const parentToChildren = new Map<string | null, Span[]>();
  for (const s of all) {
    byId.set(s.spanId, s);
    const arr = byKind.get(s.kind) ?? [];
    arr.push(s);
    byKind.set(s.kind, arr);
    const arr2 = parentToChildren.get(s.parentSpanId) ?? [];
    arr2.push(s);
    parentToChildren.set(s.parentSpanId, arr2);
  }
  return { traceId: "tr_x", spans: all, byId, parentToChildren, byKind, root };
}

const validRubricYaml = {
  schema_version: "diagnosis-rule/v1",
  id: "tool_retry_intent_mismatch",
  severity: "high",
  symptom: "repeated_tool_call_without_state_change",
  taxonomy: { signals_axis: "execution", ms_class: "retry_loop" },
  suggested_fix: { target: "decision_agent.prompt", change_template: "fix-{{category}}" },
  verify_with: { assertion_templates: [] },
  rubric: {
    judge_question: "Was this retry legitimate or stale_results?",
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
        confidence: { type: "string", enum: ["low", "medium", "high"] },
        first_violating_step_id: { type: "string" },
        evidence_span_ids: { type: "array", items: { type: "string" } },
      },
    },
    agent_binding: { provider: "stub", prompt_template_ref: "builtin:rubric-judge-v1" },
  },
};

function buildRule(): Rule {
  const parsed = RuleSchema.parse(validRubricYaml);
  const rubric: RubricSpec = {
    judgeQuestion: parsed.rubric!.judge_question,
    inputs: parsed.rubric!.inputs.map((i) => ({ kind: i.kind, source: i.source })),
    outputSchemaRaw: parsed.rubric!.output_schema as unknown as Record<string, unknown>,
    outputZodSchema: rubricOutputToZod(parsed.rubric!),
    agentBinding: {
      provider: parsed.rubric!.agent_binding.provider,
      promptTemplateRef: parsed.rubric!.agent_binding.prompt_template_ref,
    },
  };
  return {
    schemaVersion: "diagnosis-rule/v1",
    id: parsed.id,
    severity: parsed.severity,
    symptom: parsed.symptom,
    taxonomy: { signalsAxis: parsed.taxonomy.signals_axis, msClass: parsed.taxonomy.ms_class },
    suggestedFix: {
      target: parsed.suggested_fix.target,
      changeTemplate: parsed.suggested_fix.change_template,
    },
    verifyWith: { assertionTemplates: parsed.verify_with.assertion_templates },
    predicateRef: null,
    rubric,
    params: parsed.params,
    sourcePath: "mem:test",
  };
}

function buildPromptRegistry(): PromptTemplateRegistry {
  const reg = new PromptTemplateRegistry();
  reg.registerInline(
    "builtin:rubric-judge-v1",
    "Q: {{judge_question}}\nINPUTS:\n{{inputs}}",
  );
  return reg;
}

// ── resolveRubricInput ──────────────────────────────────────────────────────

test("resolveRubricInput: extract_from_root_attr dotted path", () => {
  const tree = makeTree([], { "gen_ai.user.message": "hello world" });
  const v = resolveRubricInput(
    { kind: "user_intent", source: "extract_from_root_attr:gen_ai.user.message" },
    tree,
  );
  assert.equal(v, "hello world");
});

test("resolveRubricInput: extract_from_root_attr missing path → undefined", () => {
  const tree = makeTree([], {});
  const v = resolveRubricInput(
    { kind: "x", source: "extract_from_root_attr:missing.nested" },
    tree,
  );
  assert.equal(v, undefined);
});

test("resolveRubricInput: filter_by_kind returns chronologically ordered spans", () => {
  const tree = makeTree([
    makeSpan({ spanId: "a", kind: "tool", startTimeUnixNano: "2000" }),
    makeSpan({ spanId: "b", kind: "llm", startTimeUnixNano: "1000" }),
    makeSpan({ spanId: "c", kind: "tool", startTimeUnixNano: "3000" }),
  ]);
  const v = resolveRubricInput(
    { kind: "span_sequence", source: "filter_by_kind:[tool,llm]" },
    tree,
  );
  assert.ok(Array.isArray(v));
  const ids = (v as Array<{ spanId: string }>).map((s) => s.spanId);
  assert.deepEqual(ids, ["b", "a", "c"]);
});

test("resolveRubricInput: literal scheme parses JSON", () => {
  const tree = makeTree([]);
  const v = resolveRubricInput({ kind: "fixture", source: 'literal:{"k":1}' }, tree);
  assert.deepEqual(v, { k: 1 });
});

test("resolveRubricInput: unknown scheme throws AgentBindingError", () => {
  const tree = makeTree([]);
  assert.throws(
    () => resolveRubricInput({ kind: "x", source: "unknown:foo" }, tree),
    AgentBindingError,
  );
});

// ── evaluateRubricRules ─────────────────────────────────────────────────────

test("evaluateRubricRules: noLlm=true skips all rubric rules with reason='no-llm-flag-set'", async () => {
  const rule = buildRule();
  const reg = new AgentRegistry();
  reg.register(new StubAgentProvider({ name: "stub" }));
  const result = await evaluateRubricRules({
    rules: [rule],
    tree: makeTree([]),
    registry: reg,
    promptRegistry: buildPromptRegistry(),
    noLlm: true,
  });
  assert.equal(result.findings.length, 0);
  assert.deepEqual(result.skipped, [{ ruleId: rule.id, reason: "no-llm-flag-set" }]);
});

test("evaluateRubricRules: unavailable provider → skip with 'provider-not-available:'", async () => {
  const rule = buildRule();
  const reg = new AgentRegistry();
  reg.register(new StubAgentProvider({ name: "stub", unavailable: true }));
  const result = await evaluateRubricRules({
    rules: [rule],
    tree: makeTree([]),
    registry: reg,
    promptRegistry: buildPromptRegistry(),
  });
  assert.equal(result.findings.length, 0);
  assert.equal(result.skipped[0].reason, "provider-not-available:stub");
});

test("evaluateRubricRules: missing prompt template → skip with 'prompt-template-missing:'", async () => {
  const rule = buildRule();
  const reg = new AgentRegistry();
  reg.register(new StubAgentProvider({ name: "stub" }));
  const result = await evaluateRubricRules({
    rules: [rule],
    tree: makeTree([]),
    registry: reg,
    promptRegistry: new PromptTemplateRegistry(),  // empty
  });
  assert.equal(result.findings.length, 0);
  assert.equal(result.skipped[0].reason, "prompt-template-missing:builtin:rubric-judge-v1");
});

test("evaluateRubricRules: happy path produces rubric Finding with first_violating_step_id in evidence.spans", async () => {
  const rule = buildRule();
  const tree = makeTree(
    [
      makeSpan({ spanId: "sp_tool_1", kind: "tool", startTimeUnixNano: "1000" }),
      makeSpan({ spanId: "sp_tool_2", kind: "tool", startTimeUnixNano: "2000" }),
    ],
    { "gen_ai.user.message": "find me the refund policy" },
  );
  const reg = new AgentRegistry();
  reg.register(new StubAgentProvider({
    name: "stub",
    responses: [{
      category: "stale_results",
      reasoning: "tool returned identical empty result; agent failed to recognize staleness",
      severity: "high",
      confidence: "high",
      first_violating_step_id: "sp_tool_2",
      evidence_span_ids: ["sp_tool_1"],
    }],
  }));
  const result = await evaluateRubricRules({
    rules: [rule],
    tree,
    registry: reg,
    promptRegistry: buildPromptRegistry(),
  });
  assert.equal(result.skipped.length, 0);
  assert.equal(result.findings.length, 1);
  const f = result.findings[0];
  assert.equal(f.judgmentKind, "rubric");
  assert.equal(f.severity, "high");
  assert.equal(f.confidence, "high");
  assert.equal(f.likelyCause, "stale_results");
  // first_violating_step_id always in spans (convergence contract)
  assert.ok(f.evidence.spans.includes("sp_tool_2"));
  assert.ok(f.evidence.spans.includes("sp_tool_1"));
  // changeTemplate {{category}} rendered from agent output
  assert.equal(f.suggestedFix.change, "fix-stale_results");
});

test("evaluateRubricRules: schema_violation from provider → skipped as 'agent-error:schema_violation'", async () => {
  const rule = buildRule();
  const reg = new AgentRegistry();
  reg.register(new StubAgentProvider({
    name: "stub",
    responses: [{ category: "INVALID", reasoning: "", severity: "high", first_violating_step_id: "sp_x" }],
  }));
  const result = await evaluateRubricRules({
    rules: [rule],
    tree: makeTree([]),
    registry: reg,
    promptRegistry: buildPromptRegistry(),
  });
  assert.equal(result.findings.length, 0);
  assert.equal(result.skipped[0].reason, "agent-error:schema_violation");
});

test("evaluateRubricRules: prompt is rendered with judge_question and serialized inputs", async () => {
  const rule = buildRule();
  const tree = makeTree(
    [makeSpan({ spanId: "sp_tool_2", kind: "tool" })],
    { "gen_ai.user.message": "refund policy" },
  );
  const stub = new StubAgentProvider({
    name: "stub",
    responseFn: () => ({
      category: "legitimate_retry",
      reasoning: "ok",
      severity: "low",
      first_violating_step_id: "sp_tool_2",
    }),
  });
  const reg = new AgentRegistry();
  reg.register(stub);
  await evaluateRubricRules({
    rules: [rule],
    tree,
    registry: reg,
    promptRegistry: buildPromptRegistry(),
  });
  assert.equal(stub.calls.length, 1);
  const prompt = stub.calls[0].prompt;
  assert.match(prompt, /Was this retry legitimate or stale_results\?/);
  assert.match(prompt, /user_intent/);
  assert.match(prompt, /sp_tool_2/);
});
