import type { QueryResult, QueryFailureAnalysis } from "../schemas.js";
import type { TraceSpan } from "../../../api/conversations.js";
import {
  extractToolCalls,
  healthFromToolCalls,
  summarizeToolCalls,
  type RetrievalHealth,
} from "./retrieval-health.js";

type FetchTraceFn = (conversationId: string) => Promise<{ spans: TraceSpan[] }>;

const MAX_REASON_LEN = 200;

/**
 * Per failing query, pair the assertion failure with what the trace says the
 * agent actually did — the tool calls it made and, crucially, whether it
 * retrieved any KN data (`retrieval_health`). The retrieval-health signal lets
 * triage tell a mechanism failure (agent never retrieved data) apart from a
 * reasoning failure (retrieved data, answered wrong).
 */
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

    // "no_trace" until a trace is fetched and parsed — covers both an absent
    // fetcher/conversation_id and a fetch that throws.
    let tool_call_summary: string[] = [];
    let retrieval_health: RetrievalHealth = "no_trace";
    if (fetchTrace && r.conversation_id) {
      try {
        const { spans } = await fetchTrace(r.conversation_id);
        const calls = extractToolCalls(spans);
        tool_call_summary = summarizeToolCalls(calls);
        retrieval_health = healthFromToolCalls(calls);
      } catch {
        // trace fetch is best-effort; retrieval_health stays "no_trace"
      }
    }

    return { query_id: r.query_id, verdict, assertion_reason, tool_call_summary, retrieval_health };
  }));
}
