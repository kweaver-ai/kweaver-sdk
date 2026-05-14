import test from "node:test";
import assert from "node:assert/strict";

import { evaluateAssertion } from "../src/trace-ai/eval-set/assertion-evaluator.js";
import type { AssertionContext } from "../src/trace-ai/eval-set/assertion-evaluator.js";
import type { TraceSpan } from "../src/api/conversations.js";

// ── helpers ──────────────────────────────────────────────────────────────────

function toolSpan(name: string, startNs = "0", endNs?: string): TraceSpan {
  return {
    traceId: "t1",
    spanId: `s-${name}-${startNs}`,
    name: `tool:${name}`,
    kind: "tool",
    startTime: startNs,
    endTime: endNs,
    attributes: { "gen_ai.tool.name": name },
  };
}

function baseCtx(overrides: Partial<AssertionContext> = {}): AssertionContext {
  return {
    answer: "default answer",
    spans: [],
    ...overrides,
  };
}

// ── contains ─────────────────────────────────────────────────────────────────

test("contains: pass when answer includes value", async () => {
  const result = await evaluateAssertion(
    { type: "contains", value: "宁德时代" },
    baseCtx({ answer: "上游供应商包含宁德时代和博世" }),
  );
  assert.equal(result.verdict, "pass");
});

test("contains: fail when answer does not include value", async () => {
  const result = await evaluateAssertion(
    { type: "contains", value: "宁德时代" },
    baseCtx({ answer: "没有相关供应商" }),
  );
  assert.equal(result.verdict, "fail");
  assert.equal(result.actual, "没有相关供应商");
});

// ── not_contains ──────────────────────────────────────────────────────────────

test("not_contains: pass when answer does not include value", async () => {
  const result = await evaluateAssertion(
    { type: "not_contains", value: "仿真测试" },
    baseCtx({ answer: "当前数据不包含该节点" }),
  );
  assert.equal(result.verdict, "pass");
});

test("not_contains: fail when answer includes value", async () => {
  const result = await evaluateAssertion(
    { type: "not_contains", value: "仿真测试" },
    baseCtx({ answer: "仿真测试供应商包括博世" }),
  );
  assert.equal(result.verdict, "fail");
});

// ── regex ─────────────────────────────────────────────────────────────────────

test("regex: pass when pattern matches answer", async () => {
  const result = await evaluateAssertion(
    { type: "regex", pattern: "\\d+家" },
    baseCtx({ answer: "共有78家企业" }),
  );
  assert.equal(result.verdict, "pass");
});

test("regex: fail when pattern does not match", async () => {
  const result = await evaluateAssertion(
    { type: "regex", pattern: "\\d+家" },
    baseCtx({ answer: "没有企业数据" }),
  );
  assert.equal(result.verdict, "fail");
});

test("regex: skip on invalid pattern", async () => {
  const result = await evaluateAssertion(
    { type: "regex", pattern: "[invalid" },
    baseCtx({ answer: "any answer" }),
  );
  assert.equal(result.verdict, "skip");
  assert.ok(String(result.reason).includes("invalid-regex"));
});

// ── tool_call_count ───────────────────────────────────────────────────────────

test("tool_call_count: pass when count equals value (op: eq)", async () => {
  const spans = [toolSpan("query_object_instance"), toolSpan("query_object_instance")];
  const result = await evaluateAssertion(
    { type: "tool_call_count", tool: "query_object_instance", op: "eq", value: 2 },
    baseCtx({ spans }),
  );
  assert.equal(result.verdict, "pass");
  assert.equal(result.actual, 2);
});

test("tool_call_count: fail when count exceeds lte bound", async () => {
  const spans = Array.from({ length: 7 }, () => toolSpan("query_object_instance"));
  const result = await evaluateAssertion(
    { type: "tool_call_count", tool: "query_object_instance", op: "lte", value: 2 },
    baseCtx({ spans }),
  );
  assert.equal(result.verdict, "fail");
  assert.equal(result.actual, 7);
});

test("tool_call_count: pass when count is within lte bound", async () => {
  const spans = [toolSpan("query_object_instance")];
  const result = await evaluateAssertion(
    { type: "tool_call_count", tool: "query_object_instance", op: "lte", value: 2 },
    baseCtx({ spans }),
  );
  assert.equal(result.verdict, "pass");
});

test("tool_call_count: only counts the specified tool", async () => {
  const spans = [
    toolSpan("query_object_instance"),
    toolSpan("query_object_instance"),
    toolSpan("other_tool"),
  ];
  const result = await evaluateAssertion(
    { type: "tool_call_count", tool: "query_object_instance", op: "eq", value: 2 },
    baseCtx({ spans }),
  );
  assert.equal(result.verdict, "pass");
  assert.equal(result.actual, 2);
});

test("tool_call_count: pass with gte op", async () => {
  const spans = [toolSpan("search"), toolSpan("search"), toolSpan("search")];
  const result = await evaluateAssertion(
    { type: "tool_call_count", tool: "search", op: "gte", value: 2 },
    baseCtx({ spans }),
  );
  assert.equal(result.verdict, "pass");
});

test("tool_call_count: fail with gte op when count is below bound", async () => {
  const spans = [toolSpan("search")];
  const result = await evaluateAssertion(
    { type: "tool_call_count", tool: "search", op: "gte", value: 2 },
    baseCtx({ spans }),
  );
  assert.equal(result.verdict, "fail");
});

// ── tool_call_order ───────────────────────────────────────────────────────────

test("tool_call_order: pass when sequence is a subsequence of actual calls", async () => {
  const spans = [
    toolSpan("search", "100"),
    toolSpan("query_object_instance", "200"),
    toolSpan("filter", "300"),
  ];
  const result = await evaluateAssertion(
    { type: "tool_call_order", sequence: ["search", "filter"] },
    baseCtx({ spans }),
  );
  assert.equal(result.verdict, "pass");
});

test("tool_call_order: fail when sequence order is violated", async () => {
  const spans = [
    toolSpan("filter", "100"),
    toolSpan("search", "200"),
  ];
  const result = await evaluateAssertion(
    { type: "tool_call_order", sequence: ["search", "filter"] },
    baseCtx({ spans }),
  );
  assert.equal(result.verdict, "fail");
});

test("tool_call_order: fail when required tool is missing from trace", async () => {
  const spans = [toolSpan("search", "100")];
  const result = await evaluateAssertion(
    { type: "tool_call_order", sequence: ["search", "filter"] },
    baseCtx({ spans }),
  );
  assert.equal(result.verdict, "fail");
});

// ── latency_ms ────────────────────────────────────────────────────────────────

test("latency_ms: pass when duration is within lte bound", async () => {
  const result = await evaluateAssertion(
    { type: "latency_ms", op: "lte", value: 5000 },
    baseCtx({ durationMs: 3200 }),
  );
  assert.equal(result.verdict, "pass");
  assert.equal(result.actual, 3200);
});

test("latency_ms: fail when duration exceeds lte bound", async () => {
  const result = await evaluateAssertion(
    { type: "latency_ms", op: "lte", value: 5000 },
    baseCtx({ durationMs: 8000 }),
  );
  assert.equal(result.verdict, "fail");
  assert.equal(result.actual, 8000);
});

test("latency_ms: skip when durationMs is not provided", async () => {
  const result = await evaluateAssertion(
    { type: "latency_ms", op: "lte", value: 5000 },
    baseCtx({ durationMs: undefined }),
  );
  assert.equal(result.verdict, "skip");
});

// ── unknown type ──────────────────────────────────────────────────────────────

test("unknown assertion type returns skip", async () => {
  const result = await evaluateAssertion(
    { type: "future_assertion_type" as never },
    baseCtx(),
  );
  assert.equal(result.verdict, "skip");
});
