import type { Hit, Predicate, Span, TraceTree } from "../types.js";

function getPrompt(s: Span): string {
  const v = s.attributes["gen_ai.prompt"] ?? s.attributes["llm.prompt"];
  return typeof v === "string" ? v : "";
}

function getErrorMessage(s: Span): string {
  const v = s.attributes["error.message"];
  return typeof v === "string" ? v : "";
}

function getToolName(s: Span): string {
  const v = s.attributes["gen_ai.tool.name"];
  return typeof v === "string" ? v : s.name;
}

export const predicate: Predicate = (trace: TraceTree): Hit[] => {
  const allSpans = trace.spans
    .slice()
    .sort((a, b) => Number(BigInt(a.startTimeUnixNano) - BigInt(b.startTimeUnixNano)));
  const hits: Hit[] = [];
  for (let i = 0; i < allSpans.length; i++) {
    const s = allSpans[i];
    if (s.kind !== "tool" || s.status !== "error") continue;
    const errMsg = getErrorMessage(s);
    const toolName = getToolName(s);
    // find next LLM span
    let next: Span | undefined;
    for (let j = i + 1; j < allSpans.length; j++) {
      if (allSpans[j].kind === "llm") { next = allSpans[j]; break; }
    }
    if (!next) continue;
    const prompt = getPrompt(next).toLowerCase();
    const errInPrompt = errMsg.length > 0 && prompt.includes(errMsg.toLowerCase());
    if (!errInPrompt) {
      hits.push({
        evidenceSpans: [s.spanId, next.spanId],
        excerpt: `tool '${toolName}' errored ('${errMsg}') but next LLM prompt did not propagate the error`,
        bindings: { tool_name: toolName, error_message: errMsg },
      });
    }
  }
  return hits;
};
