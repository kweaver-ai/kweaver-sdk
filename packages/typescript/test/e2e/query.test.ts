import test from "node:test";
import assert from "node:assert/strict";
import { runCli, shouldSkipE2e } from "./setup.js";

async function findKnWithData(): Promise<string | null> {
  const { code, stdout } = await runCli(["bkn", "list", "--limit", "20"]);
  if (code !== 0) return null;
  const parsed = JSON.parse(stdout) as { entries?: { id: string }[] } | { id: string }[];
  const entries = Array.isArray(parsed) ? parsed : parsed.entries ?? [];
  for (const item of entries) {
    const knId = "id" in item ? item.id : (item as { id: string }).id;
    if (knId) return knId;
  }
  return null;
}

test("e2e: bkn list returns array", { skip: shouldSkipE2e() }, async () => {
  const { code, stdout } = await runCli(["bkn", "list", "--limit", "5"]);
  assert.equal(code, 0);
  const parsed = JSON.parse(stdout) as unknown;
  assert.ok(Array.isArray(parsed) || (typeof parsed === "object" && (parsed as Record<string, unknown>).entries));
});

test("e2e: bkn search returns JSON", { skip: shouldSkipE2e() }, async () => {
  const knId = await findKnWithData();
  if (!knId) {
    test.skip("no KN available");
    return;
  }
  const { code, stdout } = await runCli(["bkn", "search", knId, "test", "--limit", "10"]);
  assert.equal(code, 0);
  const parsed = JSON.parse(stdout) as unknown;
  assert.ok(typeof parsed === "object");
});

test("e2e: bkn object-type list returns array", { skip: shouldSkipE2e() }, async () => {
  const knId = await findKnWithData();
  if (!knId) {
    test.skip("no KN available");
    return;
  }
  const { code, stdout } = await runCli(["bkn", "object-type", "list", knId]);
  assert.equal(code, 0);
  const parsed = JSON.parse(stdout) as unknown;
  assert.ok(Array.isArray(parsed) || (typeof parsed === "object"));
});

test("e2e: bkn object-type query returns data", { skip: shouldSkipE2e() }, async () => {
  const knId = await findKnWithData();
  if (!knId) {
    test.skip("no KN available");
    return;
  }
  const { code: otCode, stdout: otOut } = await runCli(["bkn", "object-type", "list", knId]);
  if (otCode !== 0) {
    test.skip("object-type list failed");
    return;
  }
  const otList = JSON.parse(otOut) as { id?: string }[] | { entries?: { id?: string }[] };
  const entries = Array.isArray(otList) ? otList : (otList as { entries?: { id?: string }[] }).entries ?? [];
  const otId = entries[0]?.id;
  if (!otId) {
    test.skip("no object types");
    return;
  }
  const { code, stdout } = await runCli(["bkn", "object-type", "query", knId, otId, "{}", "--limit", "5"]);
  assert.equal(code, 0);
  const parsed = JSON.parse(stdout) as { data?: unknown[] } | unknown[];
  assert.ok(Array.isArray(parsed) || (parsed as { data?: unknown[] }).data !== undefined);
});
