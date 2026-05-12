import test from "node:test";
import assert from "node:assert/strict";

import { parseTraceArgs } from "../src/commands/trace.js";

test("parseTraceArgs: --traces=conv1,conv2 sets mode='batch' + traces raw string", () => {
  const r = parseTraceArgs(["diagnose", "--traces=conv1,conv2", "--out=diagnosis/x"]);
  assert.equal(r.subcommand, "diagnose");
  assert.equal(r.mode, "batch");
  assert.equal(r.traces, "conv1,conv2");
  assert.equal(r.out, "diagnosis/x");
});

test("parseTraceArgs: --traces=@/path/to/file sets traces='@/path/to/file' (resolved later)", () => {
  const r = parseTraceArgs(["diagnose", "--traces=@/tmp/ids.txt", "--out=diagnosis/x"]);
  assert.equal(r.mode, "batch");
  assert.equal(r.traces, "@/tmp/ids.txt");
});

test("parseTraceArgs: --traces with --no-llm flagged for fail-fast (validated later)", () => {
  const r = parseTraceArgs(["diagnose", "--traces=conv1", "--no-llm", "--out=diagnosis/x"]);
  assert.equal(r.mode, "batch");
  assert.equal(r.noLlm, true);
});

test("parseTraceArgs: --traces without --out flagged for fail-fast", () => {
  const r = parseTraceArgs(["diagnose", "--traces=conv1"]);
  assert.equal(r.mode, "batch");
  assert.equal(r.out, null);
});

test("parseTraceArgs: --no-artifacts plumbs through (both modes)", () => {
  const r = parseTraceArgs(["diagnose", "conv_x", "--no-artifacts"]);
  assert.equal(r.mode, "single");
  assert.equal(r.noArtifacts, true);
});

test("parseTraceArgs: --max-parallel default 4", () => {
  const r = parseTraceArgs(["diagnose", "--traces=a,b", "--out=x"]);
  assert.equal(r.maxParallel, 4);
});

test("parseTraceArgs: --max-parallel override parsed as number", () => {
  const r = parseTraceArgs(["diagnose", "--traces=a,b", "--out=x", "--max-parallel=8"]);
  assert.equal(r.maxParallel, 8);
});

test("parseTraceArgs: positional <conv_id> sets mode='single'", () => {
  const r = parseTraceArgs(["diagnose", "01KCONV_x"]);
  assert.equal(r.mode, "single");
  assert.equal(r.conversationId, "01KCONV_x");
});
