import type { TraceSpan } from "../../api/conversations.js";
import type { EvalAssertion, EvalReference } from "./types.js";

export interface SemanticMatchVerdict {
  verdict: "pass" | "fail";
  reasoning: string;
}

export interface SemanticMatchProvider {
  judgeSemanticMatch(
    question: string,
    candidateAnswer: string,
    referenceAnswer: string,
  ): Promise<SemanticMatchVerdict>;
}

export interface AssertionContext {
  answer: string;
  spans: TraceSpan[];
  reference?: EvalReference;
  durationMs?: number;
  /**
   * The user message that produced `answer`. Used as the default
   * `{{question}}` for `semantic_match` when the assertion doesn't
   * override it — case authors should not have to repeat user_message
   * inside every semantic_match block.
   */
  question?: string;
  semanticMatchProvider?: SemanticMatchProvider;
}

export interface AssertionResult {
  verdict: "pass" | "fail" | "skip";
  actual?: unknown;
  reason?: string;
}

type Op = "eq" | "lt" | "lte" | "gt" | "gte";

function applyOp(actual: number, op: Op, expected: number): boolean {
  switch (op) {
    case "eq":  return actual === expected;
    case "lt":  return actual <   expected;
    case "lte": return actual <=  expected;
    case "gt":  return actual >   expected;
    case "gte": return actual >=  expected;
  }
}

function toolCallsFor(spans: TraceSpan[], toolName: string): TraceSpan[] {
  return spans.filter(
    (s) => s.kind === "tool" && s.attributes?.["gen_ai.tool.name"] === toolName,
  );
}

function sortedToolNames(spans: TraceSpan[]): string[] {
  return spans
    .filter((s) => s.kind === "tool")
    .slice()
    .sort((a, b) => (a.startTime < b.startTime ? -1 : a.startTime > b.startTime ? 1 : 0))
    .map((s) => String(s.attributes?.["gen_ai.tool.name"] ?? ""));
}

function isSubsequence(sequence: string[], actual: string[]): boolean {
  let si = 0;
  for (const name of actual) {
    if (name === sequence[si]) si++;
    if (si === sequence.length) return true;
  }
  return false;
}

export async function evaluateAssertion(
  assertion: EvalAssertion,
  ctx: AssertionContext,
): Promise<AssertionResult> {
  const { answer, spans, durationMs } = ctx;
  const a = assertion as Record<string, unknown>;

  switch (assertion.type) {
    case "contains": {
      const value = String(a["value"] ?? "");
      return answer.includes(value)
        ? { verdict: "pass" }
        : { verdict: "fail", actual: answer };
    }

    case "not_contains": {
      const value = String(a["value"] ?? "");
      return answer.includes(value)
        ? { verdict: "fail", actual: answer }
        : { verdict: "pass" };
    }

    case "regex": {
      const pattern = String(a["pattern"] ?? "");
      let re: RegExp;
      try {
        re = new RegExp(pattern);
      } catch {
        return { verdict: "skip", reason: "invalid-regex: " + pattern };
      }
      return re.test(answer) ? { verdict: "pass" } : { verdict: "fail", actual: answer };
    }

    case "tool_call_count": {
      const tool = String(a["tool"] ?? "");
      const op = (a["op"] as Op) ?? "eq";
      const value = Number(a["value"] ?? 0);
      const count = toolCallsFor(spans, tool).length;
      return applyOp(count, op, value)
        ? { verdict: "pass", actual: count }
        : { verdict: "fail", actual: count };
    }

    case "tool_call_order": {
      const sequence = Array.isArray(a["sequence"])
        ? (a["sequence"] as unknown[]).map(String)
        : [];
      const actual = sortedToolNames(spans);
      return isSubsequence(sequence, actual)
        ? { verdict: "pass", actual }
        : { verdict: "fail", actual };
    }

    case "latency_ms": {
      if (durationMs === undefined || durationMs === null) {
        return { verdict: "skip", reason: "durationMs not available" };
      }
      const op = (a["op"] as Op) ?? "lte";
      const value = Number(a["value"] ?? 0);
      return applyOp(durationMs, op, value)
        ? { verdict: "pass", actual: durationMs }
        : { verdict: "fail", actual: durationMs };
    }

    case "semantic_match": {
      const provider = ctx.semanticMatchProvider;
      if (!provider) {
        return { verdict: "skip", reason: "semantic_match requires a provider; pass semanticMatchProvider in context" };
      }
      if (!ctx.reference?.answer) {
        return { verdict: "skip", reason: "semantic_match requires reference.answer on the eval case" };
      }
      const question = String(a["question"] ?? ctx.question ?? "");
      const smv = await provider.judgeSemanticMatch(question, answer, ctx.reference.answer);
      return { verdict: smv.verdict, actual: smv.reasoning };
    }

    default:
      return { verdict: "skip", reason: `unknown assertion type: ${assertion.type}` };
  }
}
