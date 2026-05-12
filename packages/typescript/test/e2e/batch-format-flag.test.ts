import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";

import { runBatch } from "../../src/trace-ai/scan/index.js";
import { defaultRegistry } from "../../src/agent-providers/registry.js";
import { tmpOutDir, mockTraceFetcher, FIX, stubProviderForBatch } from "./_scan-helpers.js";

async function exists(p: string): Promise<boolean> {
  return await fs.stat(p).then(() => true).catch(() => false);
}

test("e2e batch --format=yaml: emits .yaml only, no .md", async () => {
  const fixture = JSON.parse(await fs.readFile(path.join(FIX, "synthetic/tool-loop-with-agent-id.json"), "utf8"));
  const fetcher = mockTraceFetcher(new Map([["conv_a", fixture]]));
  const stub = stubProviderForBatch();
  defaultRegistry.register(stub, { setAsDefault: true });
  const out = await tmpOutDir("batch-fmt-yaml");
  try {
    await runBatch({
      traces: ["conv_a"], out,
      rulesDir: null, noBuiltin: false, noArtifacts: true,
      format: "yaml",
      timeoutMs: 60000, maxParallel: 4,
      baseUrl: "http://x", token: "tk", businessDomain: "bd_public",
    });
    assert.ok(await exists(path.join(out, "conv_a.yaml")), "per-trace yaml must exist");
    assert.ok(!await exists(path.join(out, "conv_a.md")), "per-trace md must NOT exist under --format=yaml");
    assert.ok(await exists(path.join(out, "scan-summary.yaml")), "scan-summary.yaml must exist");
    assert.ok(!await exists(path.join(out, "scan-summary.md")), "scan-summary.md must NOT exist under --format=yaml");
  } finally {
    fetcher.restore();
    await fs.rm(out, { recursive: true, force: true });
  }
});

test("e2e batch --format=both (default): emits both .yaml and .md", async () => {
  const fixture = JSON.parse(await fs.readFile(path.join(FIX, "synthetic/tool-loop-with-agent-id.json"), "utf8"));
  const fetcher = mockTraceFetcher(new Map([["conv_a", fixture]]));
  const stub = stubProviderForBatch();
  defaultRegistry.register(stub, { setAsDefault: true });
  const out = await tmpOutDir("batch-fmt-both");
  try {
    await runBatch({
      traces: ["conv_a"], out,
      rulesDir: null, noBuiltin: false, noArtifacts: true,
      timeoutMs: 60000, maxParallel: 4,
      baseUrl: "http://x", token: "tk", businessDomain: "bd_public",
    });
    assert.ok(await exists(path.join(out, "conv_a.yaml")), "per-trace yaml");
    assert.ok(await exists(path.join(out, "conv_a.md")), "per-trace md (default both)");
    assert.ok(await exists(path.join(out, "scan-summary.yaml")), "scan-summary.yaml");
    assert.ok(await exists(path.join(out, "scan-summary.md")), "scan-summary.md (default both)");
  } finally {
    fetcher.restore();
    await fs.rm(out, { recursive: true, force: true });
  }
});
