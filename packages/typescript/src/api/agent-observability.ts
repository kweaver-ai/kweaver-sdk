/**
 * Single source of truth for `/api/agent-observability/v1/traces/_search` —
 * the OpenSearch-style endpoint that backs both `kweaver agent trace` and
 * `kweaver trace diagnose`.
 *
 * Owns: endpoint URL, auth/headers (via `./headers.ts`), the two-hop strategy
 * (conversation_id → traceIds → spans), and HTTP error handling.
 *
 * Does NOT own normalization: callers receive raw OpenSearch `_source` objects
 * and shape them as needed (TraceSpan for UI rendering, RawSpan for diagnose
 * rules). This keeps the wire contract in one place while letting each consumer
 * pick its own minimal field set.
 */

import { buildHeaders } from "./headers.js";

export const TRACE_SEARCH_PATH = "/api/agent-observability/v1/traces/_search";

export class TraceFetchError extends Error {
  constructor(message: string, public readonly status?: number, public readonly url?: string) {
    super(message);
    this.name = "TraceFetchError";
  }
}

export interface FetchRawSpansByConversationOpts {
  baseUrl: string;
  accessToken: string;
  businessDomain: string;
  conversationId: string;
  /** Cap on `terms` aggregation bucket count. Default 100. */
  maxTraceIds?: number;
  /** Cap on spans returned by the second query. Default 2000. */
  maxSpans?: number;
}

export interface FetchRawSpansByConversationResult {
  /** Distinct traceIds observed for this conversation, in agg-bucket order. */
  traceIds: string[];
  /** Raw `_source` objects, unmodified. Callers do their own normalization. */
  rawSources: Array<Record<string, unknown>>;
  /** True if the agg saw `sum_other_doc_count > 0` (more traceIds than maxTraceIds). */
  truncated: boolean;
}

export async function postTraceSearch(
  baseUrl: string,
  accessToken: string,
  businessDomain: string,
  body: unknown,
): Promise<Record<string, unknown>> {
  const url = `${baseUrl.replace(/\/+$/, "")}${TRACE_SEARCH_PATH}`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...buildHeaders(accessToken, businessDomain),
    },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) {
    throw new TraceFetchError(
      `trace search failed: HTTP ${res.status} ${res.statusText} — ${text.slice(0, 200)}`,
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
 * Two-hop fetch of all `_source` documents belonging to a conversation.
 *
 * Hop 1: aggregate `traceId.keyword` for spans tagged with
 *        `attributes.gen_ai.conversation.id.keyword == conversationId`.
 * Hop 2: fetch every span whose `traceId.keyword` is in the agg buckets.
 *
 * Fixture-compat fast path: when the first response carries no `aggregations`
 * but does carry `hits.hits`, that is taken as a flat spans payload and hop 2
 * is skipped. Existing e2e fixtures (single OpenSearch payload per file) thus
 * remain usable with a single mock-fetch response.
 */
export async function fetchRawSpansByConversation(
  opts: FetchRawSpansByConversationOpts,
): Promise<FetchRawSpansByConversationResult> {
  const { baseUrl, accessToken, businessDomain, conversationId } = opts;
  const maxTraceIds = opts.maxTraceIds ?? 100;
  const maxSpans = opts.maxSpans ?? 2000;

  const aggResult = await postTraceSearch(baseUrl, accessToken, businessDomain, {
    size: 0,
    query: { term: { "attributes.gen_ai.conversation.id.keyword": conversationId } },
    aggs: { tids: { terms: { field: "traceId.keyword", size: maxTraceIds } } },
  });

  const aggregations = aggResult.aggregations as Record<string, unknown> | undefined;
  if (!aggregations) {
    const directHits = (aggResult.hits as { hits?: Array<{ _source?: Record<string, unknown> }> } | undefined)?.hits;
    if (Array.isArray(directHits)) {
      const rawSources: Array<Record<string, unknown>> = [];
      const traceIds = new Set<string>();
      for (const h of directHits) {
        if (!h._source) continue;
        rawSources.push(h._source);
        const tid = h._source.traceId ?? h._source.trace_id;
        if (typeof tid === "string" && tid.length > 0) traceIds.add(tid);
      }
      return { traceIds: [...traceIds], rawSources, truncated: false };
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
    return { traceIds: [], rawSources: [], truncated: false };
  }

  const spansResult = await postTraceSearch(baseUrl, accessToken, businessDomain, {
    size: maxSpans,
    query: { terms: { "traceId.keyword": traceIds } },
    sort: [{ startTime: "asc" }],
  });

  const hits = (spansResult.hits as { hits?: Array<{ _source?: Record<string, unknown> }> } | undefined)?.hits ?? [];
  const rawSources: Array<Record<string, unknown>> = [];
  for (const h of hits) {
    if (h._source) rawSources.push(h._source);
  }

  return { traceIds, rawSources, truncated };
}
