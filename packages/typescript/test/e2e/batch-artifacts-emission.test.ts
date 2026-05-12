/**
 * Batch artifacts emission test: verifies that the full artifacts directory
 * structure is written under <out>/artifacts/ including:
 *   - run-metadata.json (always)
 *   - stage-2-rubric/<rule_id>/chunk-000.{prompt.md, response.json}
 *   - stage-4-cross-trace-synth/{aggregates.json, samples.json, prompt.md, response.json}
 */

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";

import { runBatch } from "../../src/trace-ai/scan/index.js";
import { defaultRegistry } from "../../src/agent-providers/registry.js";
import { tmpOutDir, mockTraceFetcher, FIX, stubProviderForBatch } from "./_scan-helpers.js";

test("e2e batch artifacts emission: run-metadata + stage-2 + stage-4 artifacts written", async () => {
  const fixture = JSON.parse(
    await fs.readFile(path.join(FIX, "synthetic/tool-loop-with-agent-id.json"), "utf8"),
  );
  const fetcher = mockTraceFetcher(
    new Map([
      ["art_a", fixture],
      ["art_b", fixture],
    ]),
  );
  const stub = stubProviderForBatch();
  defaultRegistry.register(stub, { setAsDefault: true });
  const out = await tmpOutDir("batch-artifacts");

  try {
    await runBatch({
      traces: ["art_a", "art_b"],
      out,
      rulesDir: null,
      noBuiltin: false,
      noArtifacts: false,
      timeoutMs: 60000,
      maxParallel: 4,
      baseUrl: "http://mock.kweaver.test",
      token: "tk",
      businessDomain: "bd_public",
    });

    const artifactsBase = path.join(out, "artifacts");

    // run-metadata.json must always exist
    const runMeta = path.join(artifactsBase, "run-metadata.json");
    assert.ok(
      await fs.stat(runMeta).then(() => true).catch(() => false),
      "run-metadata.json must exist",
    );

    // stage-2 rubric artifacts: tool_retry_intent_mismatch rule runs because
    // tool_loop fires on both fixtures → chunk-000.prompt.md + .response.json
    const stage2Dir = path.join(artifactsBase, "stage-2-rubric", "tool_retry_intent_mismatch");
    assert.ok(
      await fs.stat(path.join(stage2Dir, "chunk-000.prompt.md")).then(() => true).catch(() => false),
      "stage-2 chunk-000.prompt.md must exist",
    );
    assert.ok(
      await fs.stat(path.join(stage2Dir, "chunk-000.response.json")).then(() => true).catch(() => false),
      "stage-2 chunk-000.response.json must exist",
    );

    // stage-4 cross-trace synth artifacts
    const stage4Dir = path.join(artifactsBase, "stage-4-cross-trace-synth");
    assert.ok(
      await fs.stat(path.join(stage4Dir, "aggregates.json")).then(() => true).catch(() => false),
      "stage-4 aggregates.json must exist",
    );
    assert.ok(
      await fs.stat(path.join(stage4Dir, "samples.json")).then(() => true).catch(() => false),
      "stage-4 samples.json must exist",
    );
    assert.ok(
      await fs.stat(path.join(stage4Dir, "prompt.md")).then(() => true).catch(() => false),
      "stage-4 prompt.md must exist",
    );
    assert.ok(
      await fs.stat(path.join(stage4Dir, "response.json")).then(() => true).catch(() => false),
      "stage-4 response.json must exist",
    );
  } finally {
    fetcher.restore();
    await fs.rm(out, { recursive: true, force: true });
  }
});
