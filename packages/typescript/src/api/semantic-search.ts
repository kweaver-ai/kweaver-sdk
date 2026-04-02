import { HttpError } from "../utils/http.js";
import { buildHeaders } from "./headers.js";

export interface SemanticSearchOptions {
  baseUrl: string;
  accessToken: string;
  knId: string;
  query: string;
  businessDomain?: string;
  mode?: string;
  rerankAction?: string;
  maxConcepts?: number;
  returnQueryUnderstanding?: boolean;
}

export async function semanticSearch(
  options: SemanticSearchOptions
): Promise<string> {
  const {
    baseUrl,
    accessToken,
    knId,
    query,
    businessDomain = "bd_public",
    mode = "keyword_vector_retrieval",
    rerankAction = "default",
    maxConcepts = 10,
    returnQueryUnderstanding = false,
  } = options;

  const base = baseUrl.replace(/\/+$/, "");
  const url = `${base}/api/agent-retrieval/v1/kn/semantic-search`;

  const response = await fetch(url, {
    method: "POST",
    headers: { ...buildHeaders(accessToken, businessDomain), "content-type": "application/json" },
    body: JSON.stringify({
      kn_id: knId,
      query,
      mode,
      rerank_action: rerankAction,
      max_concepts: maxConcepts,
      return_query_understanding: returnQueryUnderstanding,
    }),
  });

  const body = await response.text();
  if (!response.ok) {
    throw new HttpError(response.status, response.statusText, body);
  }
  return body;
}
