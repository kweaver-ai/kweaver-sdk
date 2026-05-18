// src/trace-ai/exp/providers/triage-client.ts
import yaml from "js-yaml";
import { z } from "zod";
import { defaultRegistry } from "../../../agent-providers/registry.js";
import type {
  RoundData,
  FailureAttribution,
  QueryFailureAnalysis,
  Mission,
  NextChange,
  KnContext,
  SkillContext,
} from "../schemas.js";
import { FailureAttributionSchema, NextChangeSchema } from "../schemas.js";
import { buildKnContextPrompt, buildSkillContextPrompt } from "./synthesizer-client.js";

export interface TriageInput {
  currentRound: RoundData;
  prevRounds: RoundData[];
  candidateConfig: Record<string, unknown>;
  crossRoundMemoryRef?: string;
  failureAnalysis?: QueryFailureAnalysis[];
  // Merged planner inputs (formerly SynthesizerInput):
  mission: Mission;
  kn_context?: KnContext;
  skill_context?: SkillContext;
}

export interface TriageResult {
  verdict: "continue" | "publish" | "abort";
  summary: string;
  failure_attribution: FailureAttribution[];
  /** Next change to apply. Present when verdict === "continue"; null/undefined otherwise. */
  next_change?: NextChange;
  /** Diagnoses extracted from the LLM response (defaults to [summary]) */
  diagnoses: string[];
  /** Hints extracted from the LLM response */
  hints: string[];
  /** Opaque memory token passed across rounds */
  new_memory_token: string;
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

  let next_change: NextChange | undefined;
  if (verdict === "continue") {
    if (data["next_change"] === undefined || data["next_change"] === null) {
      throw new Error(`verdict=continue requires next_change in triage output`);
    }
    const parsed = NextChangeSchema.safeParse(data["next_change"]);
    if (!parsed.success) {
      throw new Error(`Invalid next_change in triage output: ${parsed.error.message}`);
    }
    next_change = parsed.data;
  }

  const diagnoses = Array.isArray(data["diagnoses"])
    ? (data["diagnoses"] as unknown[]).filter((d): d is string => typeof d === "string")
    : [summary];
  const hints = Array.isArray(data["hints"])
    ? (data["hints"] as unknown[]).filter((h): h is string => typeof h === "string")
    : [];
  const new_memory_token = typeof data["new_memory_token"] === "string" ? data["new_memory_token"] : summary;
  return { verdict, summary, failure_attribution, next_change, diagnoses, hints, new_memory_token };
}

export function buildTriagePrompt(input: TriageInput): string {
  const r = input.currentRound;
  const scoresSummary = r.scores
    ? `outcome=${r.scores.outcome.toFixed(2)}, trajectory=${r.scores.trajectory.toFixed(2)}, guardrail=${r.scores.guardrail.toFixed(2)}`
    : "no scores";

  let failureSection: string;
  if (input.failureAnalysis && input.failureAnalysis.length > 0) {
    const lines = input.failureAnalysis.map(fa => {
      let entry = `${fa.query_id} [${fa.verdict}]: ${fa.assertion_reason}`;
      if (fa.tool_call_summary.length > 0) {
        entry += `\n  Tools: ${fa.tool_call_summary.join("; ")}`;
      }
      return entry;
    }).join("\n");
    failureSection = `FAILURE ANALYSIS:\n${lines}`;
  } else {
    const failedQueries = (r.per_query_results ?? [])
      .filter(q => q.assertion_results.some(a => a.verdict === "fail"))
      .map(q => `${q.query_id}: ${q.assertion_results.filter(a => a.verdict === "fail").map(a => a.type).join(", ")}`)
      .join("\n");
    failureSection = `FAILED QUERIES:\n${failedQueries || "None"}`;
  }

  let contextSection = "";
  if (input.kn_context) contextSection += "\n\n" + buildKnContextPrompt(input.kn_context);
  if (input.skill_context) contextSection += "\n\n" + buildSkillContextPrompt(input.skill_context);

  return `You are an agent evaluation planner. Analyze the current round results, decide whether to continue/publish/abort, and (if continuing) propose the next change to try in one pass.

GOAL: ${input.mission.goal}

CURRENT CANDIDATE CONFIG:
${yaml.dump(input.candidateConfig, { lineWidth: 80 })}

ROUND ${r.round} SCORES: ${scoresSummary}

${failureSection}

TRAJECTORY ISSUES:
${(r.per_query_results ?? []).filter(q => q.trajectory_summary.retry_count > 1).map(q => `${q.query_id}: ${q.trajectory_summary.retry_count} retries`).join("\n") || "None"}

PREVIOUS ROUND HISTORY:
${input.prevRounds.map(pr => `Round ${pr.round}: outcome=${pr.scores?.outcome.toFixed(2) ?? "?"}, verdict=${pr.triage_conclusion?.verdict ?? "?"}, hints=${pr.triage_conclusion?.hints?.join("; ") || "none"}`).join("\n") || "None"}

${input.crossRoundMemoryRef ? `CROSS-ROUND CONTEXT: ${input.crossRoundMemoryRef}` : ""}${contextSection}

Respond with a single JSON object containing these fields:
- "verdict": "continue" | "publish" | "abort"
    * continue = more rounds needed, you must also provide next_change
    * publish = current candidate is good enough
    * abort = experiment cannot improve further
- "summary": one-sentence summary of key findings
- "failure_attribution": array of root-cause attributions (sorted by affected_queries count desc),
  empty array when verdict is publish or abort.
  Each entry shape:
  {
    "layer": "kn" | "skill" | "agent",
    "evidence": "<one sentence citing specific tool call or return value>",
    "affected_queries": ["<query_id>", ...],
    "suggested_target": "kn.object_type" | "kn.relation_type" | "skill.content" | "agent.system_prompt" | "agent.skills"
  }
- "next_change": REQUIRED when verdict=continue, omit/null otherwise. Use failure_attribution[0].suggested_target.
- "hints": array of short actionable hints for the next round (carried forward to future PREVIOUS ROUND HISTORY); use [] if none.
- "new_memory_token": short string (≤ 200 chars) summarizing what to remember across rounds; will appear as CROSS-ROUND CONTEXT next round.

Attribution rules:
- "kn":    agent queried KN but concept/relation was missing or returned empty unexpectedly
- "skill": agent had the right intent but the tool usage pattern was wrong (no pagination, no sort_by, wrong filter)
- "agent": agent misidentified the concept to query, or made an orchestration error

NEXT_CHANGE OUTPUT EXAMPLES (pick the one matching your chosen target):

# agent.system_prompt — patch is a JSON string (escaped) or object with {agent:{system_prompt}}
{"target":"agent.system_prompt","hypothesis":"Add explicit stop condition","patch":"{\\"agent\\":{\\"system_prompt\\":\\"New prompt here\\"}}"}

# agent.skills — patch is structured {unbind:[skill_id...], bind:[{id,version}...]}
{"target":"agent.skills","hypothesis":"Swap retrieval skill to v2","patch":{"unbind":["retrieval-v1"],"bind":[{"id":"retrieval-v2","version":"v2"}]}}

# kn.object_type — patch is {kn_id, add_object_types:[{concept_name, dataview_id, primary_keys, data_properties}], add_relation_types:[]}
{"target":"kn.object_type","hypothesis":"Add vehicle_sales concept","patch":{"kn_id":"kn-x","add_object_types":[{"concept_name":"vehicle_sales","dataview_id":"dv-001","primary_keys":["vehicle_sales_id"],"data_properties":[{"name":"sales","type":"integer"},{"name":"month","type":"string"}]}],"add_relation_types":[]}}

# kn.relation_type — patch is {kn_id, add_object_types:[], add_relation_types:[{concept_name, source_object_type, target_object_type, join_key}]}
{"target":"kn.relation_type","hypothesis":"Link sales to vehicle","patch":{"kn_id":"kn-x","add_object_types":[],"add_relation_types":[{"concept_name":"sold_for","source_object_type":"vehicle_sales","target_object_type":"vehicle","join_key":"vehicle_id"}]}}

# skill.content — patch is {skill_id, append_section}
{"target":"skill.content","hypothesis":"Document sort_by usage","patch":{"skill_id":"query-sop","append_section":"## Sort_by usage\\nPass sort_by=[{field, order}] to query_object_instance for ordering."}}`;
}

export class ClaudeCodeTriageClient implements TriageClient {
  async triage(input: TriageInput): Promise<TriageResult> {
    const provider = defaultRegistry.resolve({ preferred: "claude-code" });
    if (!provider) throw new Error("claude-code provider not available");

    const prompt = buildTriagePrompt(input);

    const response = await provider.invoke({
      prompt,
      outputSchema: z.unknown(),
      correlationId: `triage-${Date.now()}`,
    });
    return parseTriageOutput(response.rawText);
  }
}
