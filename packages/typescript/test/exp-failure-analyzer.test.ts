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

  // Trace spans use the real agent-executor schema: name "execute_tool <name>",
  // result payload as a JSON string in gen_ai.tool.call.result.
  const toolSpan = (toolName: string, result: string) => ({
    traceId: "t1",
    spanId: `s-${toolName}-${Math.random()}`,
    name: `execute_tool ${toolName}`,
    startTime: "",
    status: { code: "Ok" },
    attributes: {
      "gen_ai.operation.name": "execute_tool",
      "gen_ai.tool.name": toolName,
      "gen_ai.tool.call.result": result,
    },
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
        toolSpan("kn_search", '{"answer": {"object_types": [{"id": "x"}]}}'),
        toolSpan("query_object_instance", '{"answer": {"datas": [{"r": 1}]}}'),
      ],
    });
    const [analysis] = await analyzeFailures(results, mockFetch);
    assert.deepStrictEqual(analysis.tool_call_summary, ["kn_search→data", "query_object_instance→data"]);
  });

  it("reports retrieval_health 'retrieved' when a KN tool returned data", async () => {
    const results = [
      baseResult({ query_id: "Q1", assertion_results: [{ type: "semantic_match", verdict: "fail", reason: "x" }], conversation_id: "c1" }),
    ];
    const mockFetch = async () => ({ spans: [toolSpan("query_object_instance", '{"answer": {"datas": [{"r": 1}]}}')] });
    const [analysis] = await analyzeFailures(results, mockFetch);
    assert.strictEqual(analysis.retrieval_health, "retrieved");
  });

  it("reports retrieval_health 'errored' when KN tool calls all errored", async () => {
    const errorResult = '{"answer": "data: {\\"error_code\\":\\"ObjectTypeNotFound\\"}\\n\\n"}';
    const results = [
      baseResult({ query_id: "Q1", assertion_results: [{ type: "semantic_match", verdict: "fail", reason: "x" }], conversation_id: "c1" }),
    ];
    const mockFetch = async () => ({ spans: [toolSpan("query_object_instance", errorResult)] });
    const [analysis] = await analyzeFailures(results, mockFetch);
    assert.strictEqual(analysis.retrieval_health, "errored");
  });

  it("reports retrieval_health 'no_trace' when no fetcher is provided", async () => {
    const results = [
      baseResult({ assertion_results: [{ type: "semantic_match", verdict: "fail", reason: "x" }] }),
    ];
    const [analysis] = await analyzeFailures(results);
    assert.strictEqual(analysis.retrieval_health, "no_trace");
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
