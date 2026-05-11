import type { Hit, Predicate, Span, TraceTree } from "../types.js";

function finishReason(s: Span): string {
  const a = s.attributes["gen_ai.response.finish_reason"] ?? s.attributes["llm.finish_reason"];
  return typeof a === "string" ? a : "";
}

function conversationId(s: Span): string {
  const v = s.attributes["gen_ai.conversation.id"];
  return typeof v === "string" ? v : "";
}

export const predicate: Predicate = (trace: TraceTree): Hit[] => {
  const llms = (trace.byKind.get("llm") ?? [])
    .slice()
    .sort((a, b) => Number(BigInt(a.startTimeUnixNano) - BigInt(b.startTimeUnixNano)));
  const hits: Hit[] = [];
  for (let i = 0; i < llms.length; i++) {
    const s = llms[i];
    if (finishReason(s) !== "length") continue;
    const convId = conversationId(s);
    let hasContinuation = false;
    for (let j = i + 1; j < llms.length; j++) {
      if (conversationId(llms[j]) === convId) { hasContinuation = true; break; }
    }
    if (!hasContinuation) {
      hits.push({
        evidenceSpans: [s.spanId],
        excerpt: `LLM response truncated (finish_reason=length) with no continuation span in conversation '${convId}'`,
        bindings: { conversation_id: convId },
      });
    }
  }
  return hits;
};
