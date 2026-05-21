// src/trace-ai/exp/context/retrieval-health.ts
//
// Trace-derived "did the agent actually retrieve KN data" signal. The exp loop
// scores answer outcomes but, without this, cannot see WHY a round failed — a
// mis-bound agent that retrieves nothing looks the same to outcome scoring as
// an agent that retrieved data and reasoned poorly. This module reads the real
// agent-executor trace schema and turns it into a mechanism-health verdict so
// triage can fail fast on "the agent isn't retrieving data" instead of burning
// rounds patching prompts.
//
// Real trace schema (verified against a live trace): tool spans carry
// `gen_ai.operation.name == "execute_tool"`, the clean tool name in
// `gen_ai.tool.name`, and the result payload as a JSON string in
// `gen_ai.tool.call.result` ({answer, block_answer}). The span's own
// status.code is "Ok" even when the tool failed — the error
// (`{"error_code": ...}`) lives inside the result payload.
import type { TraceSpan } from "../../../api/conversations.js";
import type { QueryFailureAnalysis } from "../schemas.js";

export type ToolCallOutcome = "data" | "empty" | "error";

export interface ToolCallRecord {
  tool_name: string;
  /** Raw gen_ai.tool.call.arguments JSON string (may be ""). */
  arguments: string;
  outcome: ToolCallOutcome;
}

export type RetrievalHealth = "retrieved" | "empty" | "errored" | "no_kn_calls" | "no_trace";

export interface MechanismDiagnosis {
  broken: boolean;
  /** Root-cause message, populated only when broken. */
  reason: string;
}

/** KN retrieval/navigation tools — calls to these are what "retrieved KN data" means. */
const KN_RETRIEVAL_TOOLS = new Set([
  "query_object_instance",
  "kn_search",
  "semantic_search",
  "search_schema",
  "get_logic_properties_values",
  "dv_query",
  // SQL aggregation over the KN's Vega resources — the agent's main data path
  // for COUNT/SUM/GROUP BY/TOP-N. Omitting it makes the mechanism check blind to
  // a SQL-capable agent and false-flag a healthy round as "retrieved no data".
  "vega_sql_query",
]);

const TOOL_SPAN_PREFIX = "execute_tool ";

/**
 * Minimum no-data failing queries before the mechanism may be blamed. A handful
 * of no-data failures can be legitimate (a genuinely hard question, or the agent
 * building a bad query) — the guard needs enough of them to be confident. An
 * eval set smaller than this can never trip the guard on count alone; that is
 * acceptable because the round-level retrieval veto (roundRetrievedAnyData in
 * failure-analyzer) is the real safety net against a false positive.
 */
const MIN_MECHANISM_EVIDENCE = 3;

/**
 * Classify a tool's result `answer` payload. Biased toward "data" on ambiguous
 * objects: a false "data" only means a mechanism failure goes undetected (the
 * loop behaves as before), whereas a false "empty"/"error" could wrongly fail a
 * healthy round.
 */
function classifyAnswer(answer: unknown): ToolCallOutcome {
  if (answer === null || answer === undefined) return "empty";
  // The error payload comes back as an SSE string carrying error_code.
  if (typeof answer === "string") return /error_code/.test(answer) ? "error" : "empty";
  if (Array.isArray(answer)) return answer.length > 0 ? "data" : "empty";
  if (typeof answer === "object") {
    const obj = answer as Record<string, unknown>;
    if (obj["error_code"]) return "error";
    // Any non-empty array property counts as data — deliberately permissive per
    // the bias-toward-"data" rationale above. A metadata array (e.g. warnings)
    // could trip this; that is the acceptable direction to err.
    for (const v of Object.values(obj)) {
      if (Array.isArray(v) && v.length > 0) return "data";
    }
    return "empty";
  }
  return "empty";
}

/** Classify a `gen_ai.tool.call.result` payload string. Defensive — never throws. */
function classifyResult(resultStr: string): ToolCallOutcome {
  if (typeof resultStr !== "string" || resultStr.trim() === "") return "empty";
  let parsed: unknown;
  try {
    parsed = JSON.parse(resultStr);
  } catch {
    // The error payload is itself valid JSON, so a parse failure means an
    // opaque payload — flag it as an error only if it carries an error marker.
    return /error_code/.test(resultStr) ? "error" : "empty";
  }
  return classifyAnswer((parsed as { answer?: unknown } | null)?.answer);
}

/** Extract every `execute_tool` call from a conversation's trace spans. */
export function extractToolCalls(spans: TraceSpan[]): ToolCallRecord[] {
  const calls: ToolCallRecord[] = [];
  for (const span of spans) {
    const attrs = span.attributes ?? {};
    const byAttr = attrs["gen_ai.operation.name"] === "execute_tool";
    const byName = typeof span.name === "string" && span.name.startsWith(TOOL_SPAN_PREFIX);
    if (!byAttr && !byName) continue;
    const toolName =
      typeof attrs["gen_ai.tool.name"] === "string" && attrs["gen_ai.tool.name"]
        ? (attrs["gen_ai.tool.name"] as string)
        : byName
          ? (span.name as string).slice(TOOL_SPAN_PREFIX.length)
          : "";
    if (!toolName) continue;
    const args = typeof attrs["gen_ai.tool.call.arguments"] === "string" ? attrs["gen_ai.tool.call.arguments"] : "";
    const result = typeof attrs["gen_ai.tool.call.result"] === "string" ? attrs["gen_ai.tool.call.result"] : "";
    calls.push({ tool_name: toolName, arguments: args, outcome: classifyResult(result) });
  }
  return calls;
}

/** Render tool calls as `tool_name→outcome` strings for the triage prompt, capped. */
export function summarizeToolCalls(calls: ToolCallRecord[], max = 8): string[] {
  return calls.slice(0, max).map(c => `${c.tool_name}→${c.outcome}`);
}

/**
 * Reduce a query's tool calls to one retrieval-health verdict. "retrieved" wins
 * as soon as any KN call returned data — one good retrieval proves the mechanism
 * works. Otherwise "errored" outranks "empty" (an error is the stronger signal).
 */
export function healthFromToolCalls(calls: ToolCallRecord[]): RetrievalHealth {
  const knCalls = calls.filter(c => KN_RETRIEVAL_TOOLS.has(c.tool_name));
  if (knCalls.length === 0) return "no_kn_calls";
  if (knCalls.some(c => c.outcome === "data")) return "retrieved";
  if (knCalls.some(c => c.outcome === "error")) return "errored";
  return "empty";
}

/**
 * Roll per-query retrieval health up to a round-level verdict. The mechanism is
 * "broken" when enough failing queries exercised the KN yet none retrieved any
 * data — a fail-fast signal that the round measured a wiring failure, not the
 * prompt. no_kn_calls / no_trace queries carry no evidence and are ignored.
 */
export function diagnoseMechanism(analyses: QueryFailureAnalysis[]): MechanismDiagnosis {
  let retrieved = 0;
  let errored = 0;
  let empty = 0;
  for (const a of analyses) {
    if (a.retrieval_health === "retrieved") retrieved++;
    else if (a.retrieval_health === "errored") errored++;
    else if (a.retrieval_health === "empty") empty++;
  }
  const noData = errored + empty;
  if (retrieved > 0 || noData < MIN_MECHANISM_EVIDENCE) {
    return { broken: false, reason: "" };
  }
  return {
    broken: true,
    reason:
      `Mechanism failure: ${noData} failing queries exercised the KN but none retrieved data ` +
      `(${errored} errored, ${empty} empty), and no failing query retrieved any KN data. ` +
      `The agent is not retrieving from the knowledge network — this is not a prompt problem. ` +
      `Check the agent's KN binding (kn_id map_type must be "fixedValue") and that the bound KN holds data.`,
  };
}
