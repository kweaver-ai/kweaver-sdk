import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import yaml from "js-yaml";

import { runBatch } from "../../src/trace-ai/scan/index.js";
import { defaultRegistry } from "../../src/agent-providers/registry.js";
import { tmpOutDir, mockTraceFetcher, FIX, stubProviderForBatch } from "./_scan-helpers.js";

test("e2e batch happy-path: 3 conv_ids, single agent, full pipeline produces all outputs", async () => {
  const fixture = JSON.parse(
    await fs.readFile(path.join(FIX, "synthetic/tool-loop-with-agent-id.json"), "utf8"),
  );
  const fetcher = mockTraceFetcher(
    new Map([
      ["conv_a", fixture],
      ["conv_b", fixture],
      ["conv_c", fixture],
    ]),
  );
  const stub = stubProviderForBatch();
  defaultRegistry.register(stub, { setAsDefault: true });
  const out = await tmpOutDir("batch-happy");

  try {
    const result = await runBatch({
      traces: ["conv_a", "conv_b", "conv_c"],
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

    assert.equal(result.tracesDiagnosed, 3);
    assert.equal(result.tracesReused, 0);

    for (const conv of ["conv_a", "conv_b", "conv_c"]) {
      const yamlPath = path.join(out, `${conv}.yaml`);
      const exists = await fs
        .stat(yamlPath)
        .then(() => true)
        .catch(() => false);
      assert.ok(exists, `expected ${conv}.yaml`);

      const mdPath = path.join(out, `${conv}.md`);
      const mdExists = await fs
        .stat(mdPath)
        .then(() => true)
        .catch(() => false);
      assert.ok(mdExists, `expected ${conv}.md`);
    }

    const summaryPath = path.join(out, "scan-summary.yaml");
    const summaryExists = await fs
      .stat(summaryPath)
      .then(() => true)
      .catch(() => false);
    assert.ok(summaryExists, "expected scan-summary.yaml");

    const summary = yaml.load(
      await fs.readFile(summaryPath, "utf8"),
    ) as Record<string, unknown>;
    assert.equal(
      (summary as { schema_version: string }).schema_version,
      "scan-summary/v1",
    );

    const summaryMdPath = path.join(out, "scan-summary.md");
    const summaryMdExists = await fs
      .stat(summaryMdPath)
      .then(() => true)
      .catch(() => false);
    assert.ok(summaryMdExists, "expected scan-summary.md");

    // Verify that {{category}} placeholder was rendered with the verdict's category.
    // The stub provider returns category="stale_results"; the rule's change_template is
    // "agent retried because of '{{category}}'; address that intent..."
    const sampleYamlPath = path.join(out, "conv_a.yaml");
    const sampleYaml = await fs.readFile(sampleYamlPath, "utf8");
    assert.ok(!/\{\{category\}\}/.test(sampleYaml), "change_template's {{category}} placeholder must be rendered, not left literal");
    assert.match(sampleYaml, /'stale_results'/, "rendered change should mention the verdict's category 'stale_results'");
  } finally {
    fetcher.restore();
    await fs.rm(out, { recursive: true, force: true });
  }
});
