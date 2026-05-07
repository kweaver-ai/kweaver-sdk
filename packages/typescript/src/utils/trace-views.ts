import type { TraceSpan, TracesByConversationResult } from "../api/conversations.js";

export interface SpanNode {
  span: TraceSpan;
  children: SpanNode[];
}

/**
 * Build a parent-child forest from a flat span array.
 *
 * Spans whose parentSpanId is missing or points to a span that is not in the set
 * are treated as roots. Multiple traceIds in one conversation produce multiple roots.
 * Children are sorted by startTime ascending.
 */
export function buildSpanTree(spans: TraceSpan[]): SpanNode[] {
  const byId = new Map<string, SpanNode>();
  for (const span of spans) {
    byId.set(span.spanId, { span, children: [] });
  }
  const roots: SpanNode[] = [];
  for (const node of byId.values()) {
    const parentId = node.span.parentSpanId;
    const parent = parentId ? byId.get(parentId) : undefined;
    if (parent) {
      parent.children.push(node);
    } else {
      roots.push(node);
    }
  }
  const sortByStart = (a: SpanNode, b: SpanNode): number => {
    const ta = String(a.span.startTime);
    const tb = String(b.span.startTime);
    return ta < tb ? -1 : ta > tb ? 1 : 0;
  };
  const sortRecursive = (nodes: SpanNode[]): void => {
    nodes.sort(sortByStart);
    for (const n of nodes) sortRecursive(n.children);
  };
  sortRecursive(roots);
  return roots;
}

function durationMs(span: TraceSpan): number {
  if (typeof span.durationInNanos === "number") return span.durationInNanos / 1e6;
  return 0;
}

function formatMs(ms: number): string {
  if (ms >= 1000) return `${ms.toFixed(1)}ms`;
  if (ms >= 10) return `${ms.toFixed(1)}ms`;
  return `${ms.toFixed(2)}ms`;
}

function statusLabel(span: TraceSpan): string {
  const code = span.status?.code;
  if (code === undefined || code === null || code === "") return "Uns";
  const s = String(code).toUpperCase();
  if (s === "OK" || s === "1") return "Ok";
  if (s === "ERROR" || s === "2") return "Err";
  if (s === "UNSET" || s === "0") return "Uns";
  return s.slice(0, 3);
}

function attr(span: TraceSpan, ...keys: string[]): unknown {
  if (!span.attributes) return undefined;
  for (const key of keys) {
    const v = span.attributes[key];
    if (v !== undefined && v !== null) return v;
  }
  return undefined;
}

const TOOL_NAME_KEYS = ["gen_ai.tool.name", "tool.name"];
const TOOL_ARGS_KEYS = ["gen_ai.tool.call.arguments", "gen_ai.tool.arguments", "tool.arguments"];
const TOOL_RESULT_KEYS = ["gen_ai.tool.call.result", "gen_ai.tool.result", "tool.result", "tool.output"];
const LLM_MODEL_KEYS = ["gen_ai.request.model", "llm.model"];
const LLM_IN_TOK_KEYS = ["gen_ai.usage.input_tokens", "llm.usage.input_tokens"];
const LLM_OUT_TOK_KEYS = ["gen_ai.usage.output_tokens", "llm.usage.output_tokens"];
const LLM_FINISH_KEYS = ["gen_ai.response.finish_reasons", "llm.response.finish_reason"];

function spanTooltip(span: TraceSpan): string {
  const parts: string[] = [];
  const toolName = attr(span, ...TOOL_NAME_KEYS);
  if (toolName) parts.push(`tool=${String(toolName)}`);
  const model = attr(span, ...LLM_MODEL_KEYS);
  if (model) parts.push(`model=${String(model)}`);
  const inTok = attr(span, ...LLM_IN_TOK_KEYS);
  if (inTok) parts.push(`in=${String(inTok)}`);
  const outTok = attr(span, ...LLM_OUT_TOK_KEYS);
  if (outTok) parts.push(`out=${String(outTok)}`);
  const args = attr(span, ...TOOL_ARGS_KEYS);
  if (typeof args === "string" && args.length > 0) {
    const truncated = args.length > 80 ? args.slice(0, 77) + "..." : args;
    parts.push(`args=${truncated}`);
  }
  return parts.length ? ` · ${parts.join(" · ")}` : "";
}

/**
 * Tree view: indented call topology with duration, status, service, and inline metadata.
 */
export function formatTreeView(spans: TraceSpan[]): string {
  if (spans.length === 0) return "(no spans)";
  const roots = buildSpanTree(spans);
  const lines: string[] = [];
  const walk = (node: SpanNode, prefix: string, isLast: boolean, isRoot: boolean): void => {
    const branch = isRoot ? "" : isLast ? "  └ " : "  ├ ";
    const dur = formatMs(durationMs(node.span));
    const status = statusLabel(node.span);
    const service = node.span.serviceName ? ` [${node.span.serviceName}]` : "";
    const padded = `${prefix}${branch}${node.span.name}`.padEnd(60, " ");
    lines.push(`${padded} ${dur.padStart(10, " ")} ${status.padEnd(3, " ")}${service}${spanTooltip(node.span)}`);
    const childPrefix = isRoot ? "" : prefix + (isLast ? "    " : "  │ ");
    for (let i = 0; i < node.children.length; i += 1) {
      walk(node.children[i], childPrefix, i === node.children.length - 1, false);
    }
  };
  for (const root of roots) walk(root, "", true, true);
  return lines.join("\n");
}

interface PerfBucket {
  total: number;
  count: number;
}

function classify(span: TraceSpan): string {
  const name = span.name.toLowerCase();
  if (name.startsWith("chat") || attr(span, ...LLM_MODEL_KEYS)) {
    return "LLM (chat)";
  }
  if (name.startsWith("execute_tool")) {
    const tool = attr(span, ...TOOL_NAME_KEYS);
    return `tool:${tool ? String(tool) : name.replace(/^execute_tool\s*/, "")}`;
  }
  if (name.endsWith("_prompt")) return "prompt-build";
  if (
    name.includes("repo") ||
    attr(span, "db.system") ||
    attr(span, "db.statement")
  ) {
    return "db";
  }
  return "other";
}

/**
 * Perf view: aggregated duration and call count per category.
 */
export function formatPerfView(spans: TraceSpan[]): string {
  if (spans.length === 0) return "(no spans)";
  const buckets = new Map<string, PerfBucket>();
  for (const span of spans) {
    const key = classify(span);
    const bucket = buckets.get(key) ?? { total: 0, count: 0 };
    bucket.total += durationMs(span);
    bucket.count += 1;
    buckets.set(key, bucket);
  }
  const rows = [...buckets.entries()].sort((a, b) => b[1].total - a[1].total);
  const lines: string[] = [];
  lines.push(`${"类别".padEnd(28, " ")} ${"累计耗时".padStart(12, " ")} ${"次数".padStart(6, " ")}`);
  for (const [name, b] of rows) {
    lines.push(
      `${name.padEnd(28, " ")} ${(b.total.toFixed(0) + "ms").padStart(12, " ")} ${String(b.count).padStart(6, " ")}`,
    );
  }
  return lines.join("\n");
}

interface ToolHit {
  field?: string;
  value?: string;
  score?: number;
  preview?: string;
}

function parseJsonish(value: unknown): Record<string, unknown> | null {
  if (typeof value !== "string" || value.length === 0) return null;
  try {
    const parsed = JSON.parse(value);
    return typeof parsed === "object" && parsed !== null ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function extractHits(span: TraceSpan): ToolHit[] {
  // trace-ai wraps the tool result in {"answer": "<stringified-json>", "block_answer": "..."}.
  // Unwrap one layer if present, then look for hits/datas/results array.
  const raw = attr(span, ...TOOL_RESULT_KEYS);
  let parsed = parseJsonish(raw);
  if (parsed && typeof parsed.answer === "string") {
    const unwrapped = parseJsonish(parsed.answer);
    if (unwrapped) parsed = unwrapped;
  }
  if (!parsed) return [];
  const candidates: unknown[] = [];
  if (Array.isArray(parsed)) candidates.push(...parsed);
  else if (Array.isArray(parsed.hits)) candidates.push(...(parsed.hits as unknown[]));
  else if (Array.isArray(parsed.datas)) candidates.push(...(parsed.datas as unknown[]));
  else if (Array.isArray(parsed.data)) candidates.push(...(parsed.data as unknown[]));
  else if (Array.isArray(parsed.results)) candidates.push(...(parsed.results as unknown[]));
  else if (Array.isArray(parsed.entries)) candidates.push(...(parsed.entries as unknown[]));
  const hits: ToolHit[] = [];
  for (const c of candidates) {
    if (typeof c !== "object" || c === null) continue;
    const obj = c as Record<string, unknown>;
    const score = typeof obj._score === "number" ? obj._score : undefined;
    const previewKeys = ["name", "title", "label", "skill_id", "_instance_id", "id"];
    let preview: string | undefined;
    for (const k of previewKeys) {
      if (typeof obj[k] === "string") {
        preview = `${k}=${obj[k] as string}`;
        break;
      }
    }
    hits.push({ score, preview });
  }
  return hits;
}

/**
 * Evidence view: ordered chain of execute_tool spans with arguments, hit count, and score.
 */
export function formatEvidenceView(spans: TraceSpan[]): string {
  const tools = spans
    .filter((s) => s.name.toLowerCase().startsWith("execute_tool"))
    .sort((a, b) => String(a.startTime).localeCompare(String(b.startTime)));
  const llms = spans.filter((s) => {
    const cls = classify(s);
    return cls === "LLM (chat)";
  });

  if (tools.length === 0 && llms.length === 0) return "(no tool / llm spans)";

  const lines: string[] = [];
  lines.push(`${"步".padEnd(4)} ${"工具".padEnd(26)} ${"耗时".padStart(8)}  详情`);
  let step = 1;
  for (const span of tools) {
    const toolName = String(attr(span, ...TOOL_NAME_KEYS) ?? span.name);
    const args = attr(span, ...TOOL_ARGS_KEYS);
    const argText = typeof args === "string" && args.length > 0 ? args : "";
    const truncated = argText.length > 100 ? argText.slice(0, 97) + "..." : argText;
    const dur = formatMs(durationMs(span)).padStart(8);
    lines.push(`${String(step).padEnd(4)} ${toolName.padEnd(26)} ${dur}  ${truncated}`);
    const hits = extractHits(span);
    if (hits.length > 0) {
      const previews = hits
        .slice(0, 3)
        .map((h) => {
          const parts: string[] = [];
          if (h.preview) parts.push(h.preview);
          if (typeof h.score === "number") parts.push(`_score=${h.score.toFixed(3)}`);
          return parts.join(", ");
        })
        .filter((s) => s.length > 0);
      const more = hits.length > previews.length ? `, +${hits.length - previews.length} more` : "";
      const prefix = "    └ ";
      lines.push(`${prefix}命中 ${hits.length} 条${previews.length ? ": " + previews.join(" | ") + more : ""}`);
    }
    step += 1;
  }
  for (const span of llms) {
    const model = attr(span, ...LLM_MODEL_KEYS) ?? "?";
    const inTok = attr(span, ...LLM_IN_TOK_KEYS) ?? "?";
    const outTok = attr(span, ...LLM_OUT_TOK_KEYS) ?? "?";
    const finish = attr(span, ...LLM_FINISH_KEYS) ?? "?";
    const dur = formatMs(durationMs(span));
    lines.push(`LLM: ${String(model)} · in=${String(inTok)} tok · out=${String(outTok)} tok · ${dur} · finish=${String(finish)}`);
  }
  return lines.join("\n");
}

interface ChatMessage {
  role: string;
  content?: string | null;
  tool_calls?: Array<{ function?: { name?: string; arguments?: string } }>;
  tool_call_id?: string;
  name?: string;
}

function parseChatMessages(raw: unknown): ChatMessage[] {
  if (typeof raw !== "string") return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed as ChatMessage[];
  } catch {
    return [];
  }
}

function extractLlmMessages(span: TraceSpan): { input: ChatMessage[]; output: ChatMessage[] } {
  const events = (span.raw?.events as Array<{ attributes?: Record<string, unknown> }> | undefined) ?? span.events;
  const empty = { input: [] as ChatMessage[], output: [] as ChatMessage[] };
  if (!Array.isArray(events)) return empty;
  for (const event of events) {
    const attrs = event.attributes;
    if (!attrs) continue;
    const inRaw = attrs["gen_ai.input.messages"];
    const outRaw = attrs["gen_ai.output.messages"];
    if (inRaw || outRaw) {
      return { input: parseChatMessages(inRaw), output: parseChatMessages(outRaw) };
    }
  }
  return empty;
}

function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return text.slice(0, max - 3) + "...";
}

function indent(text: string, prefix: string): string {
  return text.split("\n").map((l) => prefix + l).join("\n");
}

function unwrapToolAnswer(raw: string): string {
  // trace-ai tool messages look like: "{'answer': '<stringified-json>', 'block_answer': ...}".
  // Python repr (single-quoted) is not valid JSON, so try a forgiving parse before showing raw.
  const directParsed = parseJsonish(raw);
  if (directParsed && typeof directParsed.answer === "string") return directParsed.answer;
  // Fallback: replace single quotes with double quotes for a best-effort view.
  return raw;
}

export interface ReasoningOptions {
  /** When true, print every message at full length. Default truncates large bodies. */
  full?: boolean;
}

/**
 * Reasoning view: walks the LLM's chat history (input messages of the chat span +
 * the assistant's final output) so the user can read the agent's actual thought
 * process — system / user / assistant / tool_call / tool result / final answer.
 */
export function formatReasoningView(spans: TraceSpan[], opts: ReasoningOptions = {}): string {
  const limits = opts.full
    ? { system: Infinity, user: Infinity, assistant: Infinity, tool: Infinity, toolCall: Infinity }
    : { system: 400, user: 600, assistant: 500, tool: 400, toolCall: 200 };
  // Pick the deepest chat span — usually only one per turn, but be defensive.
  const chatSpans = spans.filter((s) => {
    const cls = classify(s);
    return cls === "LLM (chat)";
  });
  if (chatSpans.length === 0) return "(no chat span found — this conversation never reached the LLM)";

  // Pick the chat span with the largest input — typically the final reasoning step.
  let target = chatSpans[0];
  let targetSize = 0;
  for (const s of chatSpans) {
    const ev = (s.raw?.events as Array<{ attributes?: Record<string, unknown> }> | undefined)?.[0];
    const size = ev?.attributes?.["gen_ai.input.messages"];
    const len = typeof size === "string" ? size.length : 0;
    if (len > targetSize) {
      targetSize = len;
      target = s;
    }
  }

  const { input, output } = extractLlmMessages(target);
  if (input.length === 0 && output.length === 0) {
    return "(chat span found but it carries no gen_ai.input.messages / gen_ai.output.messages event)";
  }

  const lines: string[] = [];
  const model = String(attr(target, ...LLM_MODEL_KEYS) ?? "?");
  const inTok = String(attr(target, ...LLM_IN_TOK_KEYS) ?? "?");
  const outTok = String(attr(target, ...LLM_OUT_TOK_KEYS) ?? "?");
  lines.push(`LLM: ${model} · in=${inTok} tok · out=${outTok} tok · ${input.length} input messages\n`);

  for (let i = 0; i < input.length; i += 1) {
    const m = input[i];
    const role = m.role || "?";
    if (role === "system") {
      const content = typeof m.content === "string" ? m.content : "";
      lines.push(`[${i}] system  · ${content.length} chars`);
      lines.push(indent(truncate(content, limits.system), "    "));
    } else if (role === "user") {
      const content = typeof m.content === "string" ? m.content : "";
      lines.push(`[${i}] user`);
      lines.push(indent(truncate(content, limits.user), "    "));
    } else if (role === "assistant") {
      const content = typeof m.content === "string" ? m.content : "";
      lines.push(`[${i}] assistant`);
      if (content.length > 0) {
        lines.push(indent(truncate(content, limits.assistant), "    "));
      }
      const calls = m.tool_calls ?? [];
      for (const call of calls) {
        const fn = call.function ?? {};
        const args = String(fn.arguments ?? "");
        lines.push(`    → tool_call ${fn.name ?? "?"}(${truncate(args, limits.toolCall)})`);
      }
    } else if (role === "tool") {
      const name = m.name ?? "tool";
      const content = typeof m.content === "string" ? m.content : "";
      const unwrapped = unwrapToolAnswer(content);
      lines.push(`[${i}] tool · ${name}`);
      lines.push(indent(truncate(unwrapped, limits.tool), "    "));
    } else {
      const content = typeof m.content === "string" ? m.content : JSON.stringify(m.content ?? "");
      lines.push(`[${i}] ${role}`);
      lines.push(indent(truncate(content, Math.min(limits.tool, 300)), "    "));
    }
    lines.push("");
  }

  if (output.length > 0) {
    lines.push("─── Final answer ───");
    for (const m of output) {
      const content = typeof m.content === "string" ? m.content : "";
      if (content.length > 0) lines.push(content);
    }
  }

  return lines.join("\n");
}

export type TraceView = "tree" | "perf" | "evidence" | "reasoning" | "all";

export interface FormatOptions {
  /** Pass through to formatReasoningView — disables per-message truncation. */
  full?: boolean;
}

/**
 * Render one or more views over a trace result. Returns concatenated text suitable for stdout.
 */
export function formatTraceResult(
  result: TracesByConversationResult,
  view: TraceView,
  opts: FormatOptions = {},
): string {
  if (result.spans.length === 0) {
    return `(no spans for conversation ${result.conversationId})`;
  }
  const sections: Array<[string, () => string]> = [];
  if (view === "tree" || view === "all") sections.push(["── Tree ──", () => formatTreeView(result.spans)]);
  if (view === "perf" || view === "all") sections.push(["── Perf ──", () => formatPerfView(result.spans)]);
  if (view === "evidence" || view === "all") sections.push(["── Evidence ──", () => formatEvidenceView(result.spans)]);
  if (view === "reasoning" || view === "all")
    sections.push(["── Reasoning ──", () => formatReasoningView(result.spans, { full: opts.full })]);
  const head = result.truncated
    ? `[warn] traceId aggregation truncated — increase maxTraceIds for full coverage\n`
    : "";
  const body = sections.map(([title, fn]) => `${title}\n${fn()}`).join("\n\n");
  return head + body;
}
