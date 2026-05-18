// src/trace-ai/exp/providers/triage-client.ts
import { z } from "zod";
import { defaultRegistry } from "../../../agent-providers/registry.js";
import type { RoundData } from "../schemas.js";

export interface TriageInput {
  currentRound: RoundData;
  prevRounds: RoundData[];
  candidateConfig: Record<string, unknown>;
  crossRoundMemoryRef?: string;
}

export interface TriageResult {
  diagnoses: string[];
  hints: string[];
  verdict: "continue" | "publish";
  new_memory_token: string;
}

const TriageOutputSchema = z.object({
  diagnoses: z.array(z.string()),
  hints: z.array(z.string()),
  verdict: z.enum(["continue", "publish"]),
  new_memory_token: z.string(),
});

export interface TriageClient {
  triage(input: TriageInput): Promise<TriageResult>;
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
- "diagnoses": list of root cause observations
- "hints": list of specific suggestions for next change
- "verdict": "continue" if more rounds needed, "publish" if this candidate is good enough
- "new_memory_token": brief summary of key findings to carry forward (1-2 sentences)`;

    const response = await provider.invoke({
      prompt,
      outputSchema: TriageOutputSchema,
      correlationId: `triage-${Date.now()}`,
    });
    return response.output;
  }
}
