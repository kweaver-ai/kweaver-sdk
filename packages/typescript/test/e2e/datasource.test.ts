import test from "node:test";
import assert from "node:assert/strict";
import { runCli, shouldSkipE2e, getE2eEnv, shouldRunDestructive } from "./setup.js";

test("e2e: ds list returns array", { skip: shouldSkipE2e() }, async () => {
  const { code, stdout } = await runCli(["ds", "list"]);
  assert.equal(code, 0);
  const parsed = JSON.parse(stdout) as unknown;
  assert.ok(Array.isArray(parsed) || (typeof parsed === "object" && (parsed as Record<string, unknown>).entries !== undefined));
});

test("e2e: ds get returns datasource details", { skip: shouldSkipE2e() }, async () => {
  const { code: listCode, stdout: listOut } = await runCli(["ds", "list"]);
  if (listCode !== 0) {
    test.skip("ds list failed");
    return;
  }
  const list = JSON.parse(listOut) as { id?: string }[] | { entries?: { id?: string }[] };
  const entries = Array.isArray(list) ? list : (list as { entries?: { id?: string }[] }).entries ?? [];
  const dsId = entries[0]?.id;
  if (!dsId) {
    test.skip("no datasources");
    return;
  }
  const { code, stdout } = await runCli(["ds", "get", dsId]);
  assert.equal(code, 0);
  const ds = JSON.parse(stdout) as Record<string, unknown>;
  assert.ok(ds.id !== undefined || ds.ds_id !== undefined);
});

test("e2e: ds tables returns tables with columns", { skip: shouldSkipE2e() }, async () => {
  const { code: listCode, stdout: listOut } = await runCli(["ds", "list"]);
  if (listCode !== 0) {
    test.skip("ds list failed");
    return;
  }
  const list = JSON.parse(listOut) as { id?: string }[] | { entries?: { id?: string }[] };
  const entries = Array.isArray(list) ? list : (list as { entries?: { id?: string }[] }).entries ?? [];
  const dsId = entries[0]?.id;
  if (!dsId) {
    test.skip("no datasources");
    return;
  }
  const { code, stdout } = await runCli(["ds", "tables", dsId]);
  assert.equal(code, 0);
  const parsed = JSON.parse(stdout) as unknown;
  assert.ok(Array.isArray(parsed) || typeof parsed === "object");
});

test("e2e: ds connect registers datasource (destructive)", { skip: !shouldRunDestructive() || shouldSkipE2e() }, async () => {
  const env = getE2eEnv();
  if (!env.dbHost || !env.dbUser || !env.dbPass || !env.dbName) {
    test.skip("E2E database not configured: KWEAVER_TEST_DB_HOST, KWEAVER_TEST_DB_USER, KWEAVER_TEST_DB_PASS, KWEAVER_TEST_DB_NAME required");
    return;
  }
  const { code, stdout } = await runCli([
    "ds",
    "connect",
    env.dbType,
    env.dbHost,
    env.dbPort,
    env.dbName,
    "--account",
    env.dbUser,
    "--password",
    env.dbPass,
    "--name",
    "e2e_test_ds_" + Date.now(),
  ]);
  assert.equal(code, 0);
  const parsed = JSON.parse(stdout) as Record<string, unknown> | Record<string, unknown>[];
  const item = Array.isArray(parsed) ? parsed[0] : parsed;
  assert.ok(item && (item.id !== undefined || item.ds_id !== undefined));
});
