import test from "node:test";
import assert from "node:assert/strict";
import { runCli, shouldSkipE2e, shouldRunDestructive } from "./setup.js";

test("e2e: bkn build --no-wait returns immediately", { skip: !shouldRunDestructive() || shouldSkipE2e() }, async () => {
  // Find a KN that has object types (buildable)
  const { code: listCode, stdout: listOut } = await runCli(["bkn", "list", "--limit", "20"]);
  if (listCode !== 0) { test.skip("bkn list failed"); return; }

  const parsed = JSON.parse(listOut);
  const kns = Array.isArray(parsed) ? parsed : parsed.entries ?? [];

  let knId: string | null = null;
  for (const kn of kns as Array<{ id?: string }>) {
    if (!kn.id) continue;
    const { code, stdout } = await runCli(["bkn", "object-type", "list", kn.id]);
    if (code !== 0) continue;
    const ots = JSON.parse(stdout);
    const entries = Array.isArray(ots) ? ots : ots.entries ?? [];
    if (entries.length > 0) { knId = kn.id; break; }
  }

  if (!knId) { test.skip("no KN with object types found"); return; }

  const { code, stdout, stderr } = await runCli(["bkn", "build", knId, "--no-wait"]);
  if (code !== 0 && (stderr.includes("NoneConceptType") || stderr.includes("JobConceptConfig"))) {
    test.skip("BKN has no buildable concepts");
    return;
  }
  assert.equal(code, 0, `build failed: ${stderr}`);
});
