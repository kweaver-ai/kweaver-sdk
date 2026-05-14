import test from "node:test";
import assert from "node:assert/strict";

import { parseTraceArgs } from "../src/commands/trace.js";

test("parseTraceArgs recognizes 'eval-set test' subcommand", () => {
  const args = parseTraceArgs([
    "eval-set", "test",
    "eval-sets/ht-v1/",
    "--candidate=01KRFZW5W17B1JKVC5JSV7D9M5",
    "--out=test-runs/baseline/",
  ]);
  assert.equal(args.subcommand, "eval-set-test");
  assert.equal(args.evalSetPath, "eval-sets/ht-v1/");
  assert.equal(args.candidateAgentId, "01KRFZW5W17B1JKVC5JSV7D9M5");
  assert.equal(args.out, "test-runs/baseline/");
});

test("parseTraceArgs eval-set test supports --candidate=<id>@<version>", () => {
  const args = parseTraceArgs([
    "eval-set", "test",
    "eval-sets/cs-v1/",
    "--candidate=agt_42@v2",
    "--out=test-runs/v2/",
  ]);
  assert.equal(args.subcommand, "eval-set-test");
  assert.equal(args.candidateAgentId, "agt_42");
  assert.equal(args.candidateAgentVersion, "v2");
});

test("parseTraceArgs eval-set test supports --max-parallel", () => {
  const args = parseTraceArgs([
    "eval-set", "test",
    "eval-sets/cs-v1/",
    "--candidate=agt_1",
    "--out=out/",
    "--max-parallel=2",
  ]);
  assert.equal(args.maxParallel, 2);
});

test("parseTraceArgs eval-set test defaults max-parallel to 4", () => {
  const args = parseTraceArgs([
    "eval-set", "test",
    "eval-sets/cs-v1/",
    "--candidate=agt_1",
    "--out=out/",
  ]);
  assert.equal(args.maxParallel, 4);
});
