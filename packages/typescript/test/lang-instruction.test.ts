import test from "node:test";
import assert from "node:assert/strict";

import {
  languageInstructionFor,
  PromptTemplateRegistry,
} from "../src/agent-providers/prompt-template.js";
import { RuleSchema } from "../src/trace-ai/diagnose/schemas.js";
import { rubricOutputToZod } from "../src/trace-ai/diagnose/output-schema-converter.js";
import { evaluateRubricRules } from "../src/trace-ai/diagnose/agent-binding.js";
import { agentSynthesize } from "../src/trace-ai/diagnose/synthesizer-agent.js";
import { AgentRegistry } from "../src/agent-providers/registry.js";
import { StubAgentProvider } from "../src/agent-providers/providers/stub.js";
import type { Finding, Rule, RubricSpec, Span, TraceTree } from "../src/trace-ai/diagnose/types.js";

test("languageInstructionFor('en') returns empty string so the placeholder collapses cleanly", () => {
  assert.equal(languageInstructionFor("en"), "");
});

test("languageInstructionFor('zh') returns a Chinese-output instruction that also forbids translating enum values / span IDs", () => {
  const out = languageInstructionFor("zh");
  assert.match(out, /Simplified Chinese|简体中文/);
  assert.match(out, /JSON keys/);
  assert.match(out, /enum values/);
  assert.match(out, /span IDs/);
});

// ── Integration: agent-binding renders language_instruction into rubric prompt ─

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

function makeTree(spans: Span[]): TraceTree {
  const root = makeSpan({ spanId: "root", kind: "unknown", attributes: { "gen_ai.user.message": "q" } });
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

function buildRubricRule(): Rule {
  const parsed = RuleSchema.parse({
    schema_version: "diagnosis-rule/v1",
    id: "r_lang",
    severity: "high",
    symptom: "x",
    taxonomy: { signals_axis: "execution", ms_class: "retry_loop" },
    suggested_fix: { target: "agent.prompt", change_template: "fix" },
    verify_with: { assertion_templates: [] },
    rubric: {
      judge_question: "lang-test",
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
  });
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
    schemaVersion: parsed.schema_version,
    id: parsed.id,
    severity: parsed.severity,
    symptom: parsed.symptom,
    taxonomy: { signalsAxis: parsed.taxonomy.signals_axis, msClass: parsed.taxonomy.ms_class },
    suggestedFix: { target: parsed.suggested_fix.target, changeTemplate: parsed.suggested_fix.change_template },
    verifyWith: { assertionTemplates: parsed.verify_with.assertion_templates },
    predicateRef: null,
    rubric,
    params: {},
    sourcePath: "mem:r_lang",
  } as Rule;
}

function buildPromptRegistryWithPlaceholder(): PromptTemplateRegistry {
  const reg = new PromptTemplateRegistry();
  // Inline template mirrors the builtin's placeholder shape so we can assert
  // the language_instruction var lands in the rendered prompt.
  reg.registerInline(
    "builtin:rubric-judge-v1",
    "Q: {{judge_question}}\n{{language_instruction}}\nINPUTS:\n{{inputs}}",
  );
  return reg;
}

test("evaluateRubricRules with lang='zh' injects Chinese instruction into the rendered rubric prompt", async () => {
  const rule = buildRubricRule();
  const stub = new StubAgentProvider({
    name: "stub",
    responses: [{ category: "a", reasoning: "ok", severity: "low", first_violating_step_id: "root" }],
  });
  const reg = new AgentRegistry();
  reg.register(stub);
  await evaluateRubricRules({
    rules: [rule],
    tree: makeTree([]),
    registry: reg,
    promptRegistry: buildPromptRegistryWithPlaceholder(),
    lang: "zh",
  });
  assert.equal(stub.calls.length, 1);
  assert.match(stub.calls[0].prompt, /简体中文/);
});

test("evaluateRubricRules default (no lang) leaves rubric prompt English-only (no Chinese instruction)", async () => {
  const rule = buildRubricRule();
  const stub = new StubAgentProvider({
    name: "stub",
    responses: [{ category: "a", reasoning: "ok", severity: "low", first_violating_step_id: "root" }],
  });
  const reg = new AgentRegistry();
  reg.register(stub);
  await evaluateRubricRules({
    rules: [rule],
    tree: makeTree([]),
    registry: reg,
    promptRegistry: buildPromptRegistryWithPlaceholder(),
  });
  assert.equal(stub.calls.length, 1);
  assert.ok(!/简体中文/.test(stub.calls[0].prompt), "default must not inject Chinese instruction");
});

// ── Integration: synthesizer renders language_instruction into its prompt ─────

const dummyFinding: Finding = {
  ruleId: "rule_x",
  judgmentKind: "symbolic",
  severity: "high",
  symptom: "s",
  likelyCause: "s",
  evidence: { spans: ["sp_1"], excerpt: "e" },
  suggestedFix: { target: "agent.prompt", change: "c" },
  confidence: "low",
  verifyWith: { suggestedEvalCase: { queryId: null, query: null, assertions: [] } },
};

function buildSynthPromptRegistry(): PromptTemplateRegistry {
  const reg = new PromptTemplateRegistry();
  reg.registerInline(
    "builtin:within-trace-synthesizer-v1",
    "TRACE {{trace_id}} AGENT {{agent_id}}\n{{language_instruction}}\nFINDINGS:\n{{findings}}\nSCHEMA: {{output_schema}}",
  );
  return reg;
}

test("agentSynthesize with lang='zh' injects Chinese instruction into the synthesizer prompt", async () => {
  const stub = new StubAgentProvider({
    name: "stub",
    responses: [{
      headline: "h",
      primary_root_cause: null,
      fix_priority: [{ finding_id: 0, reason: "r" }],
      cross_finding_links: [],
    }],
  });
  await agentSynthesize({
    findings: [dummyFinding],
    traceId: "tr_x",
    agentId: "agent_x",
    provider: stub,
    promptRegistry: buildSynthPromptRegistry(),
    lang: "zh",
  });
  assert.equal(stub.calls.length, 1);
  assert.match(stub.calls[0].prompt, /简体中文/);
});

test("agentSynthesize default (no lang) leaves the synthesizer prompt English-only", async () => {
  const stub = new StubAgentProvider({
    name: "stub",
    responses: [{
      headline: "h",
      primary_root_cause: null,
      fix_priority: [{ finding_id: 0, reason: "r" }],
      cross_finding_links: [],
    }],
  });
  await agentSynthesize({
    findings: [dummyFinding],
    traceId: "tr_x",
    agentId: "agent_x",
    provider: stub,
    promptRegistry: buildSynthPromptRegistry(),
  });
  assert.equal(stub.calls.length, 1);
  assert.ok(!/简体中文/.test(stub.calls[0].prompt), "default must not inject Chinese instruction");
});
