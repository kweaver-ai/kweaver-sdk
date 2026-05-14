import test from "node:test";
import assert from "node:assert/strict";
import { computeScores } from "../src/trace-ai/exp/scoring.js";
import type { QueryResult } from "../src/trace-ai/exp/schemas.js";

const makeQueryResult = (overrides: Partial<QueryResult> = {}): QueryResult => ({
  query_id: "q1",
  assertion_results: [{ type: "contains", verdict: "pass" }],
  trajectory_summary: { tool_call_sequence: ["search", "answer"], retry_count: 0, latency_ms: 500, error_codes: [] },
  ...overrides,
});

test("computeScores: all pass → high scores", () => {
  const results = [makeQueryResult(), makeQueryResult({ query_id: "q2" })];
  const scores = computeScores(results, []);
  assert.ok(scores.outcome >= 0.9);
  assert.ok(scores.trajectory >= 0.9);
  assert.equal(scores.guardrail_hard_fail, false);
});

test("computeScores: outcome drops on failed assertions", () => {
  const results = [
    makeQueryResult({ assertion_results: [{ type: "contains", verdict: "fail" }] }),
    makeQueryResult(),
  ];
  const scores = computeScores(results, []);
  assert.ok(scores.outcome < 0.6);
});

test("computeScores: trajectory penalized on high retry_count", () => {
  const results = [
    makeQueryResult({ trajectory_summary: { tool_call_sequence: ["a"], retry_count: 5, latency_ms: 500, error_codes: [] } }),
  ];
  const scores = computeScores(results, []);
  assert.ok(scores.trajectory < 0.7);
});

test("computeScores: guardrail hard fail when rule violated", () => {
  const results = [makeQueryResult()];
  const guardrails = [{ name: "no_error", kind: "hard" as const, rule: "error_codes must be empty" }];
  const resultsWithError = [
    makeQueryResult({ trajectory_summary: { tool_call_sequence: [], retry_count: 0, latency_ms: 100, error_codes: ["AUTH_FORBIDDEN"] } }),
  ];
  const scores = computeScores(resultsWithError, guardrails);
  assert.equal(scores.guardrail_hard_fail, true);
});
