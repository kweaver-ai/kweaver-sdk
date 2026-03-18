import {
  objectTypeQuery,
  objectTypeProperties,
  subgraph,
  actionTypeQuery,
  actionTypeExecute,
  actionExecutionGet,
  actionLogsList,
  actionLogGet,
  actionLogCancel,
} from "../api/ontology-query.js";
import { fetchTextOrThrow } from "../utils/http.js";
import type { ClientContext } from "../client.js";

export interface SemanticSearchResult {
  concepts: Array<{
    concept_type: string;
    concept_id: string;
    concept_name: string;
    intent_score: number;
    match_score: number;
    rerank_score: number;
    concept_detail?: Record<string, unknown>;
    samples?: unknown[];
  }>;
  hits_total: number;
  query_understanding?: Record<string, unknown>;
}

/** BKN engine resource — instance queries, subgraph, action execution and logs. */
export class BknResource {
  constructor(private readonly ctx: ClientContext) {}

  /**
   * Semantic search over a BKN (Business Knowledge Network).
   *
   * @param bknId   BKN ID to search against.
   * @param query   Natural-language query string.
   * @param opts    Optional retrieval mode and max concepts.
   */
  async semanticSearch(
    bknId: string,
    query: string,
    opts: { mode?: string; maxConcepts?: number } = {}
  ): Promise<SemanticSearchResult> {
    const { baseUrl, accessToken, businessDomain } = this.ctx.base();
    const { mode = "keyword_vector_retrieval", maxConcepts = 10 } = opts;
    const url = `${baseUrl}/api/agent-retrieval/v1/kn/semantic-search`;
    const { body } = await fetchTextOrThrow(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${accessToken}`,
        token: accessToken,
        "x-business-domain": businessDomain,
      },
      body: JSON.stringify({
        kn_id: bknId,
        query,
        mode,
        rerank_action: "default",
        max_concepts: maxConcepts,
        return_query_understanding: false,
      }),
    });
    const data = JSON.parse(body) as Record<string, unknown>;
    return {
      concepts: (data.concepts as SemanticSearchResult["concepts"]) ?? [],
      hits_total: (data.hits_total as number) ?? 0,
      query_understanding: data.query_understanding as Record<string, unknown> | undefined,
    };
  }

  async queryInstances(knId: string, otId: string, body: Record<string, unknown>): Promise<unknown> {
    const raw = await objectTypeQuery({ ...this.ctx.base(), knId, otId, body: JSON.stringify(body) });
    return JSON.parse(raw) as unknown;
  }

  async queryProperties(knId: string, otId: string, body: Record<string, unknown>): Promise<unknown> {
    const raw = await objectTypeProperties({ ...this.ctx.base(), knId, otId, body: JSON.stringify(body) });
    return JSON.parse(raw) as unknown;
  }

  async querySubgraph(knId: string, body: Record<string, unknown>): Promise<unknown> {
    const raw = await subgraph({ ...this.ctx.base(), knId, body: JSON.stringify(body) });
    return JSON.parse(raw) as unknown;
  }

  async queryAction(knId: string, atId: string, body: Record<string, unknown>): Promise<unknown> {
    const raw = await actionTypeQuery({ ...this.ctx.base(), knId, atId, body: JSON.stringify(body) });
    return JSON.parse(raw) as unknown;
  }

  async executeAction(knId: string, atId: string, body: Record<string, unknown>): Promise<unknown> {
    const raw = await actionTypeExecute({ ...this.ctx.base(), knId, atId, body: JSON.stringify(body) });
    return JSON.parse(raw) as unknown;
  }

  async getExecution(knId: string, executionId: string): Promise<unknown> {
    const raw = await actionExecutionGet({ ...this.ctx.base(), knId, executionId });
    return JSON.parse(raw) as unknown;
  }

  async listActionLogs(
    knId: string,
    opts: { offset?: number; limit?: number; atId?: string; status?: string } = {}
  ): Promise<unknown[]> {
    const raw = await actionLogsList({ ...this.ctx.base(), knId, ...opts });
    const parsed = JSON.parse(raw) as unknown;
    const items =
      parsed && typeof parsed === "object" && "data" in parsed
        ? ((parsed as { data: { records?: unknown[] } }).data?.records ?? [])
        : Array.isArray(parsed)
          ? parsed
          : [];
    return items;
  }

  async getActionLog(knId: string, logId: string): Promise<unknown> {
    const raw = await actionLogGet({ ...this.ctx.base(), knId, logId });
    return JSON.parse(raw) as unknown;
  }

  async cancelActionLog(knId: string, logId: string): Promise<unknown> {
    const raw = await actionLogCancel({ ...this.ctx.base(), knId, logId });
    return JSON.parse(raw) as unknown;
  }

  /**
   * Search KN schema — finds matching object types, relation types, and action types.
   * Uses MCP protocol via the context-loader (public endpoint).
   */
  async knSearch(
    knId: string,
    query: string,
    opts: { onlySchema?: boolean } = {}
  ): Promise<{
    object_types?: unknown[];
    relation_types?: unknown[];
    action_types?: unknown[];
    nodes?: unknown[];
  }> {
    const { ContextLoaderResource } = await import("./context-loader.js");
    const { baseUrl } = this.ctx.base();
    const mcpUrl = `${baseUrl}/api/agent-retrieval/v1/mcp`;
    const cl = new ContextLoaderResource(this.ctx, mcpUrl, knId);
    const result = await cl.search({ query, only_schema: opts.onlySchema ?? false });
    return result as {
      object_types?: unknown[];
      relation_types?: unknown[];
      action_types?: unknown[];
      nodes?: unknown[];
    };
  }
}
