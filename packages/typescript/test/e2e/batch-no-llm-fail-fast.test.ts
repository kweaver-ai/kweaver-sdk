/**
 * Batch mode with --no-llm should exit code 2 and emit a stderr message
 * indicating --no-llm is not supported in batch mode.
 */

import test from "node:test";
import assert from "node:assert/strict";

import { runTraceCommand } from "../../src/commands/trace.js";

test("e2e CLI: --traces with --no-llm → exit 2 + stderr message about no-llm not supported", async () => {
  const origWrite = process.stderr.write.bind(process.stderr);
  let captured = "";
  (process.stderr as unknown as { write: (s: string | Uint8Array) => boolean }).write = (s) => {
    captured += String(s);
    return true;
  };
  try {
    const code = await runTraceCommand([
      "diagnose",
      "--traces=conv_a",
      "--no-llm",
      "--out=/tmp/x_no_llm_test",
    ]);
    assert.equal(code, 2, `expected exit 2, got ${code}`);
    assert.match(captured, /does not support --no-llm/);
  } finally {
    (process.stderr as unknown as { write: typeof origWrite }).write = origWrite;
  }
});
