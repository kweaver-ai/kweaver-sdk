/**
 * Fetch trace spans for a conversation via agent-observability OpenSearch
 * (the same path `kweaver agent trace` uses), normalizing the response into
 * the minimal `RawSpan` shape that diagnose downstream rules consume.
 *
 * Two-hop strategy (mirrors api/conversations.ts:getTracesByConversation):
 *   1. aggregate `traceId.keyword` for spans tagged with `gen_ai.conversation.id`
 *   2. fetch all spans whose `traceId.keyword` matches those traceIds
 *
 * A conversation may yield multiple traces (one per turn); PR-A diagnose is
 * single-trace and callers pick which traceId to analyze.
 */

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

export class TraceFetchError extends Error {
  constructor(message: string, public readonly status?: number, public readonly url?: string) {
    super(message);
    this.name = "TraceFetchError";
  }
}

const TRACE_SEARCH_PATH = "/api/agent-observability/v1/traces/_search";

function buildHeaders(token: string, businessDomain: string): Record<string, string> {
  const h: Record<string, string> = {
    "Content-Type": "application/json",
    "X-Business-Domain": businessDomain,
    accept: "application/json",
  };
  if (token && token !== "__NO_AUTH__") {
    h["Authorization"] = `Bearer ${token}`;
  }
  return h;
}

async function postSearch(
  baseUrl: string,
  token: string,
  businessDomain: string,
  body: unknown,
): Promise<Record<string, unknown>> {
  const url = `${baseUrl.replace(/\/+$/, "")}${TRACE_SEARCH_PATH}`;
  const res = await fetch(url, {
    method: "POST",
    headers: buildHeaders(token, businessDomain),
    body: JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) {
    throw new TraceFetchError(
      `trace search failed: HTTP ${res.status} from ${url} — ${text.slice(0, 200)}`,
      res.status,
      url,
    );
  }
  if (!text) return {};
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch (err) {
    throw new TraceFetchError(`trace search: invalid JSON response — ${(err as Error).message}`);
  }
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
    traceId,
  };
}

/**
 * Fetch every span belonging to a conversation, normalized to `RawSpan[]`.
 *
 * Fixture-compat fast path: when the first response carries no `aggregations`
 * but does carry `hits.hits`, the implementation treats that as a flat spans
 * payload and skips hop 2. This keeps existing synthetic/real fixtures usable
 * (single mock-fetch response) while real platforms get the proper two-hop.
 */
export async function getSpansByConversationId(
  opts: GetSpansByConversationIdOpts,
): Promise<GetSpansByConversationIdResult> {
  const { baseUrl, token, businessDomain, conversationId } = opts;
  const maxTraceIds = opts.maxTraceIds ?? 100;
  const maxSpans = opts.maxSpans ?? 2000;

  const aggResult = await postSearch(baseUrl, token, businessDomain, {
    size: 0,
    query: { term: { "attributes.gen_ai.conversation.id.keyword": conversationId } },
    aggs: { tids: { terms: { field: "traceId.keyword", size: maxTraceIds } } },
  });

  const aggregations = aggResult.aggregations as Record<string, unknown> | undefined;
  if (!aggregations) {
    const directHits = (aggResult.hits as { hits?: Array<{ _source?: Record<string, unknown> }> } | undefined)?.hits;
    if (Array.isArray(directHits)) {
      const spans: RawSpan[] = [];
      const traceIds = new Set<string>();
      for (const h of directHits) {
        if (!h._source) continue;
        const span = normalizeToRawSpan(h._source);
        if (!span) continue;
        spans.push(span);
        if (span.traceId) traceIds.add(span.traceId);
      }
      return { traceIds: [...traceIds], spans, truncated: false };
    }
  }

  const tids = aggregations?.tids as
    | { buckets?: Array<{ key: string }>; sum_other_doc_count?: number }
    | undefined;
  const buckets = tids?.buckets ?? [];
  const truncated = (tids?.sum_other_doc_count ?? 0) > 0;
  const traceIds = buckets
    .map((b) => b.key)
    .filter((k): k is string => typeof k === "string" && k.length > 0);

  if (traceIds.length === 0) {
    return { traceIds: [], spans: [], truncated: false };
  }

  const spansResult = await postSearch(baseUrl, token, businessDomain, {
    size: maxSpans,
    query: { terms: { "traceId.keyword": traceIds } },
    sort: [{ startTime: "asc" }],
  });

  const hits = (spansResult.hits as { hits?: Array<{ _source?: Record<string, unknown> }> } | undefined)?.hits ?? [];
  const spans: RawSpan[] = [];
  for (const h of hits) {
    if (!h._source) continue;
    const span = normalizeToRawSpan(h._source);
    if (span) spans.push(span);
  }

  return { traceIds, spans, truncated };
}
