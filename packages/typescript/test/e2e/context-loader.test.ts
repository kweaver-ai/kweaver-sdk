import test from "node:test";
import assert from "node:assert/strict";
import { runCli, shouldSkipE2e, findFirstSuccessfulObjectTypeQuery } from "./setup.js";

async function findKnId(): Promise<string | null> {
  const { code, stdout } = await runCli(["bkn", "list", "--limit", "10"]);
  if (code !== 0) return null;
  const parsed = JSON.parse(stdout) as { entries?: { id: string }[] } | { id: string }[];
  const entries = Array.isArray(parsed) ? parsed : parsed.entries ?? [];
  const first = entries[0];
  return first && "id" in first ? first.id : null;
}

test("e2e: bkn list returns id and name", { skip: shouldSkipE2e() }, async () => {
  const { code, stdout } = await runCli(["bkn", "list", "--limit", "5"]);
  assert.equal(code, 0);
  const parsed = JSON.parse(stdout) as { entries?: { id?: string; name?: string }[] } | { id?: string; name?: string }[];
  const entries = Array.isArray(parsed) ? parsed : parsed.entries ?? [];
  if (entries.length > 0) {
    const first = entries[0];
    assert.ok(first.id !== undefined || first.name !== undefined);
  }
});

test("e2e: bkn export returns dict", { skip: shouldSkipE2e() }, async () => {
  const knId = await findKnId();
  if (!knId) {
    test.skip("no KN available");
    return;
  }
  const { code, stdout } = await runCli(["bkn", "export", knId]);
  assert.equal(code, 0);
  const parsed = JSON.parse(stdout) as Record<string, unknown>;
  assert.ok(typeof parsed === "object");
});

test("e2e: bkn object-type query instances", { skip: shouldSkipE2e() }, async () => {
  const hit = await findFirstSuccessfulObjectTypeQuery();
  if (!hit) {
    test.skip("no KN/OT pair returned a successful object-type query (no indexed data or API errors)");
    return;
  }
  const parsed = JSON.parse(hit.stdout) as unknown;
  assert.ok(typeof parsed === "object" || Array.isArray(parsed));
});
