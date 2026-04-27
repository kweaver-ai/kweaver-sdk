import test from "node:test";
import assert from "node:assert/strict";

import {
  assertValidBknObjectNames,
  BKN_OBJECT_NAME_MAX_LENGTH,
  parseKnCreateFromDsArgs,
  parseKnCreateFromCsvArgs,
} from "../src/commands/bkn-ops.js";

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
