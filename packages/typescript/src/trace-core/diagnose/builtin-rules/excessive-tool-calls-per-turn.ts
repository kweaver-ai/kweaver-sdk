import type { Hit, Predicate, TraceTree } from "../types.js";

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
