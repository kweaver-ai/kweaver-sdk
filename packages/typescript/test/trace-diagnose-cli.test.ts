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

test("parseTraceArgs: default format is null (resolved to 'both' by diagnose when --out given)", () => {
  const r = parseTraceArgs(["diagnose", "tr_x", "--out", "out.yaml"]);
  assert.equal(r.format, null);
});

test("parseTraceArgs: --format=markdown parses", () => {
  const r = parseTraceArgs(["diagnose", "tr_x", "--format", "markdown"]);
  assert.equal(r.format, "markdown");
});

test("parseTraceArgs: --format=yaml parses", () => {
  const r = parseTraceArgs(["diagnose", "tr_x", "--format", "yaml"]);
  assert.equal(r.format, "yaml");
});

test("parseTraceArgs: --format=both parses", () => {
  const r = parseTraceArgs(["diagnose", "tr_x", "--format", "both"]);
  assert.equal(r.format, "both");
});

test("parseTraceArgs: default lang is null (resolved to 'en' by diagnose)", () => {
  const r = parseTraceArgs(["diagnose", "tr_x"]);
  assert.equal(r.lang, null);
});

test("parseTraceArgs: --lang=zh parses", () => {
  const r = parseTraceArgs(["diagnose", "tr_x", "--lang", "zh"]);
  assert.equal(r.lang, "zh");
});

test("parseTraceArgs: --lang=en parses", () => {
  const r = parseTraceArgs(["diagnose", "tr_x", "--lang", "en"]);
  assert.equal(r.lang, "en");
});
