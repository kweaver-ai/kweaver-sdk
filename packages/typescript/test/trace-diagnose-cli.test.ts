import test from "node:test";
import assert from "node:assert/strict";

import { parseTraceArgs } from "../src/commands/trace.js";

test("parseTraceArgs: 'diagnose <id>' parses conversationId positional", () => {
  const r = parseTraceArgs(["diagnose", "tr_de39"]);
  assert.equal(r.subcommand, "diagnose");
  assert.equal(r.conversationId, "tr_de39");
  assert.equal(r.out, null);  // default → resolved later
  assert.equal(r.noBuiltin, false);
});

test("parseTraceArgs: 'diagnose <id> --out=path' parses out flag", () => {
  const r = parseTraceArgs(["diagnose", "tr_de39", "--out", "diagnosis/x.yaml"]);
  assert.equal(r.out, "diagnosis/x.yaml");
});

test("parseTraceArgs: 'diagnose <id> --no-builtin' sets noBuiltin", () => {
  const r = parseTraceArgs(["diagnose", "tr_de39", "--no-builtin"]);
  assert.equal(r.noBuiltin, true);
});

test("parseTraceArgs: 'diagnose rules validate <path>' parses to rulesValidate subcommand", () => {
  const r = parseTraceArgs(["diagnose", "rules", "validate", "rules/r.yaml"]);
  assert.equal(r.subcommand, "rules-validate");
  assert.equal(r.rulePath, "rules/r.yaml");
});

test("parseTraceArgs: missing subcommand returns help intent", () => {
  const r = parseTraceArgs([]);
  assert.equal(r.subcommand, "help");
});
