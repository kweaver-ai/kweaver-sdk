/**
 * `RawSpan`-flavored view of conversation trace data, for diagnose rule
 * predicates. The HTTP / two-hop / auth concerns live in `./agent-observability`;
 * this module only normalizes the raw `_source` documents into the minimal
 * span shape rules read.
 */

import { fetchRawSpansByConversation } from "./agent-observability.js";

export { TraceFetchError } from "./agent-observability.js";

export interface GetSpansByConversationIdOpts {
  baseUrl: string;
  token: string;
  businessDomain: string;
  conversationId: string;
  /** Cap on `terms` aggregation bucket count. Default 100. */
  maxTraceIds?: number;
  /** Cap on spans returned by the second query. Default 2000. */
  maxSpans?: number;
}

export interface RawSpan {
  spanId: string;
  parentSpanId: string | null;
  name?: string;
  startTimeUnixNano?: string;
  endTimeUnixNano?: string;
  status?: { code?: string };
  attributes?: Record<string, unknown>;
  events?: Array<{ name?: string; time?: string; attributes?: Record<string, unknown> }>;
  /** OTel traceId for the trace this span belongs to (when known). */
  traceId?: string;
}

export interface GetSpansByConversationIdResult {
  /** Distinct traceIds observed for this conversation. */
  traceIds: string[];
  /** All spans across all observed traceIds, mapped to `RawSpan` shape. */
  spans: RawSpan[];
  /** True if the agg saw `sum_other_doc_count > 0` (more traceIds than maxTraceIds). */
  truncated: boolean;
}

/**
 * ISO timestamp → nanos-since-epoch string. Preserves up to 9 fractional digits.
 * Falls back to ms precision when the input lacks a fractional component.
 */
export function isoToNanos(iso: string | undefined): string | undefined {
  if (!iso) return undefined;
  // "YYYY-MM-DDTHH:MM:SS.fffffffffZ" or "...+08:00"
  const m = iso.match(/^(.+?)\.(\d{1,9})(Z|[+-]\d{2}:?\d{2})$/);
  if (!m) {
    const ms = Date.parse(iso);
    if (Number.isNaN(ms)) return undefined;
    return (BigInt(ms) * 1_000_000n).toString();
  }
  const ms = Date.parse(m[1] + m[3]);
  if (Number.isNaN(ms)) return undefined;
  const frac = m[2].padEnd(9, "0").slice(0, 9);
  const seconds = BigInt(Math.floor(ms / 1000));
  return (seconds * 1_000_000_000n + BigInt(frac)).toString();
}

function normalizeToRawSpan(source: Record<string, unknown>): RawSpan | null {
  const spanIdRaw = source.spanId ?? source.span_id;
  const spanId = typeof spanIdRaw === "string" ? spanIdRaw : "";
  if (!spanId) return null;

  const parentRaw = source.parentSpanId ?? source.parent_span_id ?? source.parentSpanID;
  const parentSpanId =
    typeof parentRaw === "string" && parentRaw !== "" && parentRaw !== "0" ? parentRaw : null;

  // Prefer pre-normalized nanos (synthetic fixtures); else derive from ISO.
  let startTimeUnixNano: string | undefined;
  let endTimeUnixNano: string | undefined;
  if (typeof source.startTimeUnixNano === "string") startTimeUnixNano = source.startTimeUnixNano;
  else if (typeof source.startTime === "string") startTimeUnixNano = isoToNanos(source.startTime);
  if (typeof source.endTimeUnixNano === "string") endTimeUnixNano = source.endTimeUnixNano;
  else if (typeof source.endTime === "string") endTimeUnixNano = isoToNanos(source.endTime);

  const status = source.status as RawSpan["status"] | undefined;
  const attributes = source.attributes as Record<string, unknown> | undefined;
  const events = Array.isArray(source.events)
    ? (source.events as RawSpan["events"])
    : undefined;
  const name = typeof source.name === "string" ? source.name : undefined;
  const traceIdRaw = source.traceId ?? source.trace_id;
  const traceId = typeof traceIdRaw === "string" ? traceIdRaw : undefined;

  return {
    spanId,
    parentSpanId,
    name,
    startTimeUnixNano,
    endTimeUnixNano,
    status,
    attributes,
    events,
    traceId,
  };
}

export async function getSpansByConversationId(
  opts: GetSpansByConversationIdOpts,
): Promise<GetSpansByConversationIdResult> {
  const fetched = await fetchRawSpansByConversation({
    baseUrl: opts.baseUrl,
    accessToken: opts.token,
    businessDomain: opts.businessDomain,
    conversationId: opts.conversationId,
    maxTraceIds: opts.maxTraceIds,
    maxSpans: opts.maxSpans,
  });

  const spans: RawSpan[] = [];
  for (const src of fetched.rawSources) {
    const span = normalizeToRawSpan(src);
    if (span) spans.push(span);
  }

  return { traceIds: fetched.traceIds, spans, truncated: fetched.truncated };
}
