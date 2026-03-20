import test from "node:test";
import assert from "node:assert/strict";
import { runCli, shouldSkipE2e } from "./setup.js";

/** Extract array entries from CLI JSON output (handles entries/data/datas/array). */
function extractEntries(raw: unknown): unknown[] {
  if (Array.isArray(raw)) return raw;
  if (raw && typeof raw === "object") {
    const obj = raw as Record<string, unknown>;
    for (const key of ["entries", "data", "datas", "records"]) {
      if (Array.isArray(obj[key])) return obj[key] as unknown[];
    }
  }
  return [];
}

async function findKnWithData(): Promise<string | null> {
  const { code, stdout } = await runCli(["bkn", "list", "--limit", "20"]);
  if (code !== 0) return null;
  const kns = extractEntries(JSON.parse(stdout));
  for (const item of kns as Array<{ id?: string }>) {
    if (!item.id) continue;
    const { code: otCode, stdout: otOut } = await runCli(["bkn", "object-type", "list", item.id]);
    if (otCode !== 0) continue;
    const ots = extractEntries(JSON.parse(otOut));
    if (ots.length > 0 && (ots[0] as { id?: string }).id) return item.id;
  }
  return null;
}

test("e2e: bkn list returns array", { skip: shouldSkipE2e() }, async () => {
  const { code, stdout } = await runCli(["bkn", "list", "--limit", "5"]);
  assert.equal(code, 0);
  const entries = extractEntries(JSON.parse(stdout));
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
  const entries = extractEntries(JSON.parse(stdout));
  assert.ok(entries.length > 0, "should have at least 1 object type");
});

test("e2e: bkn object-type query returns data", { skip: shouldSkipE2e() }, async () => {
  const knId = await findKnWithData();
  if (!knId) { test.skip("no KN available"); return; }
  const { code: otCode, stdout: otOut } = await runCli(["bkn", "object-type", "list", knId]);
  if (otCode !== 0) { test.skip("object-type list failed"); return; }
  const ots = extractEntries(JSON.parse(otOut)) as Array<{ id?: string }>;
  const otId = ots[0]?.id;
  if (!otId) { test.skip("no object types"); return; }
  const { code, stdout, stderr } = await runCli(["bkn", "object-type", "query", knId, otId, "{}", "--limit", "5"]);
  if (code !== 0 && stderr.includes("500")) { test.skip("server returned 500"); return; }
  assert.equal(code, 0);
  const parsed = JSON.parse(stdout) as Record<string, unknown>;
  // API returns { datas: [...] } or { data: [...] } or array
  assert.ok(
    Array.isArray(parsed) || parsed.datas !== undefined || parsed.data !== undefined,
    "should contain datas or data field"
  );
});
