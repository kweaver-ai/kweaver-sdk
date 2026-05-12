/**
 * --no-artifacts flag test for both batch and single-trace modes.
 *
 * 1. runBatch with noArtifacts=true → no <out>/artifacts/ dir created; per-trace
 *    reports and scan-summary ARE still written.
 * 2. diagnose() with noArtifacts=true → no <stem>.artifacts/ dir created; report
 *    IS still written.
 */

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { runBatch } from "../../src/trace-ai/scan/index.js";
import { diagnose } from "../../src/trace-ai/diagnose/index.js";
import { defaultRegistry } from "../../src/agent-providers/registry.js";
import { AgentRegistry } from "../../src/agent-providers/registry.js";
import { StubAgentProvider } from "../../src/agent-providers/providers/stub.js";
import { PromptTemplateRegistry } from "../../src/agent-providers/prompt-template.js";
import { tmpOutDir, mockTraceFetcher, FIX, stubProviderForBatch } from "./_scan-helpers.js";

function mockFetch(data: unknown) {
  const orig = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify(data), { status: 200 });
  return {
    restore: () => {
      globalThis.fetch = orig;
    },
  };
}

// ── Test 1: batch mode with noArtifacts=true ─────────────────────────────────

test("e2e --no-artifacts batch: no artifacts dir, but per-trace reports + scan-summary still written", async () => {
  const fixture = JSON.parse(
    await fs.readFile(path.join(FIX, "synthetic/tool-loop-with-agent-id.json"), "utf8"),
  );
  const fetcher = mockTraceFetcher(
    new Map([
      ["noart_a", fixture],
      ["noart_b", fixture],
    ]),
  );
  const stub = stubProviderForBatch();
  defaultRegistry.register(stub, { setAsDefault: true });
  const out = await tmpOutDir("batch-noart");

  try {
    const result = await runBatch({
      traces: ["noart_a", "noart_b"],
      out,
      rulesDir: null,
      noBuiltin: false,
      noArtifacts: true,
      timeoutMs: 60000,
      maxParallel: 4,
      baseUrl: "http://mock.kweaver.test",
      token: "tk",
      businessDomain: "bd_public",
    });

    // Artifacts dir must NOT exist
    const artifactsDirExists = await fs
      .stat(path.join(out, "artifacts"))
      .then(() => true)
      .catch(() => false);
    assert.equal(
      artifactsDirExists,
      false,
      "artifacts/ dir must not exist under --no-artifacts",
    );

    // But per-trace reports and scan-summary must still be written
    assert.equal(result.tracesDiagnosed, 2);
    for (const conv of ["noart_a", "noart_b"]) {
      const yamlExists = await fs
        .stat(path.join(out, `${conv}.yaml`))
        .then(() => true)
        .catch(() => false);
      assert.ok(yamlExists, `${conv}.yaml must still be written`);
    }
    const summaryExists = await fs
      .stat(path.join(out, "scan-summary.yaml"))
      .then(() => true)
      .catch(() => false);
    assert.ok(summaryExists, "scan-summary.yaml must still be written");
  } finally {
    fetcher.restore();
    await fs.rm(out, { recursive: true, force: true });
  }
});

// ── Test 2: single-trace mode with noArtifacts=true ──────────────────────────

test("e2e --no-artifacts single-trace: no <stem>.artifacts/ dir, but report IS written", async () => {
  const fixture = JSON.parse(
    await fs.readFile(
      path.join(FIX, "synthetic/tool-loop-no-state-change.json"),
      "utf8",
    ),
  );
  const m = mockFetch(fixture);
  const outDir = await fs.mkdtemp(path.join(os.tmpdir(), "e2e-noart-single-"));
  const outFile = path.join(outDir, "refund.yaml");

  try {
    await diagnose(
      "tr_x",
      {
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
      },
    );

    // Artifacts dir must NOT exist
    const artifactsDirExists = await fs
      .stat(path.join(outDir, "refund.artifacts"))
      .then(() => true)
      .catch(() => false);
    assert.equal(
      artifactsDirExists,
      false,
      "refund.artifacts/ dir must not exist under --no-artifacts",
    );

    // Report file must still exist
    const reportExists = await fs
      .stat(outFile)
      .then(() => true)
      .catch(() => false);
    assert.ok(reportExists, "report yaml must still be written");
  } finally {
    m.restore();
    await fs.rm(outDir, { recursive: true, force: true });
  }
});
