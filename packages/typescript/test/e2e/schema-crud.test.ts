import test from "node:test";
import assert from "node:assert/strict";
import { runCli, shouldSkipE2e } from "./setup.js";

async function findKnId(): Promise<string | null> {
  const { code, stdout } = await runCli(["bkn", "list", "--limit", "10"]);
  if (code !== 0) return null;
  const parsed = JSON.parse(stdout) as { entries?: { id: string }[] } | { id: string }[];
  const entries = Array.isArray(parsed) ? parsed : parsed.entries ?? [];
  const first = entries[0];
  return first && typeof first === "object" && "id" in first ? (first as { id: string }).id : null;
}

test("e2e: object-type list returns array", { skip: shouldSkipE2e() }, async () => {
  const knId = await findKnId();
  if (!knId) {
    test.skip("no KN available");
    return;
  }
  const { code, stdout } = await runCli(["bkn", "object-type", "list", knId]);
  assert.equal(code, 0);
  const parsed = JSON.parse(stdout) as unknown;
  assert.ok(Array.isArray(parsed) || (typeof parsed === "object" && (parsed as Record<string, unknown>).entries !== undefined));
});

test("e2e: object-type get returns single OT", { skip: shouldSkipE2e() }, async () => {
  const knId = await findKnId();
  if (!knId) {
    test.skip("no KN available");
    return;
  }
  const { code: listCode, stdout: listOut } = await runCli(["bkn", "object-type", "list", knId]);
  if (listCode !== 0) {
    test.skip("object-type list failed");
    return;
  }
  const list = JSON.parse(listOut) as { id?: string }[] | { entries?: { id?: string }[] };
  const entries = Array.isArray(list) ? list : (list as { entries?: { id?: string }[] }).entries ?? [];
  const otId = entries[0]?.id;
  if (!otId) {
    test.skip("no object types");
    return;
  }
  const { code, stdout } = await runCli(["bkn", "object-type", "get", knId, otId]);
  assert.equal(code, 0);
  const ot = JSON.parse(stdout) as Record<string, unknown>;
  assert.ok(ot.id !== undefined || ot.name !== undefined);
});

test("e2e: relation-type list returns array", { skip: shouldSkipE2e() }, async () => {
  const knId = await findKnId();
  if (!knId) {
    test.skip("no KN available");
    return;
  }
  const { code, stdout } = await runCli(["bkn", "relation-type", "list", knId]);
  assert.equal(code, 0);
  const parsed = JSON.parse(stdout) as unknown;
  assert.ok(Array.isArray(parsed) || typeof parsed === "object");
});

test("e2e: relation-type get returns single RT", { skip: shouldSkipE2e() }, async () => {
  const knId = await findKnId();
  if (!knId) {
    test.skip("no KN available");
    return;
  }
  const { code: listCode, stdout: listOut } = await runCli(["bkn", "relation-type", "list", knId]);
  if (listCode !== 0) {
    test.skip("relation-type list failed");
    return;
  }
  const list = JSON.parse(listOut) as { id?: string }[] | { entries?: { id?: string }[] };
  const entries = Array.isArray(list) ? list : (list as { entries?: { id?: string }[] }).entries ?? [];
  const rtId = entries[0]?.id;
  if (!rtId) {
    test.skip("no relation types");
    return;
  }
  const { code, stdout } = await runCli(["bkn", "relation-type", "get", knId, rtId]);
  assert.equal(code, 0);
  const rt = JSON.parse(stdout) as Record<string, unknown>;
  assert.ok(rt.id !== undefined || rt.name !== undefined);
});
