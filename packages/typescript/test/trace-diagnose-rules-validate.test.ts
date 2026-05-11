import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { runTraceCommand } from "../src/commands/trace.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIX = path.join(__dirname, "fixtures/trace-diagnose");

test("runTraceCommand: 'diagnose rules validate' on good yaml → exit 0", async () => {
  const code = await runTraceCommand(["diagnose", "rules", "validate", path.join(FIX, "rules-good/r1.yaml")]);
  assert.equal(code, 0);
});

test("runTraceCommand: 'diagnose rules validate' on bad yaml → exit 6", async () => {
  const code = await runTraceCommand(["diagnose", "rules", "validate", path.join(FIX, "rules-bad/missing-taxonomy.yaml")]);
  assert.equal(code, 6);
});

test("runTraceCommand: 'diagnose rules validate' on missing path → exit 2", async () => {
  const code = await runTraceCommand(["diagnose", "rules", "validate"]);
  assert.equal(code, 2);
});
