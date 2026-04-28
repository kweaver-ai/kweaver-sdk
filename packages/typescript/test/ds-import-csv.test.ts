import test from "node:test";
import assert from "node:assert/strict";
import { tmpdir } from "node:os";
import { writeFileSync, rmSync, mkdirSync } from "node:fs";
import { join, resolve as resolvePath } from "node:path";

import { resolveFiles, parseImportCsvArgs } from "../src/commands/ds.js";

const TMP_DIR = join(tmpdir(), "ds-import-csv-test-" + process.pid);

// ── Setup ─────────────────────────────────────────────────────────────────────

test("setup: create temp dir", () => {
  mkdirSync(TMP_DIR, { recursive: true });
});

// ── resolveFiles ──────────────────────────────────────────────────────────────

test("resolveFiles: resolves single file path", async () => {
  const filePath = join(TMP_DIR, "a.csv");
  writeFileSync(filePath, "name\nAlice\n");

  const result = await resolveFiles(filePath);

  assert.equal(result.length, 1);
  assert.equal(result[0], resolvePath(filePath));
});

test("resolveFiles: resolves comma-separated file paths", async () => {
  const f1 = join(TMP_DIR, "b1.csv");
  const f2 = join(TMP_DIR, "b2.csv");
  writeFileSync(f1, "x\n1\n");
  writeFileSync(f2, "y\n2\n");

  const result = await resolveFiles(`${f1},${f2}`);

  assert.equal(result.length, 2);
});

test("resolveFiles: resolves glob pattern", async () => {
  const subDir = join(TMP_DIR, "glob-test");
  mkdirSync(subDir, { recursive: true });
  writeFileSync(join(subDir, "g1.csv"), "a\n1\n");
  writeFileSync(join(subDir, "g2.csv"), "b\n2\n");
  writeFileSync(join(subDir, "g3.txt"), "not csv");

  const result = await resolveFiles(`${subDir}/*.csv`);

  assert.equal(result.length, 2);
  assert.ok(result.every((f) => f.endsWith(".csv")));
});

test("resolveFiles: throws on non-existent file", async () => {
  await assert.rejects(
    () => resolveFiles(join(TMP_DIR, "does-not-exist.csv")),
    /ENOENT/
  );
});

test("resolveFiles: throws when glob matches nothing", async () => {
  await assert.rejects(
    () => resolveFiles(join(TMP_DIR, "empty-glob-dir-xxx/*.csv")),
    /No CSV files matched/
  );
});

// ── parseImportCsvArgs: businessDomain propagation ────────────────────────────

test("parseImportCsvArgs: -bd is correctly parsed for downstream use", () => {
  const opts = parseImportCsvArgs([
    "ds-999",
    "--files", "data.csv",
    "-bd", "bd_custom",
  ]);

  // The parsed businessDomain must be available for BOTH getDatasource
  // and executeDataflow calls in runDsImportCsv
  assert.equal(opts.businessDomain, "bd_custom");
  assert.equal(opts.datasourceId, "ds-999");
});

test("parseImportCsvArgs: --biz-domain long form works identically", () => {
  const opts = parseImportCsvArgs([
    "ds-999",
    "--files", "data.csv",
    "--biz-domain", "bd_other",
  ]);
  assert.equal(opts.businessDomain, "bd_other");
});

// ── Teardown ──────────────────────────────────────────────────────────────────

test("teardown: remove temp dir", () => {
  rmSync(TMP_DIR, { recursive: true, force: true });
});
