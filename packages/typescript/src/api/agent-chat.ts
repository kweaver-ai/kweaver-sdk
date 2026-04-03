import { fetchTextOrThrow, HttpError } from "../utils/http.js";
import { normalizeDisplayText } from "../utils/display-text.js";

export interface SendChatRequestOptions {
  baseUrl: string;
  accessToken: string;
  agentId: string;
  agentKey: string;
  agentVersion: string;
  query: string;
  conversationId?: string;
  stream: boolean;
  verbose?: boolean;
  businessDomain?: string;
}

export interface ChatResult {
  text: string;
  conversationId?: string;
  /** From message.content.middle_answer.progress when stream is false. */
  progress?: ProgressItem[];
}

/** One step from message.content.middle_answer.progress (tool/skill or LLM stage). */
export interface ProgressItem {
  agent_name?: string;
  skill_info?: {
    name?: string;
    type?: string;
    checked?: boolean;
    args?: Array<{
      name?: string;
      type?: string;
      value?: unknown;
    }>;
  };
  status?: string;
  answer?: string | Record<string, unknown>;
  description?: string;
  result?: string;
  stage?: string;
  input_message?: string;
}

export interface AgentInfo {
  id: string;
  key: string;
  version: string;
}

interface StreamAccumulator {
  result: Record<string, unknown>;
  conversationId?: string;
  lastText: string;
}

const CHAT_PATH = "/api/agent-factory/v1/app";
const AGENT_INFO_PATH = "/api/agent-factory/v3/agent-market/agent";

export function buildChatUrl(baseUrl: string, agentKey: string): string {
  const base = baseUrl.replace(/\/+$/, "");
  return `${base}${CHAT_PATH}/${agentKey}/chat/completion`;
}

export function buildAgentInfoUrl(baseUrl: string, agentId: string, version: string): string {
  const base = baseUrl.replace(/\/+$/, "");
  return `${base}${AGENT_INFO_PATH}/${agentId}/version/${version}?is_visit=true`;
}

export async function fetchAgentInfo(options: {
  baseUrl: string;
  accessToken: string;
  agentId: string;
  version: string;
  businessDomain?: string;
}): Promise<AgentInfo> {
  const { baseUrl, accessToken, agentId, version, businessDomain = "bd_public" } = options;
  const url = buildAgentInfoUrl(baseUrl, agentId, version);
  const { body } = await fetchTextOrThrow(url, {
    method: "GET",
    headers: {
      accept: "application/json, text/plain, */*",
      Authorization: `Bearer ${accessToken}`,
      token: accessToken,
      "x-business-domain": businessDomain,
      "x-language": "zh-CN",
      "x-requested-with": "XMLHttpRequest",
    },
  });

  const data = JSON.parse(body) as Partial<AgentInfo>;
  if (!data.id || !data.key) {
    throw new Error("Agent info response did not include id and key.");
  }

  return {
    id: data.id,
    key: data.key,
    version: typeof data.version === "string" ? data.version : version,
  };
}

function getByPath(obj: unknown, path: string[]): unknown {
  let current: unknown = obj;
  for (const key of path) {
    if (current === null || typeof current !== "object") return undefined;
    current = (current as Record<string, unknown>)[key];
  }
  return current;
}

function setByPath(obj: Record<string, unknown>, path: string[], value: unknown): void {
  let current: Record<string, unknown> = obj;
  for (let i = 0; i < path.length - 1; i += 1) {
    const key = path[i];
    const next = path[i + 1];
    if (!(key in current) || typeof current[key] !== "object") {
      current[key] = typeof next === "number" ? [] : {};
    }
    current = current[key] as Record<string, unknown>;
  }
  current[path[path.length - 1]] = value;
}

function stringFromAnswerObject(obj: Record<string, unknown>): string {
  const answer = obj.answer as Record<string, unknown> | undefined;
  const block = obj.block_answer as Record<string, unknown> | undefined;
  const src = answer ?? block;
  if (!src || typeof src !== "object") return "";
  const d = typeof src.description === "string" ? src.description : "";
  const c = typeof src.code === "string" ? src.code : "";
  const s = typeof src.solution === "string" ? src.solution : "";
  const parts = [d, c ? `code: ${c}` : "", s ? `solution: ${s}` : ""].filter(Boolean);
  return parts.join("\n");
}

export function extractText(data: unknown): string {
  if (!data || typeof data !== "object") return "";

  const obj = data as Record<string, unknown>;

  const fa = obj.final_answer as Record<string, unknown> | undefined;
  if (fa?.answer && typeof fa.answer === "object") {
    const ans = fa.answer as Record<string, unknown>;
    if (typeof ans.text === "string") return ans.text;
  }
  if (typeof fa?.text === "string") {
    return fa.text;
  }

  const msg = obj.message as Record<string, unknown> | undefined;
  if (typeof msg?.text === "string") {
    return msg.text;
  }
  if (msg?.content && typeof msg.content === "object") {
    const content = msg.content as Record<string, unknown>;
    if (typeof content.text === "string") return content.text;
    const contentFinalAnswer = content.final_answer as Record<string, unknown> | undefined;
    if (contentFinalAnswer?.answer && typeof contentFinalAnswer.answer === "object") {
      const answer = contentFinalAnswer.answer as Record<string, unknown>;
      if (typeof answer.text === "string") return answer.text;
    }
    if (typeof contentFinalAnswer?.text === "string") {
      return contentFinalAnswer.text;
    }
    const other = contentFinalAnswer?.answer_type_other as Record<string, unknown> | undefined;
    if (other && typeof other === "object") {
      const desc = stringFromAnswerObject(other);
      if (desc) return desc;
    }
  }
  const topOther = fa?.answer_type_other as Record<string, unknown> | undefined;
  if (topOther && typeof topOther === "object") {
    const desc = stringFromAnswerObject(topOther);
    if (desc) return desc;
  }

  const answer = obj.answer as Record<string, unknown> | undefined;
  if (typeof answer?.text === "string") {
    return answer.text;
  }

  return "";
}

export function processIncrementalUpdate(
  data: { key?: string[]; content?: unknown; action?: string },
  result: Record<string, unknown>
): void {
  const path = data.key;
  const content = data.content;
  const action = data.action;

  if (!path || path.length === 0) return;

  if (action === "upsert" && content !== undefined) {
    setByPath(result, path, content);
  } else if (action === "append") {
    const existing = getByPath(result, path);
    const newVal =
      typeof existing === "string"
        ? existing + (typeof content === "string" ? content : String(content ?? ""))
        : String(content ?? "");
    setByPath(result, path, newVal);
  } else if (action === "remove") {
    if (path.length === 1) {
      delete result[path[0]];
    }
  }
}

function parseJsonResponse(text: string): Record<string, unknown> {
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    throw new Error("Agent chat returned invalid JSON.");
  }
}

function getProgressFromResult(result: Record<string, unknown>): ProgressItem[] {
  const raw = getByPath(result, ["message", "content", "middle_answer", "progress"]);
  if (!Array.isArray(raw) || raw.length === 0) return [];
  return raw.filter((item) => item != null && typeof item === "object").map((item): ProgressItem => {
    if (!item || typeof item !== "object") return {};
    const o = item as Record<string, unknown>;
    const answer = o.answer;
    return {
      agent_name: typeof o.agent_name === "string" ? o.agent_name : undefined,
      skill_info:
        o.skill_info && typeof o.skill_info === "object"
          ? {
              name:
                typeof (o.skill_info as Record<string, unknown>).name === "string"
                  ? normalizeDisplayText((o.skill_info as Record<string, unknown>).name as string)
                  : undefined,
              type:
                typeof (o.skill_info as Record<string, unknown>).type === "string"
                  ? (o.skill_info as Record<string, unknown>).type as string
                  : undefined,
              checked:
                typeof (o.skill_info as Record<string, unknown>).checked === "boolean"
                  ? (o.skill_info as Record<string, unknown>).checked as boolean
                  : undefined,
              args: Array.isArray((o.skill_info as Record<string, unknown>).args)
                ? ((o.skill_info as Record<string, unknown>).args as Array<Record<string, unknown>>)
                    .filter((arg) => arg && typeof arg === "object")
                    .map((arg) => ({
                      name: typeof arg.name === "string" ? normalizeDisplayText(arg.name) : undefined,
                      type: typeof arg.type === "string" ? arg.type : undefined,
                      value:
                        typeof arg.value === "string"
                          ? normalizeDisplayText(arg.value)
                          : arg.value,
                    }))
                : undefined,
            }
          : undefined,
      status: typeof o.status === "string" ? normalizeDisplayText(o.status) : undefined,
      answer:
        typeof answer === "string"
          ? normalizeDisplayText(answer)
          : answer && typeof answer === "object" && answer !== null
            ? (answer as Record<string, unknown>)
            : undefined,
      description: typeof o.description === "string" ? normalizeDisplayText(o.description) : undefined,
      result: typeof o.result === "string" ? normalizeDisplayText(o.result) : undefined,
      stage: typeof o.stage === "string" ? normalizeDisplayText(o.stage) : undefined,
      input_message:
        typeof o.input_message === "string" ? normalizeDisplayText(o.input_message) : undefined,
    };
  });
}

function applySseDataLine(
  line: string,
  state: StreamAccumulator,
  verbose?: boolean,
  onTextDelta?: (fullText: string) => void,
  onProgress?: (progress: ProgressItem[]) => void
): void {
  if (!line.startsWith("data: ")) {
    return;
  }

  const dataStr = line.slice(6).trim();
  if (dataStr === "" || dataStr === "[DONE]") {
    return;
  }

  try {
    const data = JSON.parse(dataStr) as {
      key?: string[];
      content?: unknown;
      action?: string;
    };

    processIncrementalUpdate(data, state.result);

    if (data.key?.length === 1 && data.key[0] === "conversation_id" && data.action === "upsert") {
      state.conversationId =
        typeof data.content === "string" ? data.content : String(data.content ?? "");
    }

    const progress = getProgressFromResult(state.result);
    if (progress.length > 0 && onProgress) {
      onProgress(progress);
    }

    const text = normalizeDisplayText(extractText(state.result));
    if (text && text !== state.lastText) {
      if (onTextDelta) {
        onTextDelta(text);
      } else {
        const delta = text.slice(state.lastText.length);
        process.stdout.write(delta);
      }
      state.lastText = text;
    }
  } catch {
    if (verbose) {
      console.error(`SSE parse skip: ${dataStr}`);
    }
  }
}

export async function sendChatRequest(options: SendChatRequestOptions): Promise<ChatResult> {
  const {
    baseUrl,
    accessToken,
    agentId,
    agentKey,
    agentVersion,
    query,
    conversationId,
    stream,
    verbose,
    businessDomain = "bd_public",
  } = options;

  const url = buildChatUrl(baseUrl, agentKey);
  const body: Record<string, unknown> = {
    agent_id: agentId,
    agent_key: agentKey,
    agent_version: agentVersion,
    query,
    stream,
  };
  if (conversationId) {
    body.conversation_id = conversationId;
  }

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    accept: stream ? "text/event-stream" : "application/json",
    Authorization: `Bearer ${accessToken}`,
    "Accept-Language": "zh-CN",
    "x-Language": "zh-CN",
    "x-business-domain": businessDomain,
  };

  if (verbose) {
    console.error(`POST ${url}`);
    const safeHeaders = Object.fromEntries(
      Object.entries(headers).map(([k, v]) =>
        k.toLowerCase() === "authorization" ? [k, "Bearer ***"] : [k, v]
      )
    );
    console.error(`Headers: ${JSON.stringify(safeHeaders)}`);
    console.error(`Body: ${JSON.stringify(body)}`);
  }

  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Agent chat request failed: ${message}`);
  }

  const contentType = response.headers.get("content-type") ?? "";

  if (!response.ok) {
    const text = await response.text();
    throw new HttpError(response.status, response.statusText, text);
  }

  if (stream && contentType.includes("text/event-stream")) {
    return handleStreamResponse(response, verbose);
  }

  const text = await response.text();
  const json = parseJsonResponse(text);
  const resultText = normalizeDisplayText(extractText(json));
  const convId = json.conversation_id as string | undefined;
  const progress = getProgressFromResult(json as Record<string, unknown>);

  return { text: resultText, conversationId: convId, progress };
}

export interface SendChatRequestStreamCallbacks {
  onTextDelta: (fullText: string) => void;
  /** Optional: called when message.content.middle_answer.progress updates (tool/skill steps). */
  onProgress?: (progress: ProgressItem[]) => void;
}

/**
 * Stream-only entry point for TUI: same as sendChatRequest with stream=true,
 * but invokes onTextDelta(fullText) for each incremental text update instead of writing to stdout.
 */
export async function sendChatRequestStream(
  options: SendChatRequestOptions,
  callbacks: SendChatRequestStreamCallbacks
): Promise<ChatResult> {
  const opts = { ...options, stream: true };
  const {
    baseUrl,
    accessToken,
    agentId,
    agentKey,
    agentVersion,
    query,
    conversationId,
    verbose,
    businessDomain = "bd_public",
  } = opts;

  const url = buildChatUrl(baseUrl, agentKey);
  const body: Record<string, unknown> = {
    agent_id: agentId,
    agent_key: agentKey,
    agent_version: agentVersion,
    query,
    stream: true,
  };
  if (conversationId) {
    body.conversation_id = conversationId;
  }

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    accept: "text/event-stream",
    Authorization: `Bearer ${accessToken}`,
    "Accept-Language": "zh-CN",
    "x-Language": "zh-CN",
    "x-business-domain": businessDomain,
  };

  if (verbose) {
    console.error(`POST ${url}`);
    const safeHeaders = Object.fromEntries(
      Object.entries(headers).map(([k, v]) =>
        k.toLowerCase() === "authorization" ? [k, "Bearer ***"] : [k, v]
      )
    );
    console.error(`Headers: ${JSON.stringify(safeHeaders)}`);
    console.error(`Body: ${JSON.stringify(body)}`);
  }

  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Agent chat request failed: ${message}`);
  }

  const contentType = response.headers.get("content-type") ?? "";

  if (!response.ok) {
    const text = await response.text();
    throw new HttpError(response.status, response.statusText, text);
  }

  if (contentType.includes("text/event-stream")) {
    return handleStreamResponse(response, verbose, callbacks.onTextDelta, callbacks.onProgress);
  }

  const text = await response.text();
  const json = parseJsonResponse(text);
  const resultText = normalizeDisplayText(extractText(json));
  const convId = json.conversation_id as string | undefined;
  callbacks.onTextDelta(resultText);
  return { text: resultText, conversationId: convId, progress: getProgressFromResult(json) };
}

async function handleStreamResponse(
  response: Response,
  verbose?: boolean,
  onTextDelta?: (fullText: string) => void,
  onProgress?: (progress: ProgressItem[]) => void
): Promise<ChatResult> {
  const reader = response.body?.getReader();
  if (!reader) {
    throw new Error("No response body for stream");
  }

  const decoder = new TextDecoder();
  let buffer = "";
  const state: StreamAccumulator = {
    result: {},
    conversationId: undefined,
    lastText: "",
  };

  const applyLine = (line: string): void => {
    applySseDataLine(line, state, verbose, onTextDelta, onProgress);
  };

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";

    for (const line of lines) {
      applyLine(line.trimEnd());
    }
  }

  if (buffer.trim()) {
    applyLine(buffer.trimEnd());
  }

  if (!onTextDelta && state.lastText && !state.lastText.endsWith("\n")) {
    process.stdout.write("\n");
  }

  const finalText = normalizeDisplayText(extractText(state.result) || state.lastText);
  return { text: finalText, conversationId: state.conversationId };
}
