// src/trace-ai/exp/providers/triage-client.ts
import { z } from "zod";
import { defaultRegistry } from "../../../agent-providers/registry.js";
import type { RoundData } from "../schemas.js";
import { FailureAttributionSchema, type FailureAttribution } from "../schemas.js";

export interface TriageInput {
  currentRound: RoundData;
  prevRounds: RoundData[];
  candidateConfig: Record<string, unknown>;
  crossRoundMemoryRef?: string;
}

export interface TriageResult {
  verdict: "continue" | "publish" | "abort";
  summary: string;
  failure_attribution: FailureAttribution[];
}

export interface TriageClient {
  triage(input: TriageInput): Promise<TriageResult>;
}

export function parseTriageOutput(raw: string): TriageResult {
  let obj: unknown;
  try {
    obj = JSON.parse(raw);
  } catch {
    throw new Error(`Triage output is not valid JSON: ${raw.slice(0, 200)}`);
  }
  const data = obj as Record<string, unknown>;
  const verdict = data["verdict"];
  if (verdict !== "continue" && verdict !== "publish" && verdict !== "abort") {
    throw new Error(`Invalid verdict in triage output: ${String(verdict)}`);
  }
  const summary = typeof data["summary"] === "string" ? data["summary"] : "";
  const rawAttribution = Array.isArray(data["failure_attribution"]) ? data["failure_attribution"] : [];
  const failure_attribution: FailureAttribution[] = rawAttribution.map((item) => {
    const parsed = FailureAttributionSchema.safeParse(item);
    if (!parsed.success) throw new Error(`Invalid failure_attribution item: ${JSON.stringify(item)}`);
    return parsed.data;
  });
  return { verdict, summary, failure_attribution };
}

export class ClaudeCodeTriageClient implements TriageClient {
  async triage(input: TriageInput): Promise<TriageResult> {
    const provider = defaultRegistry.resolve({ preferred: "claude-code" });
    if (!provider) throw new Error("claude-code provider not available");

    const r = input.currentRound;
    const scoresSummary = r.scores
      ? `outcome=${r.scores.outcome.toFixed(2)}, trajectory=${r.scores.trajectory.toFixed(2)}, guardrail=${r.scores.guardrail.toFixed(2)}`
      : "no scores";

    const failedQueries = (r.per_query_results ?? [])
      .filter(q => q.assertion_results.some(a => a.verdict === "fail"))
      .map(q => `${q.query_id}: ${q.assertion_results.filter(a => a.verdict === "fail").map(a => a.type).join(", ")}`)
      .join("\n");

    // candidateConfig is available for future prompt enrichment; omitted here to keep the prompt focused on scores.
    const prompt = `You are an agent evaluation triager. Analyze the current round results and recommend next steps.

ROUND ${r.round} SCORES: ${scoresSummary}

FAILED QUERIES:
${failedQueries || "None"}

TRAJECTORY ISSUES:
${(r.per_query_results ?? []).filter(q => q.trajectory_summary.retry_count > 1).map(q => `${q.query_id}: ${q.trajectory_summary.retry_count} retries`).join("\n") || "None"}

PREVIOUS ROUND HISTORY:
${input.prevRounds.map(pr => `Round ${pr.round}: outcome=${pr.scores?.outcome.toFixed(2) ?? "?"}, verdict=${pr.triage_conclusion?.verdict ?? "?"}`).join("\n") || "None"}

${input.crossRoundMemoryRef ? `CONTEXT FROM PREVIOUS TRIAGE: ${input.crossRoundMemoryRef}` : ""}

Respond with JSON:
- "verdict": "continue" if more rounds needed, "publish" if this candidate is good enough, "abort" if the experiment cannot improve further
- "summary": one-sentence summary of key findings
- "failure_attribution": array of root-cause attributions (sorted by affected_queries count desc)

Additionally output a "failure_attribution" array (sorted by affected_queries count desc).
For each distinct root-cause layer, output one entry:
{
  "layer": "kn" | "skill" | "agent",
  "evidence": "<one sentence citing specific tool call or return value from the trace>",
  "affected_queries": ["<query_id>", ...],
  "suggested_target": "kn.object_type" | "kn.relation_type" | "skill.content" | "agent.system_prompt"
}
Attribution rules:
- "kn": agent queried KN but concept/relation was missing or returned empty unexpectedly
- "skill": agent had the right intent but the tool usage pattern was wrong (no pagination, no sort_by, wrong filter)
- "agent": agent misidentified the concept to query, or made an orchestration error
If verdict is "publish" or "abort", output an empty array for failure_attribution.`;

    const response = await provider.invoke({
      prompt,
      outputSchema: z.unknown(),
      correlationId: `triage-${Date.now()}`,
    });
    return parseTriageOutput(response.rawText);
  }
}
