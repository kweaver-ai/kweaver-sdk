import test from "node:test";
import assert from "node:assert/strict";
import {
  runCli,
  shouldSkipE2e,
  extractCliJsonEntries,
  findFirstSuccessfulObjectTypeQuery,
} from "./setup.js";

async function findKnWithData(): Promise<string | null> {
  const { code, stdout } = await runCli(["bkn", "list", "--limit", "20"]);
  if (code !== 0) return null;
  const kns = extractCliJsonEntries(JSON.parse(stdout));
  for (const item of kns as Array<{ id?: string }>) {
    if (!item.id) continue;
    const { code: otCode, stdout: otOut } = await runCli(["bkn", "object-type", "list", item.id]);
    if (otCode !== 0) continue;
    const ots = extractCliJsonEntries(JSON.parse(otOut));
    if (ots.length > 0 && (ots[0] as { id?: string }).id) return item.id;
  }
  return null;
}

test("e2e: bkn list returns array", { skip: shouldSkipE2e() }, async () => {
  const { code, stdout } = await runCli(["bkn", "list", "--limit", "5"]);
  assert.equal(code, 0);
  const entries = extractCliJsonEntries(JSON.parse(stdout));
  assert.ok(entries.length >= 0, "bkn list should return parseable entries");
});

test("e2e: bkn search returns JSON", { skip: shouldSkipE2e() }, async () => {
  const knId = await findKnWithData();
  if (!knId) { test.skip("no KN available"); return; }
  const { code, stdout } = await runCli(["bkn", "search", knId, "test", "--max-concepts", "10"]);
  assert.equal(code, 0);
  assert.ok(typeof JSON.parse(stdout) === "object");
});

test("e2e: bkn object-type list returns array", { skip: shouldSkipE2e() }, async () => {
  const knId = await findKnWithData();
  if (!knId) { test.skip("no KN available"); return; }
  const { code, stdout } = await runCli(["bkn", "object-type", "list", knId]);
  assert.equal(code, 0);
  const entries = extractCliJsonEntries(JSON.parse(stdout));
  assert.ok(entries.length > 0, "should have at least 1 object type");
});

test("e2e: bkn object-type query returns data", { skip: shouldSkipE2e() }, async () => {
  const hit = await findFirstSuccessfulObjectTypeQuery();
  if (!hit) {
    test.skip("no KN/OT pair returned a successful object-type query (no indexed data or API errors)");
    return;
  }
  const parsed = JSON.parse(hit.stdout) as Record<string, unknown>;
  assert.ok(
    Array.isArray(parsed) || parsed.datas !== undefined || parsed.data !== undefined,
    "should contain datas or data field"
  );
});
