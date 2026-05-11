import type { Span, SpanKind, TraceTree } from "./types.js";
import type { RawSpan } from "../../api/trace.js";

const KIND_MAP: Record<string, SpanKind> = {
  model: "llm",
  llm: "llm",
  tool: "tool",
  retrieval: "retrieval",
  reasoning: "reasoning",
};

function deriveKind(attrs: Record<string, unknown>): SpanKind {
  const t = attrs["agent.trace.type"];
  if (typeof t === "string" && t in KIND_MAP) return KIND_MAP[t];
  return "unknown";
}

function deriveStatus(raw: RawSpan["status"]): "ok" | "error" | "unset" {
  const code = raw?.code?.toUpperCase();
  if (code === "OK") return "ok";
  if (code === "ERROR") return "error";
  return "unset";
}

function durationMs(start?: string, end?: string): number {
  if (!start || !end) return 0;
  // string nanos → BigInt to avoid precision loss, then convert to ms.
  const s = BigInt(start);
  const e = BigInt(end);
  return Number((e - s) / 1_000_000n);
}

export function assembleTraceTree(traceId: string, raw: RawSpan[]): TraceTree {
  const spans: Span[] = raw.map((r) => {
    const attrs = r.attributes ?? {};
    return {
      spanId: r.spanId,
      parentSpanId: r.parentSpanId ?? null,
      name: r.name ?? "",
      kind: deriveKind(attrs),
      startTimeUnixNano: r.startTimeUnixNano ?? "0",
      endTimeUnixNano: r.endTimeUnixNano ?? "0",
      durationMs: durationMs(r.startTimeUnixNano, r.endTimeUnixNano),
      status: deriveStatus(r.status),
      attributes: attrs,
    };
  });

  const byId = new Map<string, Span>();
  const parentToChildren = new Map<string | null, Span[]>();
  const byKind = new Map<SpanKind, Span[]>();

  for (const s of spans) {
    byId.set(s.spanId, s);
    const arr = parentToChildren.get(s.parentSpanId) ?? [];
    arr.push(s);
    parentToChildren.set(s.parentSpanId, arr);
    const kindArr = byKind.get(s.kind) ?? [];
    kindArr.push(s);
    byKind.set(s.kind, kindArr);
  }

  const roots = parentToChildren.get(null) ?? [];
  const root = roots.length > 0 ? roots[0] : null;

  return { traceId, spans, byId, parentToChildren, byKind, root };
}
