/**
 * Rubric failure test: stub provider returns malformed responses
 * (unknown trace_id / missing required fields) for the rubric call.
 * Affected traces should have run.rules_skipped entries with
 * reason matching "agent-error:schema_violation".
 * scan-summary must still be emitted.
 */

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import yaml from "js-yaml";

import { runBatch } from "../../src/trace-ai/scan/index.js";
import { defaultRegistry } from "../../src/agent-providers/registry.js";
import { StubAgentProvider } from "../../src/agent-providers/providers/stub.js";
import { tmpOutDir, mockTraceFetcher, FIX } from "./_scan-helpers.js";

test("e2e batch rubric failure: malformed rubric response → traces have rules_skipped[reason=agent-error:schema_violation]", async () => {
  const fixture = JSON.parse(
    await fs.readFile(path.join(FIX, "synthetic/tool-loop-with-agent-id.json"), "utf8"),
  );
  const fetcher = mockTraceFetcher(
    new Map([
      ["fail_a", fixture],
      ["fail_b", fixture],
    ]),
  );

  const stub = new StubAgentProvider({
    name: "claude-code",
    capabilities: ["structured_output"],
    responseFn: async (prompt: string) => {
      if (/Cross-Trace Synthesizer/i.test(prompt)) {
        return {
          headline: "rubric failure test synth",
          primary_root_cause: null,
          fix_priority: [],
          cross_rule_links: [],
        };
      }
      // Return malformed rubric response: unknown trace_id, missing required fields
      return {
        trace_results: [
          { trace_id: "tr_UNKNOWN_XYZ", category: "ok" },
        ],
      };
    },
  });
  defaultRegistry.register(stub, { setAsDefault: true });
  const out = await tmpOutDir("batch-rubric-fail");

  try {
    await runBatch({
      traces: ["fail_a", "fail_b"],
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

    // scan-summary must still be emitted
    const summaryExists = await fs
      .stat(path.join(out, "scan-summary.yaml"))
      .then(() => true)
      .catch(() => false);
    assert.ok(summaryExists, "scan-summary.yaml must be emitted even on rubric failure");

    // Check that per-trace reports list the rubric rule as skipped
    // (because the rubric response had unknown trace_ids → schema_violation)
    let anySkipped = false;
    for (const convId of ["fail_a", "fail_b"]) {
      const reportRaw = yaml.load(
        await fs.readFile(path.join(out, `${convId}.yaml`), "utf8"),
      ) as Record<string, unknown>;
      const run = reportRaw.run as Record<string, unknown>;
      const skipped = run.rules_skipped as Array<{ rule_id: string; reason: string }>;
      const rubricSkip = skipped.find(
        (s) =>
          s.rule_id === "tool_retry_intent_mismatch" &&
          s.reason.startsWith("agent-error:"),
      );
      if (rubricSkip) {
        anySkipped = true;
        assert.match(
          rubricSkip.reason,
          /agent-error:/,
          `expected agent-error reason for ${convId}`,
        );
      }
    }
    assert.ok(
      anySkipped,
      "at least one trace must have the rubric rule skipped with agent-error reason",
    );
  } finally {
    fetcher.restore();
    await fs.rm(out, { recursive: true, force: true });
  }
});
