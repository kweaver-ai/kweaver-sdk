import type { Hit, Predicate, Span, TraceTree } from "../types.js";

function resultCount(s: Span): number | null {
  const v = s.attributes["gen_ai.retrieval.result_count"];
  return typeof v === "number" ? v : null;
}

export const predicate: Predicate = (trace: TraceTree): Hit[] => {
  const ordered = trace.spans
    .slice()
    .sort((a, b) => Number(BigInt(a.startTimeUnixNano) - BigInt(b.startTimeUnixNano)));
  const hits: Hit[] = [];
  for (let i = 0; i < ordered.length; i++) {
    const s = ordered[i];
    if (s.kind !== "retrieval") continue;
    if (resultCount(s) !== 0) continue;
    const next = ordered[i + 1];
    if (!next) continue;
    if (next.kind === "llm") {
      hits.push({
        evidenceSpans: [s.spanId, next.spanId],
        excerpt: `retrieval returned 0 results; next step was LLM generation with no fallback path`,
        bindings: {},
      });
    }
    // retrieval (retry/rewrite) or tool (alt source) → no hit
  }
  return hits;
};
