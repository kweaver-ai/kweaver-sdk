import test from "node:test";
import assert from "node:assert/strict";

import { runCrossTraceSynthesizer } from "../src/trace-ai/scan/cross-trace-synthesizer.js";
import { StubAgentProvider } from "../src/agent-providers/providers/stub.js";
import { PromptTemplateRegistry } from "../src/agent-providers/prompt-template.js";
import { ArtifactWriter } from "../src/trace-ai/scan/artifacts/writer.js";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

function buildPromptRegistry(): PromptTemplateRegistry {
  const r = new PromptTemplateRegistry();
  r.registerInline(
    "builtin:cross-trace-synthesizer-v1",
    "n={{n_total}} k={{sample_count}} ratio={{sample_ratio}} agent={{agent_id}} agg={{aggregates}} samples={{samples_yaml}} schema={{output_schema}} {{language_instruction}}",
  );
  return r;
}

const okResponse = {
  headline: "agent X mostly fails with tool_loop",
  primary_root_cause: { rule_ids: ["tool_loop_no_state_change"], description: "d", target_for_fix: "agent.prompt" },
  fix_priority: [{ rule_id: "tool_loop_no_state_change", affected_trace_count: 5, reason: "dominant" }],
  cross_rule_links: [],
};

test("runCrossTraceSynthesizer: tier=std, prompt contains agent_id", async () => {
  const stub = new StubAgentProvider({ name: "stub", responses: [okResponse] });
  const out = await runCrossTraceSynthesizer({
    agentId: "01KR_test",
    aggregates: { rule_frequency: [{ rule_id: "tool_loop_no_state_change", count: 5, severity_breakdown: { high: 5, medium: 0, low: 0 } }] },
    samples: { samples: [] },
    nTotal: 10,
    provider: stub,
    promptRegistry: buildPromptRegistry(),
  });
  assert.equal(out.summary?.headline, "agent X mostly fails with tool_loop");
  assert.equal(stub.calls.length, 1);
  assert.equal(stub.calls[0].tier, "std");
  assert.match(stub.calls[0].prompt, /agent=01KR_test/);
});

test("runCrossTraceSynthesizer: schema_violation → summary=null + error recorded", async () => {
  const stub = new StubAgentProvider({
    name: "stub",
    responses: [{ headline: "h" }],   // missing required fields
  });
  const out = await runCrossTraceSynthesizer({
    agentId: "01KR_test",
    aggregates: { rule_frequency: [] },
    samples: { samples: [] },
    nTotal: 0,
    provider: stub,
    promptRegistry: buildPromptRegistry(),
  });
  assert.equal(out.summary, null);
  assert.ok(out.fallbackReason);
  assert.match(out.fallbackReason!, /schema_violation|agent-error/);
});

test("runCrossTraceSynthesizer: artifacts written when ArtifactWriter passed", async () => {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), "cts-"));
  const artifacts = new ArtifactWriter({ base, enabled: true });
  const stub = new StubAgentProvider({ name: "stub", responses: [okResponse] });
  await runCrossTraceSynthesizer({
    agentId: "01KR_test",
    aggregates: { rule_frequency: [] },
    samples: { samples: [] },
    nTotal: 1,
    provider: stub,
    promptRegistry: buildPromptRegistry(),
    artifacts,
  });
  const dir = path.join(base, "stage-4-cross-trace-synth");
  for (const f of ["aggregates.json", "samples.json", "prompt.md", "response.json"]) {
    assert.ok(await fs.stat(path.join(dir, f)).then(() => true).catch(() => false), `${f} missing`);
  }
  await fs.rm(base, { recursive: true, force: true });
});

test("runCrossTraceSynthesizer: sample_ratio computed correctly (K/N as percent)", async () => {
  const stub = new StubAgentProvider({ name: "stub", responses: [okResponse] });
  await runCrossTraceSynthesizer({
    agentId: "a",
    aggregates: { rule_frequency: [] },
    samples: { samples: [{ trace_id: "x", conversation_id: null, headline: "h", rule_ids: [], selected_as: "outlier" }] },
    nTotal: 100,
    provider: stub,
    promptRegistry: buildPromptRegistry(),
  });
  assert.match(stub.calls[0].prompt, /ratio=1%|ratio=0.01/);
});

test("runCrossTraceSynthesizer: nTotal=0 → still runs, prompt reflects k=0/n=0/ratio=0%", async () => {
  const stub = new StubAgentProvider({ name: "stub", responses: [okResponse] });
  await runCrossTraceSynthesizer({
    agentId: "a",
    aggregates: { rule_frequency: [] },
    samples: { samples: [] },
    nTotal: 0,
    provider: stub,
    promptRegistry: buildPromptRegistry(),
  });
  assert.match(stub.calls[0].prompt, /n=0/);
  assert.match(stub.calls[0].prompt, /k=0/);
  assert.match(stub.calls[0].prompt, /ratio=0%/);
});
