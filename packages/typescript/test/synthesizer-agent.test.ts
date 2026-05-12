import test from "node:test";
import assert from "node:assert/strict";

import { agentSynthesize } from "../src/trace-ai/diagnose/synthesizer-agent.js";
import { PromptTemplateRegistry } from "../src/agent-providers/prompt-template.js";
import { StubAgentProvider } from "../src/agent-providers/providers/stub.js";
import type { Finding } from "../src/trace-ai/diagnose/types.js";

function makeFinding(overrides: Partial<Finding> = {}): Finding {
  return {
    ruleId: "tool_loop_no_state_change",
    judgmentKind: "symbolic",
    severity: "high",
    symptom: "repeated_tool_call_without_state_change",
    likelyCause: "missing_termination_condition",
    evidence: { spans: ["sp_a", "sp_b"], excerpt: "x" },
    suggestedFix: { target: "decision_agent.prompt", change: "add stop condition" },
    confidence: "low",
    verifyWith: { suggestedEvalCase: { queryId: null, query: null, assertions: [] } },
    ...overrides,
  };
}

function buildPromptRegistry(): PromptTemplateRegistry {
  const r = new PromptTemplateRegistry();
  r.registerInline(
    "builtin:within-trace-synthesizer-v1",
    "trace={{trace_id}} agent={{agent_id}}\nFINDINGS:\n{{findings}}\nSCHEMA:\n{{output_schema}}",
  );
  return r;
}

test("agentSynthesize: empty findings → template mode, 'No findings' headline", async () => {
  const r = await agentSynthesize({
    findings: [],
    traceId: "tr_x",
    agentId: null,
    provider: new StubAgentProvider(),
    promptRegistry: buildPromptRegistry(),
  });
  assert.equal(r.mode, "template");
  assert.equal(r.summary.headline, "No findings");
});

test("agentSynthesize: no provider → template fallback with reason", async () => {
  const r = await agentSynthesize({
    findings: [makeFinding()],
    traceId: "tr_x",
    agentId: null,
    provider: null,
    promptRegistry: buildPromptRegistry(),
  });
  assert.equal(r.mode, "template");
  assert.equal(r.fallbackReason, "no-provider-registered");
  assert.match(r.summary.headline, /see findings\[0\]/);
});

test("agentSynthesize: missing prompt template → template fallback", async () => {
  const r = await agentSynthesize({
    findings: [makeFinding()],
    traceId: "tr_x",
    agentId: null,
    provider: new StubAgentProvider(),
    promptRegistry: new PromptTemplateRegistry(),  // empty
  });
  assert.equal(r.mode, "template");
  assert.equal(r.fallbackReason, "prompt-template-missing:builtin:within-trace-synthesizer-v1");
});

test("agentSynthesize: unavailable provider → template fallback", async () => {
  const r = await agentSynthesize({
    findings: [makeFinding()],
    traceId: "tr_x",
    agentId: null,
    provider: new StubAgentProvider({ unavailable: true }),
    promptRegistry: buildPromptRegistry(),
  });
  assert.equal(r.mode, "template");
  assert.equal(r.fallbackReason, "provider-not-available:stub");
});

test("agentSynthesize: agent returns valid Summary → mode=agent, headline echoed", async () => {
  const stub = new StubAgentProvider({
    responses: [{
      headline: "Agent retried retrieval 3× ignoring stale results",
      primary_root_cause: {
        finding_ids: [0],
        description: "stale_results handling failure caught by symbolic + rubric",
        target_for_fix: "decision_agent.prompt",
      },
      fix_priority: [{ finding_id: 0, reason: "high severity" }],
      cross_finding_links: [],
    }],
  });
  const r = await agentSynthesize({
    findings: [makeFinding()],
    traceId: "tr_x",
    agentId: "agent_123",
    provider: stub,
    promptRegistry: buildPromptRegistry(),
  });
  assert.equal(r.mode, "agent");
  assert.equal(r.summary.headline, "Agent retried retrieval 3× ignoring stale results");
  assert.equal(r.summary.primaryRootCause?.findingIds[0], 0);
  // Verify the prompt got the findings shape we promised
  assert.equal(stub.calls.length, 1);
  const prompt = stub.calls[0].prompt;
  assert.match(prompt, /tool_loop_no_state_change/);
  assert.match(prompt, /sp_a/);
  assert.match(prompt, /trace=tr_x/);
});

test("agentSynthesize: agent schema_violation → template fallback with reason='agent-error:schema_violation'", async () => {
  // Stub provider validates against caller's outputSchema. Send a value
  // that violates Summary (headline > 160 chars).
  const stub = new StubAgentProvider({
    responses: [{
      headline: "x".repeat(200),
      primary_root_cause: null,
      fix_priority: [],
      cross_finding_links: [],
    }],
  });
  const r = await agentSynthesize({
    findings: [makeFinding()],
    traceId: "tr_x",
    agentId: null,
    provider: stub,
    promptRegistry: buildPromptRegistry(),
  });
  assert.equal(r.mode, "template");
  assert.equal(r.fallbackReason, "agent-error:schema_violation");
  // template mode still produces a usable summary
  assert.match(r.summary.headline, /see findings\[0\]/);
});

test("agentSynthesize: prompt embeds output_schema description for the model", async () => {
  const stub = new StubAgentProvider({
    responses: [{
      headline: "ok",
      primary_root_cause: null,
      fix_priority: [],
      cross_finding_links: [],
    }],
  });
  await agentSynthesize({
    findings: [makeFinding()],
    traceId: "tr_x",
    agentId: null,
    provider: stub,
    promptRegistry: buildPromptRegistry(),
  });
  const prompt = stub.calls[0].prompt;
  assert.match(prompt, /SCHEMA:/);
  assert.match(prompt, /primary_root_cause/);
  assert.match(prompt, /cross_finding_links/);
});
