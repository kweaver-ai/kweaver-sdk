import test from "node:test";
import assert from "node:assert/strict";
import { runCli, shouldSkipE2e, shouldRunDestructive } from "./setup.js";

test("e2e: bkn build --no-wait returns immediately", { skip: !shouldRunDestructive() || shouldSkipE2e() }, async () => {
  const { code: listCode, stdout: listOut } = await runCli(["bkn", "list", "--limit", "1"]);
  if (listCode !== 0) {
    test.skip("bkn list failed");
    return;
  }
  const parsed = JSON.parse(listOut) as { entries?: { id: string }[] } | { id: string }[];
  const entries = Array.isArray(parsed) ? parsed : parsed.entries ?? [];
  const knId = entries[0] && typeof entries[0] === "object" && "id" in entries[0] ? (entries[0] as { id: string }).id : null;
  if (!knId) {
    test.skip("no KN available");
    return;
  }
  const { code, stderr } = await runCli(["bkn", "build", knId, "--no-wait"]);
  assert.equal(code, 0);
  assert.ok(stderr.includes("Build started") || stderr.includes("started"));
});
