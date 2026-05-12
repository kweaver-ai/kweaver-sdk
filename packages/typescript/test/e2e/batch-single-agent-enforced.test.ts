import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";

import { runBatch } from "../../src/trace-ai/scan/index.js";
import { SingleAgentValidationError } from "../../src/trace-ai/scan/single-agent-validator.js";
import { tmpOutDir, mockTraceFetcher } from "./_scan-helpers.js";

test("e2e batch enforces single agent: conv_a→agent_A, conv_b→agent_B → throws SingleAgentValidationError", async () => {
  const fxA = {
    hits: {
      hits: [
        {
          _source: {
            spanId: "r",
            parentSpanId: null,
            attributes: { "gen_ai.agent.id": "agent_A" },
            status: { code: "OK" },
            name: "x",
            startTimeUnixNano: "0",
            endTimeUnixNano: "1",
          },
        },
      ],
    },
  };
  const fxB = {
    hits: {
      hits: [
        {
          _source: {
            spanId: "r",
            parentSpanId: null,
            attributes: { "gen_ai.agent.id": "agent_B" },
            status: { code: "OK" },
            name: "x",
            startTimeUnixNano: "0",
            endTimeUnixNano: "1",
          },
        },
      ],
    },
  };
  const fetcher = mockTraceFetcher(
    new Map([
      ["conv_a", fxA],
      ["conv_b", fxB],
    ]),
  );
  const out = await tmpOutDir("batch-mixed");

  try {
    await assert.rejects(
      () =>
        runBatch({
          traces: ["conv_a", "conv_b"],
          out,
          rulesDir: null,
          noBuiltin: false,
          noArtifacts: true,
          timeoutMs: 60000,
          maxParallel: 4,
          baseUrl: "http://mock.kweaver.test",
          token: "tk",
          businessDomain: "bd_public",
        }),
      (e: unknown) =>
        e instanceof SingleAgentValidationError &&
        (e as SingleAgentValidationError).code === "mixed",
    );
    const partialExists = await fs
      .stat(`${out}/conv_a.yaml`)
      .then(() => true)
      .catch(() => false);
    assert.equal(
      partialExists,
      false,
      "must not write any per-trace yaml when single-agent validation fails",
    );
  } finally {
    fetcher.restore();
    await fs.rm(out, { recursive: true, force: true });
  }
});
