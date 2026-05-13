import test from "node:test";
import assert from "node:assert/strict";

import { parseTraceArgs } from "../src/commands/trace.js";

test("parseTraceArgs recognizes 'eval-set build' subcommand", () => {
  const args = parseTraceArgs([
    "eval-set",
    "build",
    "--queries=q.yaml",
    "--out=eval-sets/cs-v1",
  ]);
  assert.equal(args.subcommand, "eval-set-build");
  assert.equal(args.queriesPath, "q.yaml");
  assert.equal(args.out, "eval-sets/cs-v1");
});

test("parseTraceArgs recognizes --diagnosis= source", () => {
  const args = parseTraceArgs([
    "eval-set",
    "build",
    "--diagnosis=diagnosis/",
    "--out=eval-sets/cs-v1",
  ]);
  assert.equal(args.subcommand, "eval-set-build");
  assert.equal(args.diagnosisPath, "diagnosis/");
});

test("parseTraceArgs recognizes --on-conflict + --redaction-rules", () => {
  const args = parseTraceArgs([
    "eval-set",
    "build",
    "--queries=q.yaml",
    "--out=eval-sets/cs-v1",
    "--on-conflict=skip",
    "--redaction-rules=rules.yaml",
  ]);
  assert.equal(args.onConflict, "skip");
  assert.equal(args.redactionRules, "rules.yaml");
});

test("parseTraceArgs defaults on-conflict to 'fail'", () => {
  const args = parseTraceArgs([
    "eval-set",
    "build",
    "--queries=q.yaml",
    "--out=eval-sets/cs-v1",
  ]);
  assert.equal(args.onConflict, "fail");
});
