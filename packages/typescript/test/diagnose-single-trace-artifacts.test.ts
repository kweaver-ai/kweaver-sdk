import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { diagnose } from "../src/trace-ai/diagnose/index.js";
import { AgentRegistry } from "../src/agent-providers/registry.js";
import { StubAgentProvider } from "../src/agent-providers/providers/stub.js";
import { PromptTemplateRegistry } from "../src/agent-providers/prompt-template.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIX = path.join(__dirname, "fixtures/trace-diagnose");

function mockFetch(data: unknown) {
  const orig = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify(data), { status: 200 });
  return { restore: () => { globalThis.fetch = orig; } };
}

test("single-trace diagnose: artifacts dir created next to --out, stage-2/stage-3 written", async () => {
  const fixture = JSON.parse(await fs.readFile(path.join(FIX, "synthetic/tool-loop-no-state-change.json"), "utf8"));
  const m = mockFetch(fixture);
  const outDir = await fs.mkdtemp(path.join(os.tmpdir(), "single-art-"));
  const outFile = path.join(outDir, "refund.yaml");

  const stub = new StubAgentProvider({
    name: "claude-code",
    capabilities: ["structured_output"],
    responseFn: async (prompt) => {
      if (/FINDINGS:|Within-Trace Synthesizer/i.test(prompt)) {
        return {
          headline: "h",
          primary_root_cause: { finding_ids: [0], description: "d", target_for_fix: "t" },
          fix_priority: [{ finding_id: 0, reason: "r" }],
          cross_finding_links: [],
        };
      }
      return {
        category: "stale_results",
        reasoning: "rr",
        severity: "high",
        confidence: "high",
        first_violating_step_id: "t3",
        evidence_span_ids: ["t1", "t2", "t3"],
      };
    },
  });
  const registry = new AgentRegistry();
  registry.register(stub, { setAsDefault: true });

  try {
    await diagnose("tr_x", {
      out: outFile,
      rulesDir: null,
      noBuiltin: false,
      noLlm: false,
      noArtifacts: false,
      agentProvider: null,
      timeoutMs: 60000,
      baseUrl: "https://mock.kweaver.test",
      token: "tk",
      businessDomain: "bd_public",
      format: "yaml",
    }, { registry, promptRegistry: new PromptTemplateRegistry() });

    const artifactsBase = path.join(outDir, "refund.artifacts");
    const stage2 = path.join(artifactsBase, "stage-2-rubric", "tool_retry_intent_mismatch");
    const stage3 = path.join(artifactsBase, "stage-3-synth");
    assert.ok(await fs.stat(path.join(stage2, "chunk-000.prompt.md")).then(() => true).catch(() => false), "stage-2 chunk-000 prompt missing");
    assert.ok(await fs.stat(path.join(stage2, "chunk-000.response.json")).then(() => true).catch(() => false), "stage-2 chunk-000 response missing");
    assert.ok(await fs.stat(path.join(stage3, "prompt.md")).then(() => true).catch(() => false), "stage-3-synth prompt missing");
    assert.ok(await fs.stat(path.join(stage3, "response.json")).then(() => true).catch(() => false), "stage-3-synth response missing");
    assert.ok(await fs.stat(path.join(artifactsBase, "run-metadata.json")).then(() => true).catch(() => false), "run-metadata missing");
  } finally {
    m.restore();
    await fs.rm(outDir, { recursive: true, force: true });
  }
});

test("single-trace diagnose: --no-artifacts (noArtifacts=true) → no artifacts dir created", async () => {
  const fixture = JSON.parse(await fs.readFile(path.join(FIX, "synthetic/tool-loop-no-state-change.json"), "utf8"));
  const m = mockFetch(fixture);
  const outDir = await fs.mkdtemp(path.join(os.tmpdir(), "single-noart-"));
  const outFile = path.join(outDir, "refund.yaml");

  try {
    await diagnose("tr_x", {
      out: outFile,
      rulesDir: null,
      noBuiltin: false,
      noLlm: true,
      noArtifacts: true,
      agentProvider: null,
      timeoutMs: 60000,
      baseUrl: "https://mock.kweaver.test",
      token: "tk",
      businessDomain: "bd_public",
      format: "yaml",
    });
    const exists = await fs.stat(path.join(outDir, "refund.artifacts")).then(() => true).catch(() => false);
    assert.equal(exists, false, "artifacts dir must not exist under --no-artifacts");
  } finally {
    m.restore();
    await fs.rm(outDir, { recursive: true, force: true });
  }
});
