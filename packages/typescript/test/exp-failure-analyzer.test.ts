import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { analyzeFailures } from "../src/trace-ai/exp/context/failure-analyzer.js";
import type { QueryResult } from "../src/trace-ai/exp/schemas.js";

const baseResult = (overrides: Partial<QueryResult> = {}): QueryResult => ({
  query_id: "Q1",
  assertion_results: [],
  trajectory_summary: { tool_call_sequence: [], retry_count: 0, latency_ms: 0, error_codes: [] },
  ...overrides,
});

describe("analyzeFailures", () => {
  it("returns empty array when no failures", async () => {
    const results = [
      baseResult({ assertion_results: [{ type: "semantic_match", verdict: "pass", reason: "ok" }] }),
    ];
    const out = await analyzeFailures(results);
    assert.deepStrictEqual(out, []);
  });

  it("extracts assertion_reason for fail verdict", async () => {
    const reason = "agent returned 别克-君越 5816辆, expected 大众-朗逸 42780辆";
    const results = [
      baseResult({
        query_id: "Q38",
        assertion_results: [{ type: "semantic_match", verdict: "fail", reason }],
      }),
    ];
    const [analysis] = await analyzeFailures(results);
    assert.strictEqual(analysis.query_id, "Q38");
    assert.strictEqual(analysis.verdict, "fail");
    assert.strictEqual(analysis.assertion_reason, reason);
    assert.deepStrictEqual(analysis.tool_call_summary, []);
  });

  it("truncates long assertion_reason to 200 chars", async () => {
    const longReason = "x".repeat(400);
    const results = [
      baseResult({ assertion_results: [{ type: "semantic_match", verdict: "fail", reason: longReason }] }),
    ];
    const [analysis] = await analyzeFailures(results);
    assert.strictEqual(analysis.assertion_reason.length, 200);
  });

  it("includes skip verdict queries", async () => {
    const results = [
      baseResult({
        query_id: "Q54",
        assertion_results: [{ type: "semantic_match", verdict: "skip", reason: "JSON parse error" }],
      }),
    ];
    const [analysis] = await analyzeFailures(results);
    assert.strictEqual(analysis.verdict, "skip");
  });

  it("extracts tool_call_summary from trace spans", async () => {
    const results = [
      baseResult({
        query_id: "Q42",
        assertion_results: [{ type: "semantic_match", verdict: "fail", reason: "wrong concept" }],
        conversation_id: "conv-123",
      }),
    ];
    const mockFetch = async (_id: string) => ({
      spans: [
        { traceId: "t1", spanId: "s1", name: "kn_search", attributes: { "input.query": "激光雷达", "output.count": 8 }, startTime: "", status: "ok" as const },
        { traceId: "t1", spanId: "s2", name: "kn_search", attributes: { "input.query": "vehicle_sales" }, startTime: "", status: "ok" as const },
        { traceId: "t1", spanId: "s3", name: "kn_search", attributes: { "input.query": "brand" }, startTime: "", status: "ok" as const },
        // 4th call should be truncated (max 3)
        { traceId: "t1", spanId: "s4", name: "kn_search", attributes: { "input.query": "extra" }, startTime: "", status: "ok" as const },
      ],
    });
    const [analysis] = await analyzeFailures(results, mockFetch);
    assert.strictEqual(analysis.tool_call_summary.length, 3);
    assert.ok(analysis.tool_call_summary[0].includes("kn_search"));
    assert.ok(analysis.tool_call_summary[0].includes("激光雷达"));
  });

  it("skips trace fetch when no conversation_id", async () => {
    let fetchCalled = false;
    const results = [
      baseResult({ assertion_results: [{ type: "semantic_match", verdict: "fail", reason: "err" }] }),
    ];
    await analyzeFailures(results, async () => { fetchCalled = true; return { spans: [] }; });
    assert.strictEqual(fetchCalled, false);
  });
});
