import { fetchTextOrThrow, fetchWithRetry, HttpError } from "../utils/http.js";
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
  /** Completed text segments from earlier steps (preserved when answer.text is cleared). */
  completedSegments: string[];
  /** The raw text from extractText in the previous tick — used to detect clears. */
  prevRawText: string;
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

/** Format answer_type_other which may be an array of strings or an object. */
function stringFromAnswerTypeOther(other: unknown): string {
  if (Array.isArray(other)) {
    const strings = other.filter((s) => typeof s === "string" && s);
    if (strings.length > 0) return JSON.stringify(strings);
    return "";
  }
  if (other && typeof other === "object") {
    return stringFromAnswerObject(other as Record<string, unknown>);
  }
  return "";
}

export function extractText(data: unknown): string {
  if (!data || typeof data !== "object") return "";

  const obj = data as Record<string, unknown>;

  const fa = obj.final_answer as Record<string, unknown> | undefined;
  if (fa?.answer && typeof fa.answer === "object") {
    const ans = fa.answer as Record<string, unknown>;
    if (typeof ans.text === "string" && ans.text) return ans.text;
  }
  if (typeof fa?.text === "string" && fa.text) {
    return fa.text;
  }
  // Check answer_type_other at final_answer level (for content_type "other")
  if (fa?.answer_type_other) {
    const desc = stringFromAnswerTypeOther(fa.answer_type_other);
    if (desc) return desc;
  }

  const msg = obj.message as Record<string, unknown> | undefined;
  if (typeof msg?.text === "string" && msg.text) {
    return msg.text;
  }
  if (msg?.content && typeof msg.content === "object") {
    const content = msg.content as Record<string, unknown>;
    if (typeof content.text === "string" && content.text) return content.text;
    const contentFinalAnswer = content.final_answer as Record<string, unknown> | undefined;
    if (contentFinalAnswer?.answer && typeof contentFinalAnswer.answer === "object") {
      const answer = contentFinalAnswer.answer as Record<string, unknown>;
      if (typeof answer.text === "string" && answer.text) return answer.text;
    }
    if (typeof contentFinalAnswer?.text === "string" && contentFinalAnswer.text) {
      return contentFinalAnswer.text;
    }
    // Check answer_type_other at content.final_answer level
    if (contentFinalAnswer?.answer_type_other) {
      const desc = stringFromAnswerTypeOther(contentFinalAnswer.answer_type_other);
      if (desc) return desc;
    }
  }

  const answer = obj.answer as Record<string, unknown> | undefined;
  if (typeof answer?.text === "string" && answer.text) {
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
  onTextDelta?: (fullText: string, currentSegmentText: string) => void,
  onProgress?: (progress: ProgressItem[]) => void,
  onSegmentComplete?: (segmentText: string, segmentIndex: number) => void,
  onStepMeta?: (meta: Record<string, unknown>) => void,
  onConversationId?: (conversationId: string) => void,
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
      if (state.conversationId && onConversationId) {
        onConversationId(state.conversationId);
      }
    }

    // Detect answer_type_other changes (step metadata: status, end_time, etc.)
    if (data.key && data.key.join(".").includes("answer_type_other") && data.action === "upsert") {
      const ato = getByPath(state.result, ["message", "content", "final_answer", "answer_type_other"]);
      console.error(`[STEP_META] ${JSON.stringify(ato).slice(0, 500)}`);
      if (ato && typeof ato === "object" && onStepMeta) {
        onStepMeta(ato as Record<string, unknown>);
      }
    }

    const progress = getProgressFromResult(state.result);
    if (progress.length > 0 && onProgress) {
      onProgress(progress);
    }

    const rawText = normalizeDisplayText(extractText(state.result));

    // Detect when the upstream clears text between steps: previous had content, now empty or
    // significantly shorter (new segment starting). Save the completed segment.
    if (state.prevRawText && (!rawText || rawText.length < state.prevRawText.length * 0.5)) {
      state.completedSegments.push(state.prevRawText);
      if (onSegmentComplete) {
        onSegmentComplete(state.prevRawText, state.completedSegments.length - 1);
      }
    }
    state.prevRawText = rawText;

    // Build full text: completed segments + current segment
    const fullText = state.completedSegments.length > 0
      ? state.completedSegments.join("\n\n") + (rawText ? "\n\n" + rawText : "")
      : rawText;

    if (fullText && fullText !== state.lastText) {
      if (onTextDelta) {
        onTextDelta(fullText, rawText);
      } else {
        const delta = fullText.slice(state.lastText.length);
        process.stdout.write(delta);
      }
      state.lastText = fullText;
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
    response = await fetchWithRetry(url, {
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
  onTextDelta: (fullText: string, currentSegmentText: string) => void;
  /** Optional: called when message.content.middle_answer.progress updates (tool/skill steps). */
  onProgress?: (progress: ProgressItem[]) => void;
  /** Optional: called when a text segment is completed and a new phase starts. */
  onSegmentComplete?: (segmentText: string, segmentIndex: number) => void;
  /** Optional: called when answer_type_other changes (step metadata like status, tool info). */
  onStepMeta?: (meta: Record<string, unknown>) => void;
  /** Optional: called as soon as conversationId is discovered in the stream. */
  onConversationId?: (conversationId: string) => void;
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
    response = await fetchWithRetry(url, {
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
    return handleStreamResponse(response, verbose, callbacks.onTextDelta, callbacks.onProgress, callbacks.onSegmentComplete, callbacks.onStepMeta, callbacks.onConversationId);
  }

  const text = await response.text();
  const json = parseJsonResponse(text);
  const resultText = normalizeDisplayText(extractText(json));
  const convId = json.conversation_id as string | undefined;
  callbacks.onTextDelta(resultText, resultText);
  return { text: resultText, conversationId: convId, progress: getProgressFromResult(json) };
}

async function handleStreamResponse(
  response: Response,
  verbose?: boolean,
  onTextDelta?: (fullText: string, currentSegmentText: string) => void,
  onProgress?: (progress: ProgressItem[]) => void,
  onSegmentComplete?: (segmentText: string, segmentIndex: number) => void,
  onStepMeta?: (meta: Record<string, unknown>) => void,
  onConversationId?: (conversationId: string) => void,
): Promise<ChatResult> {
  const reader = response.body?.getReader();
  if (!reader) {
    throw new Error("No response body for stream");
  }

  const decoder = new TextDecoder();
  let buffer = "";
  let pendingEventType = "";
  const state: StreamAccumulator = {
    result: {},
    conversationId: undefined,
    lastText: "",
    completedSegments: [],
    prevRawText: "",
  };

  const applyLine = (line: string): void => {
    // Track SSE event type (e.g., "event:error")
    if (line.startsWith("event:")) {
      pendingEventType = line.slice(6).trim();
      return;
    }
    // If we have an error event type, handle the data line as an error
    if (pendingEventType === "error" && line.startsWith("data: ")) {
      pendingEventType = "";
      const errStr = line.slice(6).trim();
      // Emit as error text rather than processing as incremental update
      if (onTextDelta) {
        let errMsg = errStr;
        let errDetail = "";
        try {
          const errObj = JSON.parse(errStr) as Record<string, unknown>;
          errMsg = (errObj.description as string) || (errObj.details as string) || errStr;
          if (errObj.solution && errObj.solution !== "无") errMsg += "\n💡 " + (errObj.solution as string);
          // Collect all remaining fields as detail context
          const detailFields: Record<string, unknown> = {};
          for (const [k, v] of Object.entries(errObj)) {
            if (k !== "description" && k !== "solution" && v != null && v !== "") {
              detailFields[k] = v;
            }
          }
          if (Object.keys(detailFields).length > 0) {
            errDetail = "\n\n<details><summary>详细错误信息</summary>\n\n```json\n" + JSON.stringify(detailFields, null, 2) + "\n```\n</details>";
          }
        } catch { if (verbose) console.error("Failed to parse SSE error JSON:", errStr); }
        const errText = "⚠️ " + errMsg + errDetail;
        const fullText = state.completedSegments.length > 0
          ? state.completedSegments.join("\n\n") + "\n\n" + errText
          : errText;
        onTextDelta(fullText, errText);
        state.lastText = fullText;
      }
      return;
    }
    pendingEventType = "";
    applySseDataLine(line, state, verbose, onTextDelta, onProgress, onSegmentComplete, onStepMeta, onConversationId);
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

  // Fallback: try to extract conversationId from accumulated result if not found in stream
  if (!state.conversationId) {
    const r = state.result as Record<string, unknown>;
    const candidate =
      r.conversation_id ??
      (r.message as Record<string, unknown> | undefined)?.conversation_id ??
      r.conversationId;
    if (typeof candidate === "string" && candidate) {
      state.conversationId = candidate;
      if (onConversationId) onConversationId(candidate);
    }
  }

  const rawFinal = normalizeDisplayText(extractText(state.result));
  const finalText = state.completedSegments.length > 0
    ? state.completedSegments.join("\n\n") + (rawFinal ? "\n\n" + rawFinal : "")
    : rawFinal || state.lastText;
  return { text: finalText, conversationId: state.conversationId };
}
