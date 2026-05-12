/**
 * Hybrid-pillar e2e: feed the same synthetic tool-loop fixture through the
 * full diagnose pipeline with both symbolic AND a StubAgentProvider-backed
 * rubric path enabled. Asserts:
 *  - both findings appear (judgment_kind = 'symbolic' and 'rubric')
 *  - first_violating_step_id from the rubric output lands in evidence.spans
 *  - run.mode = 'hybrid'
 *  - run.synthesizer_mode = 'agent' when a provider is registered
 *  - --no-llm reverts: rubric skipped (reason='no-llm-flag-set'),
 *    synthesizer_mode = 'template', report still valid
 */

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { diagnose } from "../../src/trace-ai/diagnose/index.js";
import { AgentRegistry } from "../../src/agent-providers/registry.js";
import { PromptTemplateRegistry } from "../../src/agent-providers/prompt-template.js";
import { StubAgentProvider } from "../../src/agent-providers/providers/stub.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIX = path.join(__dirname, "..", "fixtures/trace-diagnose");

function mockFetchSequence(responses: unknown[]) {
  const orig = globalThis.fetch;
  let i = 0;
  globalThis.fetch = async () => {
    const r = responses[i++] ?? {};
    return new Response(typeof r === "string" ? r : JSON.stringify(r), { status: 200 });
  };
  return { restore: () => { globalThis.fetch = orig; } };
}

async function loadFixture(p: string) {
  return JSON.parse(await fs.readFile(p, "utf8"));
}

/**
 * Spans in the tool-loop fixture all share parentSpanId="parent_x" / use
 * synthetic IDs sp_t1 / sp_t2 / sp_t3. The rubric stub needs to return a
 * valid `first_violating_step_id` that the binding can carry into
 * evidence.spans. Pick `sp_t3`.
 */
async function rubricResponseForToolLoopFixture() {
  return {
    category: "stale_results",
    reasoning: "the agent called the same tool with identical args and got identical empty results; it didn't detect staleness",
    severity: "high",
    confidence: "high",
    first_violating_step_id: "sp_t3",
    evidence_span_ids: ["sp_t1", "sp_t2", "sp_t3"],
  };
}

async function synthesizerResponseFor() {
  return {
    headline: "Agent retried retrieval 3× and didn't recognize stale results",
    primary_root_cause: {
      finding_ids: [0, 1],
      description: "Mechanical loop (symbolic) + stale_results handling failure (rubric) on the same span sequence",
      target_for_fix: "decision_agent.prompt",
    },
    fix_priority: [
      { finding_id: 0, reason: "highest severity; root of the cascading retry" },
      { finding_id: 1, reason: "same incident as f0 from the semantic angle" },
    ],
    cross_finding_links: [
      { finding_ids: [0, 1], relation: "same_incident" },
    ],
  };
}

test("e2e hybrid: rubric + symbolic on tool-loop fixture → 2 findings, mode=hybrid, synthesizer=agent", async () => {
  const data = await loadFixture(path.join(FIX, "synthetic/tool-loop-no-state-change.json"));
  const m = mockFetchSequence([data]);
  const tmpOut = path.join(os.tmpdir(), `diag-hybrid-${Date.now()}.yaml`);

  // Build a stub provider that fields BOTH the rubric judge call AND the
  // synthesizer call. The synthesizer prompt always contains 'FINDINGS:'
  // (per builtin:within-trace-synthesizer-v1) — use that to route.
  const stub = new StubAgentProvider({
    name: "claude-code",            // register under canonical name so rubric YAML's
                                    // agent_binding.provider='claude-code' resolves
    capabilities: ["structured_output"],
    responseFn: async (prompt) => {
      if (/FINDINGS:|Within-Trace Synthesizer/i.test(prompt)) {
        return synthesizerResponseFor();
      }
      return rubricResponseForToolLoopFixture();
    },
  });
  const registry = new AgentRegistry();
  registry.register(stub, { setAsDefault: true });

  try {
    const r = await diagnose("tr_synth", {
      out: tmpOut,
      rulesDir: null,
      noBuiltin: false,
      noLlm: false,
      agentProvider: null,
      timeoutMs: 60000,
      baseUrl: "https://mock.kweaver.test",
      token: "tk",
      businessDomain: "bd_public",
    }, {
      registry,
      promptRegistry: new PromptTemplateRegistry(),  // loads built-in dir at call time
    });

    // 1 symbolic + 1 rubric
    assert.equal(r.findings.length, 2, `expected 2 findings, got ${r.findings.map((f) => f.ruleId).join(", ")}`);
    const kinds = r.findings.map((f) => f.judgmentKind).sort();
    assert.deepEqual(kinds, ["rubric", "symbolic"]);

    const rubricF = r.findings.find((f) => f.judgmentKind === "rubric")!;
    assert.equal(rubricF.severity, "high");
    assert.equal(rubricF.confidence, "high");
    assert.equal(rubricF.likelyCause, "stale_results");
    assert.ok(rubricF.evidence.spans.includes("sp_t3"), "first_violating_step_id must be in evidence.spans");

    // Run metadata
    assert.equal(r.run.mode, "hybrid");
    assert.equal(r.run.synthesizerMode, "agent");
    assert.deepEqual(r.run.rulesSkipped, []);
    assert.ok(r.run.rulesApplied.includes("tool_loop_no_state_change"));
    assert.ok(r.run.rulesApplied.includes("tool_retry_intent_mismatch"));

    // Summary echoed from synthesizer
    assert.equal(r.summary.headline, "Agent retried retrieval 3× and didn't recognize stale results");
    assert.equal(r.summary.crossFindingLinks[0]?.relation, "same_incident");

    // Stub got 2 calls: one rubric, one synthesizer
    assert.equal(stub.calls.length, 2);
  } finally {
    m.restore();
    await fs.rm(tmpOut, { force: true });
  }
});

test("e2e --no-llm: rubric skipped, synthesizer falls back to template", async () => {
  const data = await loadFixture(path.join(FIX, "synthetic/tool-loop-no-state-change.json"));
  const m = mockFetchSequence([data]);
  const tmpOut = path.join(os.tmpdir(), `diag-nollm-${Date.now()}.yaml`);

  // Even with a perfectly working provider registered, --no-llm must skip rubric.
  const stub = new StubAgentProvider({ name: "claude-code", responses: [] });
  const registry = new AgentRegistry();
  registry.register(stub, { setAsDefault: true });

  try {
    const r = await diagnose("tr_synth", {
      out: tmpOut,
      rulesDir: null,
      noBuiltin: false,
      noLlm: true,
      agentProvider: null,
      timeoutMs: 60000,
      baseUrl: "https://mock.kweaver.test",
      token: "tk",
      businessDomain: "bd_public",
    }, {
      registry,
      promptRegistry: new PromptTemplateRegistry(),
    });

    // Only symbolic finding remains; rubric rule recorded as skipped
    assert.equal(r.findings.length, 1);
    assert.equal(r.findings[0].judgmentKind, "symbolic");
    assert.equal(r.run.synthesizerMode, "template");
    const skip = r.run.rulesSkipped.find((s) => s.ruleId === "tool_retry_intent_mismatch");
    assert.ok(skip, "rubric rule must be in rulesSkipped");
    assert.equal(skip?.reason, "no-llm-flag-set");
    // Provider was never invoked
    assert.equal(stub.calls.length, 0);
  } finally {
    m.restore();
    await fs.rm(tmpOut, { force: true });
  }
});

test("e2e: rubric provider missing → rule skipped with provider-not-available, symbolic + template still ship", async () => {
  const data = await loadFixture(path.join(FIX, "synthetic/tool-loop-no-state-change.json"));
  const m = mockFetchSequence([data]);
  const tmpOut = path.join(os.tmpdir(), `diag-noprovider-${Date.now()}.yaml`);

  const registry = new AgentRegistry();   // empty — no claude-code registered

  try {
    const r = await diagnose("tr_synth", {
      out: tmpOut,
      rulesDir: null,
      noBuiltin: false,
      noLlm: false,
      agentProvider: null,
      timeoutMs: 60000,
      baseUrl: "https://mock.kweaver.test",
      token: "tk",
      businessDomain: "bd_public",
    }, {
      registry,
      promptRegistry: new PromptTemplateRegistry(),
    });

    assert.equal(r.findings.length, 1);
    assert.equal(r.findings[0].judgmentKind, "symbolic");
    const skip = r.run.rulesSkipped.find((s) => s.ruleId === "tool_retry_intent_mismatch");
    assert.equal(skip?.reason, "provider-not-available:claude-code");
    assert.equal(r.run.synthesizerMode, "template");
  } finally {
    m.restore();
    await fs.rm(tmpOut, { force: true });
  }
});
