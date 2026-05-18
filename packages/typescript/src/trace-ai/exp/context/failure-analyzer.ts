import type { QueryResult, QueryFailureAnalysis } from "../schemas.js";
import type { TraceSpan } from "../../../api/conversations.js";

type FetchTraceFn = (conversationId: string) => Promise<{ spans: TraceSpan[] }>;

const TOOL_NAMES = new Set(["kn_search", "dv_query", "query_object_instance", "search_schema", "get_logic_properties_values"]);
const MAX_REASON_LEN = 200;
const MAX_TOOL_CALLS = 3;

function extractToolCalls(spans: TraceSpan[]): string[] {
  return spans
    .filter(s => TOOL_NAMES.has(s.name))
    .slice(0, MAX_TOOL_CALLS)
    .map(s => {
      const attrs = s.attributes ?? {};
      const query = attrs["input.query"] ?? attrs["gen_ai.prompt"] ?? "";
      const count = attrs["output.count"] ?? attrs["output.total"] ?? "";
      const queryStr = typeof query === "string" && query ? `(${query.slice(0, 30)})` : "";
      const countStr = count !== "" ? `→${count}` : "";
      return `${s.name}${queryStr}${countStr}`;
    });
}

export async function analyzeFailures(
  results: QueryResult[],
  fetchTrace?: FetchTraceFn,
): Promise<QueryFailureAnalysis[]> {
  const failing = results.filter(r =>
    r.assertion_results.some(a => a.verdict === "fail" || a.verdict === "skip")
  );

  return Promise.all(failing.map(async r => {
    const worstAssertion = r.assertion_results.find(a => a.verdict === "fail")
      ?? r.assertion_results.find(a => a.verdict === "skip");
    const verdict = worstAssertion?.verdict === "fail" ? "fail" : "skip";
    const rawReason = worstAssertion?.reason ?? "";
    const assertion_reason = rawReason.slice(0, MAX_REASON_LEN);

    let tool_call_summary: string[] = [];
    if (fetchTrace && r.conversation_id) {
      try {
        const { spans } = await fetchTrace(r.conversation_id);
        tool_call_summary = extractToolCalls(spans);
      } catch {
        // trace fetch is best-effort; don't fail triage
      }
    }

    return { query_id: r.query_id, verdict, assertion_reason, tool_call_summary };
  }));
}
