import { buildHeaders } from "./headers.js";
import { fetchRawSpansByConversation } from "./agent-observability.js";

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
 * Fetch all spans belonging to a conversation, shaped as `TraceSpan[]` for UI
 * rendering (tree/perf/evidence/reasoning views). The wire-level two-hop and
 * auth/header concerns live in `./agent-observability`; this function only
 * normalizes the raw `_source` documents.
 */
export async function getTracesByConversation(opts: GetTracesOptions): Promise<TracesByConversationResult> {
  const {
    baseUrl,
    accessToken,
    conversationId,
    businessDomain = "bd_public",
    maxTraceIds,
    maxSpans,
  } = opts;

  const fetched = await fetchRawSpansByConversation({
    baseUrl,
    accessToken,
    businessDomain,
    conversationId,
    maxTraceIds,
    maxSpans,
  });

  const spans: TraceSpan[] = [];
  for (const src of fetched.rawSources) {
    const span = normalizeSpan(src);
    if (span) spans.push(span);
  }

  return { conversationId, traceIds: fetched.traceIds, spans, truncated: fetched.truncated };
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
