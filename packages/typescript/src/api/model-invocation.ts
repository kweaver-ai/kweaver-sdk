import { buildHeaders } from "./headers.js";
import { HttpError } from "../utils/http.js";

export const MF_MODEL_API_PATH_PREFIX = "/api/mf-model-api/v1";

export interface MfApiBaseOptions {
  baseUrl: string;
  accessToken: string;
  businessDomain?: string;
  /**
   * Replace platform origin for mf-model-api (still appends `/api/mf-model-api/v1`).
   * Overrides `KWEAVER_MF_MODEL_API_URL` when set.
   */
  mfApiBaseUrl?: string;
}

function resolveApiOrigin(options: MfApiBaseOptions): string {
  const env = process.env.KWEAVER_MF_MODEL_API_URL;
  const raw =
    options.mfApiBaseUrl ?? (env && env.length > 0 ? env : undefined) ?? options.baseUrl;
  return raw.replace(/\/+$/, "");
}

function apiEndpoint(options: MfApiBaseOptions, relPath: string): string {
  const origin = resolveApiOrigin(options);
  const path = relPath.startsWith("/") ? relPath : `/${relPath}`;
  return `${origin}${MF_MODEL_API_PATH_PREFIX}${path}`;
}

export interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
}

export interface ModelChatCompletionsOptions extends MfApiBaseOptions {
  /** Platform LLM config id (snowflake); always sent as `model_id`. */
  modelId: string;
  /**
   * Registry **`model_name`** for the OpenAI-style **`model`** field in the request body.
   * When omitted, **`model`** defaults to **`modelId`** (historical CLI behaviour).
   * Some gateways resolve routing via display name and reject numeric-only **`model`**.
   */
  modelName?: string;
  messages: ChatMessage[];
  stream?: boolean;
  temperature?: number;
  maxTokens?: number;
  topP?: number;
  topK?: number;
  presencePenalty?: number;
  frequencyPenalty?: number;
  cache?: boolean;
  verbose?: boolean;
}

export interface ModelChatResult {
  text: string;
  raw?: unknown;
}

function buildChatBody(options: ModelChatCompletionsOptions): Record<string, unknown> {
  const {
    modelId,
    modelName,
    messages,
    stream = false,
    temperature,
    maxTokens,
    topP,
    topK,
    presencePenalty,
    frequencyPenalty,
    cache,
  } = options;
  const trimmedName = typeof modelName === "string" ? modelName.trim() : "";
  const modelField = trimmedName.length > 0 ? trimmedName : modelId;
  const body: Record<string, unknown> = {
    model: modelField,
    model_id: modelId,
    messages,
    stream,
  };
  if (temperature !== undefined) body.temperature = temperature;
  if (maxTokens !== undefined) body.max_tokens = maxTokens;
  if (topP !== undefined) body.top_p = topP;
  if (topK !== undefined) body.top_k = topK;
  if (presencePenalty !== undefined) body.presence_penalty = presencePenalty;
  if (frequencyPenalty !== undefined) body.frequency_penalty = frequencyPenalty;
  if (cache !== undefined) body.cache = cache;
  return body;
}

function extractOpenAiCompletionText(json: Record<string, unknown>): string {
  const choices = json.choices as Array<Record<string, unknown>> | undefined;
  const msg = choices?.[0]?.message as Record<string, unknown> | undefined;
  const content = msg?.content;
  if (typeof content === "string") return content;
  return "";
}

function extractOpenAiDeltaChunk(chunk: Record<string, unknown>): string {
  const choices = chunk.choices as Array<Record<string, unknown>> | undefined;
  if (!choices?.[0]) return "";
  const delta = choices[0].delta as Record<string, unknown> | undefined;
  const c = delta?.content;
  if (typeof c === "string") return c;
  return "";
}

/**
 * Consume an OpenAI-style SSE stream (`data: {...}` / `data: [DONE]`).
 */
export async function consumeOpenAiSseText(response: Response, verbose?: boolean): Promise<string> {
  const reader = response.body?.getReader();
  if (!reader) throw new Error("No response body for stream");

  const decoder = new TextDecoder();
  let buffer = "";
  let out = "";

  const processLine = (line: string): void => {
    const trimmed = line.trimEnd();
    if (!trimmed.startsWith("data:")) return;
    const payload = trimmed.slice(5).trim();
    if (payload === "[DONE]") return;
    try {
      const chunk = JSON.parse(payload) as Record<string, unknown>;
      out += extractOpenAiDeltaChunk(chunk);
    } catch (e) {
      if (verbose) {
        const msg = e instanceof Error ? e.message : String(e);
        console.error(`SSE parse skip: ${msg} payload=${payload.slice(0, 120)}`);
      }
    }
  };

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const ln of lines) {
      processLine(ln);
    }
  }
  if (buffer.trim()) processLine(buffer);
  return out;
}

export async function modelChatCompletions(
  options: ModelChatCompletionsOptions
): Promise<ModelChatResult> {
  const { accessToken, businessDomain = "bd_public", stream = false, verbose } = options;
  const url = apiEndpoint(options, "/chat/completions");
  const body = buildChatBody({ ...options, stream });

  const response = await fetch(url, {
    method: "POST",
    headers: {
      ...buildHeaders(accessToken, businessDomain),
      "content-type": "application/json",
      accept: stream ? "text/event-stream" : "application/json",
    },
    body: JSON.stringify(body),
  });

  const contentType = response.headers.get("content-type") ?? "";

  if (!response.ok) {
    const text = await response.text();
    throw new HttpError(response.status, response.statusText, text);
  }

  if (stream && contentType.includes("text/event-stream")) {
    const text = await consumeOpenAiSseText(response, verbose);
    return { text };
  }

  const text = await response.text();
  const json = JSON.parse(text) as Record<string, unknown>;
  return { text: extractOpenAiCompletionText(json), raw: json };
}

// ── Small model invocation (mf-model-api) ───────────────────────────────────

/** OpenAI-style **`model`** for small-model routes: registry name when set, else **`model_id`** (matches chat completions). */
function resolveSmallInvokeModelField(
  modelName: string | undefined,
  modelId: string | undefined,
): string | undefined {
  const trimmedName = typeof modelName === "string" ? modelName.trim() : "";
  if (trimmedName.length > 0) return trimmedName;
  const id = typeof modelId === "string" ? modelId.trim() : "";
  if (id.length > 0) return id;
  return undefined;
}

export interface ModelEmbeddingOptions extends MfApiBaseOptions {
  modelId?: string;
  modelName?: string;
  input: string[];
}

export async function modelEmbedding(options: ModelEmbeddingOptions): Promise<unknown> {
  const { accessToken, businessDomain = "bd_public", modelId, modelName, input } = options;
  const url = apiEndpoint(options, "/small-model/embedding");
  const body: Record<string, unknown> = { input };
  if (modelId) body.model_id = modelId;
  const modelField = resolveSmallInvokeModelField(modelName, modelId);
  if (modelField !== undefined) body.model = modelField;
  const response = await fetch(url, {
    method: "POST",
    headers: {
      ...buildHeaders(accessToken, businessDomain),
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });
  const text = await response.text();
  if (!response.ok) throw new HttpError(response.status, response.statusText, text);
  return text ? (JSON.parse(text) as unknown) : null;
}

export async function modelEmbeddings(options: ModelEmbeddingOptions): Promise<unknown> {
  const { accessToken, businessDomain = "bd_public", modelId, modelName, input } = options;
  const url = apiEndpoint(options, "/small-model/embeddings");
  const body: Record<string, unknown> = { input };
  if (modelId) body.model_id = modelId;
  const modelField = resolveSmallInvokeModelField(modelName, modelId);
  if (modelField !== undefined) body.model = modelField;
  const response = await fetch(url, {
    method: "POST",
    headers: {
      ...buildHeaders(accessToken, businessDomain),
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });
  const text = await response.text();
  if (!response.ok) throw new HttpError(response.status, response.statusText, text);
  return text ? (JSON.parse(text) as unknown) : null;
}

export interface ModelRerankOptions extends MfApiBaseOptions {
  modelId?: string;
  modelName?: string;
  query: string;
  documents: string[];
}

export async function modelRerank(options: ModelRerankOptions): Promise<unknown> {
  const { accessToken, businessDomain = "bd_public", modelId, modelName, query, documents } = options;
  const url = apiEndpoint(options, "/small-model/reranker");
  const body: Record<string, unknown> = { query, documents };
  if (modelId) body.model_id = modelId;
  const modelField = resolveSmallInvokeModelField(modelName, modelId);
  if (modelField !== undefined) body.model = modelField;
  const response = await fetch(url, {
    method: "POST",
    headers: {
      ...buildHeaders(accessToken, businessDomain),
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });
  const text = await response.text();
  if (!response.ok) throw new HttpError(response.status, response.statusText, text);
  return text ? (JSON.parse(text) as unknown) : null;
}
