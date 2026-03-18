import test from "node:test";
import assert from "node:assert/strict";
import { runCli, shouldSkipE2e, shouldRunDestructive } from "./setup.js";

test("e2e: agent list returns JSON array", { skip: shouldSkipE2e() }, async () => {
  const { code, stdout } = await runCli(["agent", "list", "--limit", "5"]);
  assert.equal(code, 0);
  const parsed = JSON.parse(stdout) as unknown;
  assert.ok(Array.isArray(parsed) || (typeof parsed === "object" && (parsed as Record<string, unknown>).entries));
});

test("e2e: agent get returns agent details", { skip: shouldSkipE2e() }, async () => {
  const { code: listCode, stdout: listOut } = await runCli(["agent", "list", "--limit", "1"]);
  if (listCode !== 0) {
    test.skip("agent list failed, cannot get agent id");
    return;
  }
  const list = JSON.parse(listOut) as { id?: string }[] | { entries?: { id?: string }[] };
  const entries = Array.isArray(list) ? list : (list as { entries?: { id?: string }[] }).entries ?? [];
  const firstId = entries[0]?.id;
  if (!firstId) {
    test.skip("no agents in list");
    return;
  }
  const { code, stdout } = await runCli(["agent", "get", firstId]);
  assert.equal(code, 0);
  const agent = JSON.parse(stdout) as Record<string, unknown>;
  assert.ok(agent.id || agent.name, "agent should have id or name");
});

test("e2e: agent get verbose returns full JSON", { skip: shouldSkipE2e() }, async () => {
  const { code: listCode, stdout: listOut } = await runCli(["agent", "list", "--limit", "1"]);
  if (listCode !== 0) {
    test.skip("agent list failed");
    return;
  }
  const list = JSON.parse(listOut) as { id?: string }[] | { entries?: { id?: string }[] };
  const entries = Array.isArray(list) ? list : (list as { entries?: { id?: string }[] }).entries ?? [];
  const firstId = entries[0]?.id;
  if (!firstId) {
    test.skip("no agents");
    return;
  }
  const { code, stdout } = await runCli(["agent", "get", firstId, "--verbose"]);
  assert.equal(code, 0);
  const agent = JSON.parse(stdout) as Record<string, unknown>;
  assert.ok(agent.config !== undefined || agent.kn_ids !== undefined || agent.status !== undefined);
});

test("e2e: agent chat returns non-empty response (destructive)", { skip: !shouldRunDestructive() || shouldSkipE2e() }, async () => {
  const { code: listCode, stdout: listOut } = await runCli(["agent", "list", "--limit", "1"]);
  if (listCode !== 0) {
    test.skip("agent list failed");
    return;
  }
  const list = JSON.parse(listOut) as { id?: string }[] | { entries?: { id?: string }[] };
  const entries = Array.isArray(list) ? list : (list as { entries?: { id?: string }[] }).entries ?? [];
  const firstId = entries[0]?.id;
  if (!firstId) {
    test.skip("no agents");
    return;
  }
  const { code, stdout } = await runCli(["agent", "chat", firstId, "-m", "hello"]);
  assert.equal(code, 0);
  const out = JSON.parse(stdout) as Record<string, unknown>;
  assert.ok(out.answer !== undefined || out.references !== undefined || (typeof out === "string" && out.length > 0));
});
