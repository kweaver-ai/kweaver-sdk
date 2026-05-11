import type { Hit, Predicate, Span, TraceTree } from "../types.js";

const STATE_KEY = "gen_ai.conversation.state";

function toolName(s: Span): string {
  const v = s.attributes["gen_ai.tool.name"];
  return typeof v === "string" ? v : s.name;
}

function deepEqual(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);  // PR-A: simple JSON compare; sufficient for tool args
}

export const predicate: Predicate = (trace: TraceTree, params: Record<string, unknown>): Hit[] => {
  const minConsecutive = (params.min_consecutive as number | undefined) ?? 3;
  const tools = (trace.byKind.get("tool") ?? []).slice().sort(
    (a, b) => Number(BigInt(a.startTimeUnixNano) - BigInt(b.startTimeUnixNano)),
  );
  const hits: Hit[] = [];
  let i = 0;
  while (i < tools.length) {
    const start = tools[i];
    const startName = toolName(start);
    const startArgs = start.attributes["gen_ai.tool.args"];
    const startState = start.attributes[STATE_KEY];
    let j = i + 1;
    while (
      j < tools.length &&
      toolName(tools[j]) === startName &&
      deepEqual(tools[j].attributes["gen_ai.tool.args"], startArgs) &&
      // state unchanged across the run (or both undefined)
      (tools[j].attributes[STATE_KEY] === startState || (startState === undefined && tools[j].attributes[STATE_KEY] === undefined))
    ) j++;
    const runLen = j - i;
    if (runLen >= minConsecutive) {
      const evidenceSpans = tools.slice(i, j).map((s) => s.spanId);
      hits.push({
        evidenceSpans,
        excerpt: `tool '${startName}' called ${runLen} times consecutively with identical args; conversation state unchanged`,
        bindings: { tool_name: startName, loop_count: runLen, max_count: minConsecutive - 1 },
      });
    }
    i = j;
  }
  return hits;
};
