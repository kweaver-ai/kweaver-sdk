/**
 * Batch mode without --out should exit code 2 and emit a stderr message
 * indicating --traces requires --out.
 */

import test from "node:test";
import assert from "node:assert/strict";

import { runTraceCommand } from "../../src/commands/trace.js";

test("e2e CLI: --traces without --out → exit 2 + stderr message about requires --out", async () => {
  const origWrite = process.stderr.write.bind(process.stderr);
  let captured = "";
  (process.stderr as unknown as { write: (s: string | Uint8Array) => boolean }).write = (s) => {
    captured += String(s);
    return true;
  };
  try {
    const code = await runTraceCommand(["diagnose", "--traces=conv_a"]);
    assert.equal(code, 2, `expected exit 2, got ${code}`);
    assert.match(captured, /requires --out/);
  } finally {
    (process.stderr as unknown as { write: typeof origWrite }).write = origWrite;
  }
});
