/**
 * Batch resume test: pre-write 2 valid per-trace yamls, scan over 5 conv_ids,
 * assert 2 reused + 3 fresh + scan.resumed_from_partial=true.
 */

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import yaml from "js-yaml";

import { runBatch } from "../../src/trace-ai/scan/index.js";
import { defaultRegistry } from "../../src/agent-providers/registry.js";
import { reportToYamlObject } from "../../src/trace-ai/diagnose/report-assembler.js";
import type { Report } from "../../src/trace-ai/diagnose/types.js";
import { tmpOutDir, mockTraceFetcher, FIX, stubProviderForBatch } from "./_scan-helpers.js";

/** Minimal valid Report for writing to disk. */
function makeMinimalReport(traceId: string, agentId: string): Report {
  return {
    schemaVersion: "trace-diagnose-report/v1",
    trace: { traceId, agentId, tenant: null },
    run: {
      diagnosedAt: new Date().toISOString(),
      cliVersion: "0.7.4",
      mode: "symbolic-only",
      rulesApplied: ["tool_loop_no_state_change"],
      rulesSkipped: [],
      synthesizerMode: "template",
    },
    summary: {
      headline: "pre-written report",
      primaryRootCause: null,
      fixPriority: [],
      crossFindingLinks: [],
    },
    findings: [],
  };
}

test("e2e batch resume: 2-of-5 pre-written → 2 reused, 3 fresh, resumed_from_partial=true", async () => {
  const fixture = JSON.parse(
    await fs.readFile(path.join(FIX, "synthetic/tool-loop-with-agent-id.json"), "utf8"),
  );

  const allConvIds = ["res_a", "res_b", "res_c", "res_d", "res_e"];
  const preWritten = ["res_a", "res_c"];

  const fetcher = mockTraceFetcher(
    new Map(allConvIds.map((id) => [id, fixture])),
  );
  const stub = stubProviderForBatch();
  defaultRegistry.register(stub, { setAsDefault: true });
  const out = await tmpOutDir("batch-resume");

  // Pre-write 2 valid per-trace yamls into the new traces/ subdir layout
  const tracesDir = path.join(out, "traces");
  await fs.mkdir(tracesDir, { recursive: true });
  for (const convId of preWritten) {
    const report = makeMinimalReport(`trace_${convId}`, "agent_loop_tester");
    await fs.writeFile(
      path.join(tracesDir, `${convId}.yaml`),
      yaml.dump(reportToYamlObject(report)),
      "utf8",
    );
  }

  try {
    const result = await runBatch({
      traces: allConvIds,
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

    assert.equal(result.tracesDiagnosed, 5, "must diagnose all 5 traces");
    assert.equal(result.tracesReused, 2, "must reuse the 2 pre-written reports");

    const summaryRaw = yaml.load(
      await fs.readFile(path.join(out, "scan-summary.yaml"), "utf8"),
    ) as Record<string, unknown>;
    const scan = summaryRaw.scan as Record<string, unknown>;
    assert.equal(scan.traces_reused, 2);
    assert.equal(scan.traces_freshly_diagnosed, 3);
    assert.equal(scan.resumed_from_partial, true);
  } finally {
    fetcher.restore();
    await fs.rm(out, { recursive: true, force: true });
  }
});
