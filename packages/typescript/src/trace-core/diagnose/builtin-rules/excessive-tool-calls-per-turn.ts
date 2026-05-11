import type { Hit, Predicate, TraceTree } from "../types.js";

// PR-A approximation: counts tool calls across the entire trace, not per user turn.
// Real per-turn scoping requires turn segmentation by gen_ai.conversation.id round trips,
// which is deferred to PR-B (where the synthesizer can also use turn boundaries for narratives).
// For single-turn traces (the common case in PR-A) this approximation matches the rule semantics.
export const predicate: Predicate = (trace: TraceTree, params: Record<string, unknown>): Hit[] => {
  const max = (params.max_tool_calls_per_turn as number | undefined) ?? 10;
  const tools = trace.byKind.get("tool") ?? [];
  if (tools.length <= max) return [];
  return [{
    evidenceSpans: tools.map((t) => t.spanId),
    excerpt: `tool calls per turn exceeded threshold: ${tools.length} > ${max}`,
    bindings: { count: tools.length, max_calls: max },
  }];
};
