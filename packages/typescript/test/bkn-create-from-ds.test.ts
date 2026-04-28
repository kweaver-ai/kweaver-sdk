import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  assertValidBknObjectNames,
  BKN_OBJECT_NAME_MAX_LENGTH,
  parseKnCreateFromDsArgs,
  parseKnCreateFromCsvArgs,
} from "../src/commands/bkn-ops.js";
import {
  detectPrimaryKey,
  formatPkDetectionError,
  parsePkMap,
} from "../src/commands/bkn-utils.js";

let savedConfigDir: string | undefined;
before(() => {
  savedConfigDir = process.env.KWEAVERC_CONFIG_DIR;
  process.env.KWEAVERC_CONFIG_DIR = mkdtempSync(join(tmpdir(), "kweaver-bkn-create-test-"));
});
after(() => {
  if (savedConfigDir !== undefined) {
    process.env.KWEAVERC_CONFIG_DIR = savedConfigDir;
  } else {
    delete process.env.KWEAVERC_CONFIG_DIR;
  }
});

// ── assertValidBknObjectNames ────────────────────────────────────────────────

test("assertValidBknObjectNames: accepts in-bound names", () => {
  assertValidBknObjectNames(["a", "table_42", "x".repeat(40)], "ctx");
});

test("assertValidBknObjectNames: rejects empty name", () => {
  assert.throws(
    () => assertValidBknObjectNames(["ok", "", "also_ok"], "ctx"),
    /1 name\(s\) violate/,
  );
});

test("assertValidBknObjectNames: rejects 41-char ascii name", () => {
  assert.throws(
    () => assertValidBknObjectNames(["x".repeat(41)], "ctx"),
    /41 chars/,
  );
});

test("assertValidBknObjectNames: counts utf-8 codepoints, not bytes", () => {
  // 40 chinese codepoints — accepted (matches backend utf8.RuneCountInString)
  assertValidBknObjectNames(["中".repeat(40)], "ctx");
  // 41 chinese codepoints — rejected
  assert.throws(
    () => assertValidBknObjectNames(["中".repeat(41)], "ctx"),
    /41 chars/,
  );
});

test("assertValidBknObjectNames: lists every offender in one error", () => {
  let caught: Error | undefined;
  try {
    assertValidBknObjectNames(["x".repeat(41), "ok", "y".repeat(50)], "ctx");
  } catch (e) {
    caught = e as Error;
  }
  assert.ok(caught);
  assert.match(caught!.message, /2 name\(s\) violate/);
  assert.match(caught!.message, /41 chars/);
  assert.match(caught!.message, /50 chars/);
});

test("assertValidBknObjectNames: limit constant matches backend", () => {
  assert.equal(BKN_OBJECT_NAME_MAX_LENGTH, 40);
});

// ── parseKnCreateFromDsArgs --no-rollback ────────────────────────────────────

test("parseKnCreateFromDsArgs: defaults noRollback to false", () => {
  const opts = parseKnCreateFromDsArgs(["ds-1", "--name", "kn-x"]);
  assert.equal(opts.noRollback, false);
});

test("parseKnCreateFromDsArgs: --no-rollback flips noRollback", () => {
  const opts = parseKnCreateFromDsArgs(["ds-1", "--name", "kn-x", "--no-rollback"]);
  assert.equal(opts.noRollback, true);
});

// ── parseKnCreateFromCsvArgs --no-rollback ───────────────────────────────────

test("parseKnCreateFromCsvArgs: --no-rollback round-trips", () => {
  const opts = parseKnCreateFromCsvArgs([
    "ds-1",
    "--files", "./a.csv",
    "--name", "kn-x",
    "--no-rollback",
  ]);
  assert.equal(opts.noRollback, true);
});

// ── detectPrimaryKey ─────────────────────────────────────────────────────────

const TBL = (cols: string[]) => ({
  name: "t",
  columns: cols.map((name) => ({ name, type: "string" })),
});

test("detectPrimaryKey: returns null pk when no sample provided", () => {
  const r = detectPrimaryKey(TBL(["a", "b"]));
  assert.equal(r.pk, null);
  assert.equal(r.sampleSize, 0);
  assert.deepEqual(r.candidates, []);
});

test("detectPrimaryKey: returns null pk when no column is fully unique", () => {
  // 'sector' has 2 unique values in 4-row sample — the issue #97 scenario.
  const rows = [
    { sector: "auto", company: "A" },
    { sector: "auto", company: "B" },
    { sector: "tech", company: "C" },
    { sector: "tech", company: "C" },
  ];
  const r = detectPrimaryKey(TBL(["sector", "company"]), rows);
  assert.equal(r.pk, null);
  assert.equal(r.sampleSize, 4);
  // Candidates sorted desc by cardinality.
  assert.equal(r.candidates[0]!.name, "company");
  assert.equal(r.candidates[0]!.cardinality, 3);
  assert.equal(r.candidates[1]!.name, "sector");
  assert.equal(r.candidates[1]!.cardinality, 2);
});

test("detectPrimaryKey: picks the unique column when only one is fully unique", () => {
  const rows = [
    { id: "1", sector: "auto" },
    { id: "2", sector: "auto" },
    { id: "3", sector: "tech" },
  ];
  const r = detectPrimaryKey(TBL(["sector", "id"]), rows);
  assert.equal(r.pk, "id");
});

test("detectPrimaryKey: prefers PK-like names among ties", () => {
  // Both 'user_id' and 'token' are fully unique; should prefer 'user_id'.
  const rows = [
    { token: "x", user_id: "1" },
    { token: "y", user_id: "2" },
    { token: "z", user_id: "3" },
  ];
  const r = detectPrimaryKey(TBL(["token", "user_id"]), rows);
  assert.equal(r.pk, "user_id");
});

test("detectPrimaryKey: returns null on empty rows array", () => {
  const r = detectPrimaryKey(TBL(["a"]), []);
  assert.equal(r.pk, null);
  assert.equal(r.sampleSize, 0);
});

// ── formatPkDetectionError ───────────────────────────────────────────────────

test("formatPkDetectionError: no-sample message mentions --pk-map and import-csv", () => {
  const msg = formatPkDetectionError("my_table", { pk: null, candidates: [], sampleSize: 0 });
  assert.match(msg, /my_table/);
  assert.match(msg, /No sample data/);
  assert.match(msg, /--pk-map my_table:<column>/);
});

test("formatPkDetectionError: with-sample message lists candidates and shows --pk-map example", () => {
  const msg = formatPkDetectionError("ht_v2_industry_graph_en", {
    pk: null,
    candidates: [
      { name: "company_abbr", cardinality: 97 },
      { name: "vehicle_id", cardinality: 95 },
      { name: "sector", cardinality: 5 },
    ],
    sampleSize: 100,
  });
  assert.match(msg, /No column has unique values in the 100-row sample/);
  assert.match(msg, /company_abbr.*97 unique/);
  assert.match(msg, /sector.*5 unique/);
  assert.match(msg, /--pk-map ht_v2_industry_graph_en:<column>/);
});

// ── parsePkMap ───────────────────────────────────────────────────────────────

test("parsePkMap: single entry", () => {
  assert.deepEqual(parsePkMap("t1:f1"), { t1: "f1" });
});

test("parsePkMap: multiple entries", () => {
  assert.deepEqual(
    parsePkMap("t1:f1,t2:f2"),
    { t1: "f1", t2: "f2" },
  );
});

test("parsePkMap: trims whitespace", () => {
  assert.deepEqual(
    parsePkMap("  t1 : f1 , t2:f2 "),
    { t1: "f1", t2: "f2" },
  );
});

test("parsePkMap: rejects entry without colon", () => {
  assert.throws(() => parsePkMap("t1"), /Invalid --pk-map entry/);
});

test("parsePkMap: rejects entry with empty table or field", () => {
  assert.throws(() => parsePkMap(":f1"), /Invalid --pk-map entry/);
  assert.throws(() => parsePkMap("t1:"), /Invalid --pk-map entry/);
});

// ── parseKnCreateFromDsArgs --pk-map ─────────────────────────────────────────

test("parseKnCreateFromDsArgs: defaults pkMap to empty", () => {
  const opts = parseKnCreateFromDsArgs(["ds-1", "--name", "kn-x"]);
  assert.deepEqual(opts.pkMap, {});
});

test("parseKnCreateFromDsArgs: --pk-map populates pkMap", () => {
  const opts = parseKnCreateFromDsArgs([
    "ds-1",
    "--name", "kn-x",
    "--pk-map", "t1:f1,t2:f2",
  ]);
  assert.deepEqual(opts.pkMap, { t1: "f1", t2: "f2" });
});

// ── parseKnCreateFromCsvArgs --pk-map ────────────────────────────────────────

test("parseKnCreateFromCsvArgs: --pk-map populates pkMap", () => {
  const opts = parseKnCreateFromCsvArgs([
    "ds-1",
    "--files", "./a.csv",
    "--name", "kn-x",
    "--pk-map", "t1:f1",
  ]);
  assert.deepEqual(opts.pkMap, { t1: "f1" });
});
