// test/exp-retrieval-health.test.ts
//
// Fixtures mirror the REAL agent-executor trace schema (verified against a live
// trace): tool spans are named "execute_tool <name>", the clean name is in
// gen_ai.tool.name, and the result payload is a JSON string in
// gen_ai.tool.call.result. The span's own status.code is "Ok" even when the
// tool returned an error — the error lives inside the result payload.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { TraceSpan } from "../src/api/conversations.js";
import {
  extractToolCalls,
  healthFromToolCalls,
  summarizeToolCalls,
  diagnoseMechanism,
  type ToolCallRecord,
} from "../src/trace-ai/exp/context/retrieval-health.js";
import type { QueryFailureAnalysis } from "../src/trace-ai/exp/schemas.js";

// ── span fixtures (real schema) ───────────────────────────────────────────

function toolSpan(toolName: string, args: string, result: string): TraceSpan {
  return {
    traceId: "t1",
    spanId: `s-${Math.random()}`,
    name: `execute_tool ${toolName}`,
    startTime: "2026-05-21T05:27:37Z",
    status: { code: "Ok", message: "" },
    attributes: {
      "gen_ai.operation.name": "execute_tool",
      "gen_ai.tool.name": toolName,
      "gen_ai.tool.call.arguments": args,
      "gen_ai.tool.call.result": result,
    },
  };
}

// real result payloads, verbatim shapes from a live trace
const RESULT_ERROR =
  '{"answer": "data: {\\"error_code\\":\\"OntologyQuery.ObjectType.ObjectTypeNotFound\\",\\"description\\":\\"对象类不存在\\"}\\n\\ndata: [DONE]\\n\\n", "block_answer": ""}';
const RESULT_EMPTY = '{"answer": {"result": []}, "block_answer": {"result": []}}';
const RESULT_DATA_INSTANCES = '{"answer": {"datas": [{"sales_id": "x"}, {"sales_id": "y"}]}, "block_answer": ""}';
const RESULT_DATA_SCHEMA = '{"answer": {"object_types": [{"concept_id": "d86o", "concept_name": "车型销量"}]}, "block_answer": ""}';
const RESULT_EMPTY_DATAS = '{"answer": {"datas": []}, "block_answer": ""}';

// ── extractToolCalls ──────────────────────────────────────────────────────

describe("extractToolCalls", () => {
  it("extracts execute_tool spans using the real gen_ai.* attribute schema", () => {
    const spans = [
      toolSpan("query_object_instance", '{"otId":"vehicle_sales"}', RESULT_ERROR),
      toolSpan("kn_search", '{"query":"sales"}', RESULT_DATA_SCHEMA),
    ];
    const calls = extractToolCalls(spans);
    assert.equal(calls.length, 2);
    assert.equal(calls[0].tool_name, "query_object_instance");
    assert.equal(calls[0].outcome, "error");
    assert.equal(calls[1].tool_name, "kn_search");
    assert.equal(calls[1].outcome, "data");
  });

  it("ignores non-tool spans (LLM calls, http, internal)", () => {
    const spans: TraceSpan[] = [
      { traceId: "t", spanId: "s1", name: "chat deepseek-chat", startTime: "" },
      { traceId: "t", spanId: "s2", name: "agent-executor.http", startTime: "" },
      toolSpan("query_object_instance", "{}", RESULT_DATA_INSTANCES),
    ];
    const calls = extractToolCalls(spans);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].tool_name, "query_object_instance");
  });

  it("classifies an error result (answer string carrying error_code) as error", () => {
    const [call] = extractToolCalls([toolSpan("query_object_instance", "{}", RESULT_ERROR)]);
    assert.equal(call.outcome, "error");
  });

  it("classifies an empty result (empty data array) as empty", () => {
    const [call] = extractToolCalls([toolSpan("search_memory", "{}", RESULT_EMPTY)]);
    assert.equal(call.outcome, "empty");
  });

  it("classifies an empty datas array as empty", () => {
    const [call] = extractToolCalls([toolSpan("query_object_instance", "{}", RESULT_EMPTY_DATAS)]);
    assert.equal(call.outcome, "empty");
  });

  it("classifies a non-empty datas array as data", () => {
    const [call] = extractToolCalls([toolSpan("query_object_instance", "{}", RESULT_DATA_INSTANCES)]);
    assert.equal(call.outcome, "data");
  });

  it("classifies a non-empty object_types array as data", () => {
    const [call] = extractToolCalls([toolSpan("kn_search", "{}", RESULT_DATA_SCHEMA)]);
    assert.equal(call.outcome, "data");
  });

  it("treats malformed/absent result payload as empty, not a crash", () => {
    assert.equal(extractToolCalls([toolSpan("kn_search", "{}", "not json")])[0].outcome, "empty");
    assert.equal(extractToolCalls([toolSpan("kn_search", "{}", "")])[0].outcome, "empty");
  });
});

// ── healthFromToolCalls ───────────────────────────────────────────────────

function rec(tool_name: string, outcome: ToolCallRecord["outcome"]): ToolCallRecord {
  return { tool_name, arguments: "", outcome };
}

describe("healthFromToolCalls", () => {
  it("returns 'retrieved' when any KN tool call returned data", () => {
    assert.equal(
      healthFromToolCalls([rec("query_object_instance", "error"), rec("query_object_instance", "data")]),
      "retrieved",
    );
  });

  it("returns 'errored' when KN tool calls were made and all errored", () => {
    assert.equal(
      healthFromToolCalls([rec("query_object_instance", "error"), rec("kn_search", "error")]),
      "errored",
    );
  });

  it("returns 'empty' when KN tool calls were made and all came back empty", () => {
    assert.equal(healthFromToolCalls([rec("query_object_instance", "empty")]), "empty");
  });

  it("returns 'errored' when KN calls are a mix of error and empty (no data)", () => {
    assert.equal(
      healthFromToolCalls([rec("query_object_instance", "empty"), rec("kn_search", "error")]),
      "errored",
    );
  });

  it("returns 'no_kn_calls' when only non-KN tools were called", () => {
    assert.equal(
      healthFromToolCalls([rec("search_memory", "empty"), rec("Execute_Code_Sync", "data")]),
      "no_kn_calls",
    );
  });

  it("returns 'no_kn_calls' when no tool calls were made at all", () => {
    assert.equal(healthFromToolCalls([]), "no_kn_calls");
  });
});

// ── summarizeToolCalls ────────────────────────────────────────────────────

describe("summarizeToolCalls", () => {
  it("renders each call as tool_name→outcome", () => {
    const out = summarizeToolCalls([rec("query_object_instance", "error"), rec("kn_search", "data")]);
    assert.deepEqual(out, ["query_object_instance→error", "kn_search→data"]);
  });

  it("caps the summary so it does not flood the triage prompt", () => {
    const many = Array.from({ length: 20 }, () => rec("kn_search", "data"));
    assert.ok(summarizeToolCalls(many).length <= 8);
  });

  it("returns an empty array for no calls", () => {
    assert.deepEqual(summarizeToolCalls([]), []);
  });
});

// ── diagnoseMechanism ─────────────────────────────────────────────────────

function fa(query_id: string, retrieval_health: QueryFailureAnalysis["retrieval_health"]): QueryFailureAnalysis {
  return { query_id, verdict: "fail", assertion_reason: "", tool_call_summary: [], retrieval_health };
}

describe("diagnoseMechanism", () => {
  it("flags broken when 3+ failing queries retrieved no KN data and none retrieved", () => {
    const d = diagnoseMechanism([fa("Q1", "errored"), fa("Q2", "empty"), fa("Q3", "errored")]);
    assert.equal(d.broken, true);
    assert.match(d.reason, /KN/);
  });

  it("is not broken when at least one failing query did retrieve KN data", () => {
    const d = diagnoseMechanism([fa("Q1", "errored"), fa("Q2", "empty"), fa("Q3", "retrieved")]);
    assert.equal(d.broken, false);
  });

  it("is not broken below the minimum-evidence threshold (fewer than 3)", () => {
    const d = diagnoseMechanism([fa("Q1", "errored"), fa("Q2", "errored")]);
    assert.equal(d.broken, false);
  });

  it("ignores no_kn_calls / no_trace queries when judging the mechanism", () => {
    // only 2 queries actually exercised the KN — not enough evidence
    const d = diagnoseMechanism([
      fa("Q1", "errored"), fa("Q2", "empty"),
      fa("Q3", "no_kn_calls"), fa("Q4", "no_trace"), fa("Q5", "no_trace"),
    ]);
    assert.equal(d.broken, false);
  });

  it("reason names the counts and points at the KN binding, not the prompt", () => {
    const d = diagnoseMechanism([fa("Q1", "errored"), fa("Q2", "errored"), fa("Q3", "empty")]);
    assert.match(d.reason, /3/);
    assert.match(d.reason, /binding/i);
    assert.match(d.reason, /not a prompt/i);
  });
});
