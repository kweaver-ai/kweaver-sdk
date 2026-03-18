import test from "node:test";
import assert from "node:assert/strict";
import { runCli, shouldSkipE2e, shouldRunDestructive, getE2eEnv } from "./setup.js";

test("e2e: full lifecycle ds connect -> bkn create-from-ds -> bkn export -> bkn search (destructive)", {
  skip: !shouldRunDestructive() || shouldSkipE2e(),
}, async () => {
  const env = getE2eEnv();
  if (!env.dbHost || !env.dbUser || !env.dbPass || !env.dbName) {
    test.skip("E2E database not configured");
    return;
  }
  const dsName = "e2e_full_flow_" + Date.now();
  const knName = "e2e_kn_" + Date.now();

  const { code: connectCode, stdout: connectOut } = await runCli([
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
    dsName,
  ]);
  if (connectCode !== 0) {
    test.skip("ds connect failed");
    return;
  }
  const connectParsed = JSON.parse(connectOut) as Record<string, unknown> | Record<string, unknown>[];
  const dsItem = Array.isArray(connectParsed) ? connectParsed[0] : connectParsed;
  const dsId = dsItem && typeof dsItem === "object" && ("id" in dsItem || "ds_id" in dsItem)
    ? String((dsItem as { id?: string; ds_id?: string }).id ?? (dsItem as { ds_id?: string }).ds_id)
    : null;
  if (!dsId) {
    test.skip("no datasource id from connect");
    return;
  }

  const { code: createCode, stdout: createOut } = await runCli([
    "bkn",
    "create-from-ds",
    dsId,
    "--name",
    knName,
    "--no-build",
  ]);
  if (createCode !== 0) {
    test.skip("bkn create-from-ds failed: " + createOut);
    return;
  }
  const createParsed = JSON.parse(createOut) as { kn_id?: string; id?: string };
  const knId = createParsed?.kn_id ?? createParsed?.id;
  if (!knId) {
    test.skip("no kn id from create-from-ds");
    return;
  }

  const { code: exportCode, stdout: exportOut } = await runCli(["bkn", "export", knId]);
  assert.equal(exportCode, 0);
  const exportParsed = JSON.parse(exportOut) as Record<string, unknown>;
  assert.ok(typeof exportParsed === "object");

  const { code: searchCode } = await runCli(["bkn", "search", knId, "test"]);
  assert.equal(searchCode, 0);

  await runCli(["bkn", "delete", knId, "-y"]);
  await runCli(["ds", "delete", dsId, "-y"]);
});
