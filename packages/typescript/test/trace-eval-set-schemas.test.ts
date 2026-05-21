import test from "node:test";
import assert from "node:assert/strict";

import {
  EvalSetIndexSchema,
  EvalSetShardSchema,
  EvalSetInputSchema,
  TestReportSchema,
} from "../src/trace-ai/eval-set/schemas.js";

// ── EvalSetIndexSchema (trace-eval-set-index/v1) ───────────────────────────

test("EvalSetIndexSchema accepts a minimal valid index", () => {
  const ok = EvalSetIndexSchema.safeParse({
    schema_version: "trace-eval-set-index/v1",
    eval_set_id: "cs-v1",
    shards: [{ path: "cases.yaml" }],
  });
  assert.equal(ok.success, true);
});

test("EvalSetIndexSchema rejects ../ escape in shard path", () => {
  const bad = EvalSetIndexSchema.safeParse({
    schema_version: "trace-eval-set-index/v1",
    eval_set_id: "cs-v1",
    shards: [{ path: "../escape.yaml" }],
  });
  assert.equal(bad.success, false);
});

test("EvalSetIndexSchema rejects empty shards array", () => {
  const bad = EvalSetIndexSchema.safeParse({
    schema_version: "trace-eval-set-index/v1",
    eval_set_id: "cs-v1",
    shards: [],
  });
  assert.equal(bad.success, false);
});

test("EvalSetIndexSchema accepts and exposes target_kn", () => {
  const ok = EvalSetIndexSchema.safeParse({
    schema_version: "trace-eval-set-index/v1",
    eval_set_id: "cs-v1",
    shards: [{ path: "cases.yaml" }],
    target_kn: "d86oj8na2s1et30t7jag",
  });
  assert.equal(ok.success, true);
  assert.equal(ok.success && ok.data.target_kn, "d86oj8na2s1et30t7jag");
});

test("EvalSetIndexSchema rejects empty target_kn", () => {
  const bad = EvalSetIndexSchema.safeParse({
    schema_version: "trace-eval-set-index/v1",
    eval_set_id: "cs-v1",
    shards: [{ path: "cases.yaml" }],
    target_kn: "",
  });
  assert.equal(bad.success, false);
});

// ── EvalSetShardSchema (trace-eval-set/v1) ──────────────────────────────────

test("EvalSetShardSchema accepts a case with reference only", () => {
  const ok = EvalSetShardSchema.safeParse({
    schema_version: "trace-eval-set/v1",
    cases: [
      {
        query_id: "q1",
        input: { user_message: "hello" },
        reference: { answer: "world" },
      },
    ],
  });
  assert.equal(ok.success, true);
});

test("EvalSetShardSchema accepts a case with assertions only", () => {
  const ok = EvalSetShardSchema.safeParse({
    schema_version: "trace-eval-set/v1",
    cases: [
      {
        query_id: "q1",
        input: { user_message: "hello" },
        assertions: [{ type: "contains", value: "world" }],
      },
    ],
  });
  assert.equal(ok.success, true);
});

test("EvalSetShardSchema rejects a case with neither reference nor assertions (refinement)", () => {
  const bad = EvalSetShardSchema.safeParse({
    schema_version: "trace-eval-set/v1",
    cases: [
      {
        query_id: "q1",
        input: { user_message: "hello" },
      },
    ],
  });
  assert.equal(bad.success, false);
});

test("EvalSetShardSchema rejects a case with empty assertions array and no reference", () => {
  const bad = EvalSetShardSchema.safeParse({
    schema_version: "trace-eval-set/v1",
    cases: [
      {
        query_id: "q1",
        input: { user_message: "hello" },
        assertions: [],
      },
    ],
  });
  assert.equal(bad.success, false);
});

// ── EvalSetInputSchema (trace-eval-set-input/v1) — same refinement ──────────

test("EvalSetInputSchema accepts a case with reference + assertions", () => {
  const ok = EvalSetInputSchema.safeParse({
    schema_version: "trace-eval-set-input/v1",
    cases: [
      {
        input: { user_message: "hello" },
        reference: { answer: "world" },
        assertions: [{ type: "contains", value: "world" }],
      },
    ],
  });
  assert.equal(ok.success, true);
});

test("EvalSetInputSchema rejects input case with neither reference nor assertions", () => {
  const bad = EvalSetInputSchema.safeParse({
    schema_version: "trace-eval-set-input/v1",
    cases: [{ input: { user_message: "hello" } }],
  });
  assert.equal(bad.success, false);
});

test("EvalSetInputSchema accepts optional query_id and tags", () => {
  const ok = EvalSetInputSchema.safeParse({
    schema_version: "trace-eval-set-input/v1",
    cases: [
      {
        input: { user_message: "hello" },
        reference: { answer: "world" },
        query_id: "q1",
        tags: ["refund"],
      },
    ],
  });
  assert.equal(ok.success, true);
});

// ── TestReportSchema (trace-test-report/v1) ─────────────────────────────────

test("TestReportSchema accepts a minimal valid report", () => {
  const ok = TestReportSchema.safeParse({
    schema_version: "trace-test-report/v1",
    meta: {
      eval_set_dir: "eval-sets/cs-v1/",
      eval_set_id: "cs-v1",
      candidate: { agent_id: "agt_42" },
      cli_version: "kweaver-sdk@0.8.3",
      ran_at: "2026-05-13T14:23:11Z",
      duration_ms: 1000,
    },
    summary: { total: 1, pass: 1, fail: 0, error: 0, skip: 0, by_assertion_type: {} },
    cases: [
      {
        query_id: "q1",
        status: "pass",
        conversation_id: "conv_x",
        assertion_results: [],
      },
    ],
  });
  assert.equal(ok.success, true);
});

test("TestReportSchema rejects invalid status enum", () => {
  const bad = TestReportSchema.safeParse({
    schema_version: "trace-test-report/v1",
    meta: {
      eval_set_dir: "eval-sets/cs-v1/",
      eval_set_id: "cs-v1",
      candidate: { agent_id: "agt_42" },
      cli_version: "kweaver-sdk@0.8.3",
      ran_at: "2026-05-13T14:23:11Z",
      duration_ms: 1000,
    },
    summary: { total: 1, pass: 1, fail: 0, error: 0, skip: 0, by_assertion_type: {} },
    cases: [
      {
        query_id: "q1",
        status: "wat",
        conversation_id: "conv_x",
        assertion_results: [],
      },
    ],
  });
  assert.equal(bad.success, false);
});
