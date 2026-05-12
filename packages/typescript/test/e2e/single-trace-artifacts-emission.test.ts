/**
 * Single-trace artifacts emission test.
 * Verifies that single-trace diagnose() emits stage-2 (rubric) + stage-3-synth
 * artifacts, but NOT stage-4-cross-trace-synth (batch-only).
 *
 * Adapted from test/diagnose-single-trace-artifacts.test.ts (Task 5) to live
 * in the e2e suite. That test file remains intact for the Task 5 suite.
 */

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { diagnose } from "../../src/trace-ai/diagnose/index.js";
import { AgentRegistry } from "../../src/agent-providers/registry.js";
import { StubAgentProvider } from "../../src/agent-providers/providers/stub.js";
import { PromptTemplateRegistry } from "../../src/agent-providers/prompt-template.js";
import { FIX } from "./_scan-helpers.js";

function mockFetch(data: unknown) {
  const orig = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify(data), { status: 200 });
  return {
    restore: () => {
      globalThis.fetch = orig;
    },
  };
}

test("e2e single-trace: artifacts dir contains stage-2 + stage-3 but NOT stage-4", async () => {
  const fixture = JSON.parse(
    await fs.readFile(
      path.join(FIX, "synthetic/tool-loop-no-state-change.json"),
      "utf8",
    ),
  );
  const m = mockFetch(fixture);
  const outDir = await fs.mkdtemp(path.join(os.tmpdir(), "e2e-single-art-"));
  const outFile = path.join(outDir, "refund.yaml");

  const stub = new StubAgentProvider({
    name: "claude-code",
    capabilities: ["structured_output"],
    responseFn: async (prompt) => {
      if (/FINDINGS:|Within-Trace Synthesizer/i.test(prompt)) {
        return {
          headline: "h",
          primary_root_cause: {
            finding_ids: [0],
            description: "d",
            target_for_fix: "t",
          },
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
    await diagnose(
      "tr_x",
      {
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
      },
      { registry, promptRegistry: new PromptTemplateRegistry() },
    );

    const artifactsBase = path.join(outDir, "refund.artifacts");

    // stage-2 rubric artifacts must exist
    const stage2 = path.join(
      artifactsBase,
      "stage-2-rubric",
      "tool_retry_intent_mismatch",
    );
    assert.ok(
      await fs
        .stat(path.join(stage2, "chunk-000.prompt.md"))
        .then(() => true)
        .catch(() => false),
      "stage-2 chunk-000.prompt.md must exist",
    );
    assert.ok(
      await fs
        .stat(path.join(stage2, "chunk-000.response.json"))
        .then(() => true)
        .catch(() => false),
      "stage-2 chunk-000.response.json must exist",
    );

    // stage-3-synth artifacts must exist
    const stage3 = path.join(artifactsBase, "stage-3-synth");
    assert.ok(
      await fs
        .stat(path.join(stage3, "prompt.md"))
        .then(() => true)
        .catch(() => false),
      "stage-3-synth prompt.md must exist",
    );
    assert.ok(
      await fs
        .stat(path.join(stage3, "response.json"))
        .then(() => true)
        .catch(() => false),
      "stage-3-synth response.json must exist",
    );

    // run-metadata must exist
    assert.ok(
      await fs
        .stat(path.join(artifactsBase, "run-metadata.json"))
        .then(() => true)
        .catch(() => false),
      "run-metadata.json must exist",
    );

    // stage-4-cross-trace-synth must NOT exist in single-trace mode
    const stage4Exists = await fs
      .stat(path.join(artifactsBase, "stage-4-cross-trace-synth"))
      .then(() => true)
      .catch(() => false);
    assert.equal(
      stage4Exists,
      false,
      "stage-4-cross-trace-synth must NOT exist in single-trace mode",
    );
  } finally {
    m.restore();
    await fs.rm(outDir, { recursive: true, force: true });
  }
});
