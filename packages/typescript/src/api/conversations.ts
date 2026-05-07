import { buildHeaders } from "./headers.js";

export interface ListConversationsOptions {
  baseUrl: string;
  accessToken: string;
  agentKey: string;
  businessDomain?: string;
  page?: number;
  size?: number;
}

export interface ListMessagesOptions {
  baseUrl: string;
  accessToken: string;
  agentKey: string;
  conversationId: string;
  businessDomain?: string;
}

export interface GetTracesOptions {
  baseUrl: string;
  accessToken: string;
  conversationId: string;
  /** Deprecated. trace-ai keys spans by conversation_id only; kept for CLI compatibility. */
  agentId?: string;
  businessDomain?: string;
  /** Max distinct traceIds to fetch for one conversation. Default 100. */
  maxTraceIds?: number;
  /** Max spans returned by the second hop. Default 2000. */
  maxSpans?: number;
}

export interface TraceSpan {
  traceId: string;
  spanId: string;
  parentSpanId?: string;
  name: string;
  kind?: string;
  startTime: string;
  endTime?: string;
  durationInNanos?: number;
  status?: { code?: string | number; message?: string };
  serviceName?: string;
  attributes?: Record<string, unknown>;
  events?: Array<{ name?: string; time?: string; attributes?: Record<string, unknown> }>;
  /** Raw _source object from the trace store, kept verbatim for formatters that need extra fields. */
  raw?: Record<string, unknown>;
}

export interface TracesByConversationResult {
  conversationId: string;
  traceIds: string[];
  spans: TraceSpan[];
  /** True if the traceId aggregation hit its bucket cap and may be incomplete. */
  truncated: boolean;
}

function buildConversationsUrl(baseUrl: string, agentKey: string): string {
  const base = baseUrl.replace(/\/+$/, "");
  return `${base}/api/agent-factory/v1/app/${agentKey}/conversation`;
}

function buildMessagesUrl(baseUrl: string, agentKey: string, conversationId: string): string {
  const base = baseUrl.replace(/\/+$/, "");
  return `${base}/api/agent-factory/v1/app/${agentKey}/conversation/${conversationId}`;
}

/**
 * List conversations for an agent.
 * Returns empty array on 404 (endpoint may not be available in all deployments).
 */
export async function listConversations(opts: ListConversationsOptions): Promise<string> {
  const { baseUrl, accessToken, agentKey, businessDomain = "bd_public", page = 1, size = 10 } = opts;
  const url = new URL(buildConversationsUrl(baseUrl, agentKey));
  url.searchParams.set("page", String(page));
  url.searchParams.set("size", String(size));

  const response = await fetch(url.toString(), {
    method: "GET",
    headers: {
      accept: "application/json",
      ...buildHeaders(accessToken, businessDomain),
    },
  });

  const body = await response.text();
  if (!response.ok) {
    throw new Error(`listConversations failed: HTTP ${response.status} ${response.statusText} — ${body.slice(0, 200)}`);
  }

  return body || "[]";
}

function buildTraceSearchUrl(baseUrl: string): string {
  const base = baseUrl.replace(/\/+$/, "");
  return `${base}/api/agent-observability/v1/traces/_search`;
}

async function postTraceSearch(
  baseUrl: string,
  accessToken: string,
  businessDomain: string,
  body: unknown,
): Promise<Record<string, unknown>> {
  const response = await fetch(buildTraceSearchUrl(baseUrl), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...buildHeaders(accessToken, businessDomain),
    },
    body: JSON.stringify(body),
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(
      `getTracesByConversation failed: HTTP ${response.status} ${response.statusText} — ${text.slice(0, 200)}`,
    );
  }
  if (!text) return {};
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch (err) {
    throw new Error(`getTracesByConversation: invalid JSON response — ${(err as Error).message}`);
  }
}

function computeDurationNanos(source: Record<string, unknown>): number | undefined {
  if (typeof source.durationInNanos === "number") return source.durationInNanos;
  if (typeof source.duration === "number") return source.duration;
  const startTime = source.startTime ?? source.start_time;
  const endTime = source.endTime ?? source.end_time;
  if (typeof startTime !== "string" || typeof endTime !== "string") return undefined;
  const startMs = Date.parse(startTime);
  const endMs = Date.parse(endTime);
  if (Number.isNaN(startMs) || Number.isNaN(endMs)) return undefined;
  return Math.max(0, (endMs - startMs) * 1e6);
}

function extractServiceName(source: Record<string, unknown>): string | undefined {
  if (typeof source.serviceName === "string") return source.serviceName;
  if (typeof source.service_name === "string") return source.service_name;
  const attributes = source.attributes as Record<string, unknown> | undefined;
  if (typeof attributes?.["service.name"] === "string") return attributes["service.name"] as string;
  const resource = source.resource as Record<string, unknown> | undefined;
  if (typeof resource?.["service.name"] === "string") return resource["service.name"] as string;
  const resourceService = (resource?.service as Record<string, unknown> | undefined)?.name;
  if (typeof resourceService === "string") return resourceService;
  return undefined;
}

function normalizeSpan(source: Record<string, unknown>): TraceSpan | null {
  const traceId = String(source.traceId ?? source.trace_id ?? "");
  const spanId = String(source.spanId ?? source.span_id ?? "");
  if (!traceId || !spanId) return null;
  const parentRaw = source.parentSpanId ?? source.parent_span_id ?? source.parentSpanID;
  const parentSpanId = parentRaw ? String(parentRaw) : undefined;
  const status = source.status as TraceSpan["status"] | undefined;
  const attributes = (source.attributes as Record<string, unknown> | undefined) ?? undefined;
  const events = source.events as TraceSpan["events"] | undefined;
  return {
    traceId,
    spanId,
    parentSpanId: parentSpanId && parentSpanId !== "" && parentSpanId !== "0" ? parentSpanId : undefined,
    name: String(source.name ?? ""),
    kind: source.kind as string | undefined,
    startTime: String(source.startTime ?? source.start_time ?? ""),
    endTime: source.endTime ? String(source.endTime) : undefined,
    durationInNanos: computeDurationNanos(source),
    status,
    serviceName: extractServiceName(source),
    attributes,
    events,
    raw: source,
  };
}

/**
 * Fetch all spans belonging to a conversation via trace-ai's OpenSearch-style _search.
 *
 * Two-hop strategy (see kweaver-sdk#115):
 *   1. Aggregate traceIds for spans tagged with gen_ai.conversation.id == conversationId.
 *   2. Fetch every span sharing those traceIds — this recovers pipeline spans
 *      (HTTP entry, internal RPCs, prompt-build) that are not tagged with conversation_id.
 *
 * Returns a structured result; callers can format as tree/perf/evidence views or stringify.
 */
export async function getTracesByConversation(opts: GetTracesOptions): Promise<TracesByConversationResult> {
  const {
    baseUrl,
    accessToken,
    conversationId,
    businessDomain = "bd_public",
    maxTraceIds = 100,
    maxSpans = 2000,
  } = opts;

  const aggResult = await postTraceSearch(baseUrl, accessToken, businessDomain, {
    size: 0,
    query: { term: { "attributes.gen_ai.conversation.id.keyword": conversationId } },
    aggs: { tids: { terms: { field: "traceId.keyword", size: maxTraceIds } } },
  });

  const aggregations = aggResult.aggregations as Record<string, unknown> | undefined;
  const tids = aggregations?.tids as { buckets?: Array<{ key: string }>; sum_other_doc_count?: number } | undefined;
  const buckets = tids?.buckets ?? [];
  const truncated = (tids?.sum_other_doc_count ?? 0) > 0;
  const traceIds = buckets.map((b) => b.key).filter((k): k is string => typeof k === "string" && k.length > 0);

  if (traceIds.length === 0) {
    return { conversationId, traceIds: [], spans: [], truncated: false };
  }

  const spansResult = await postTraceSearch(baseUrl, accessToken, businessDomain, {
    size: maxSpans,
    query: { terms: { "traceId.keyword": traceIds } },
    sort: [{ startTime: "asc" }],
  });

  const hits = (spansResult.hits as { hits?: Array<{ _source?: Record<string, unknown> }> } | undefined)?.hits ?? [];
  const spans: TraceSpan[] = [];
  for (const hit of hits) {
    if (!hit._source) continue;
    const span = normalizeSpan(hit._source);
    if (span) spans.push(span);
  }

  return { conversationId, traceIds, spans, truncated };
}

/**
 * List messages for a conversation.
 * Returns empty array on 404 (endpoint may not be available in all deployments).
 */
export async function listMessages(opts: ListMessagesOptions): Promise<string> {
  const { baseUrl, accessToken, agentKey, conversationId, businessDomain = "bd_public" } = opts;
  const url = buildMessagesUrl(baseUrl, agentKey, conversationId);

  const response = await fetch(url, {
    method: "GET",
    headers: {
      accept: "application/json",
      ...buildHeaders(accessToken, businessDomain),
    },
  });

  const body = await response.text();
  if (!response.ok) {
    throw new Error(`listMessages failed: HTTP ${response.status} ${response.statusText} — ${body.slice(0, 200)}`);
  }

  return body || "{}";
}
