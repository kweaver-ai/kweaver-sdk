import { z } from "zod";

export const NextChangeSchema = z.object({
  target: z.string().min(1),
  hypothesis: z.string().min(1),
  patch: z.string(),
});

const GuardrailSchema = z.object({
  name: z.string(),
  kind: z.enum(["hard", "soft"]),
  rule: z.string(),
});

export const MissionSchema = z.object({
  schema_version: z.literal("trace-mission/v1"),
  goal: z.string().min(1),
  max_rounds: z.number().int().positive().optional(),
  provider: z.string().optional(),
  eval_sets: z.array(z.object({
    path: z.string().min(1),
    role: z.enum(["seed", "regression", "holdout"]),
  })).min(1),
  current_candidate: z.object({ path: z.string() }),
  next_change: NextChangeSchema.optional(),
  guardrails: z.array(GuardrailSchema).optional(),
});
export type Mission = z.infer<typeof MissionSchema>;
export type NextChange = z.infer<typeof NextChangeSchema>;
export { GuardrailSchema };
export type Guardrail = z.infer<typeof GuardrailSchema>;

export const BundleSchema = z.object({
  schema_version: z.literal("trace-bundle/v1"),
  experiment_id: z.string().min(1),
  bundle_id: z.string().min(1),
  best_trial_version: z.number().int().nonnegative(),
  resources: z.object({
    agent_config: z.record(z.string(), z.unknown()),
    skills: z.array(z.record(z.string(), z.unknown())),
  }),
  provenance: z.object({
    created_by: z.string(),
    created_at: z.string(),
    evidence_traces: z.array(z.string()),
    round_refs: z.array(z.string()),
  }),
});
export type Bundle = z.infer<typeof BundleSchema>;

export const ManifestSchema = z.object({
  schema_version: z.literal("trace-manifest/v1"),
  experiment_id: z.string().min(1),
  trial_version: z.number().int().nonnegative(),
  predictions: z.object({
    fixes: z.array(z.object({ query_id: z.string(), reason: z.string() })),
    risks: z.array(z.object({ query_id: z.string(), reason: z.string() })),
  }),
});
export type Manifest = z.infer<typeof ManifestSchema>;

// FSM state type
export type ExpFsmState =
  | "Init" | "Generating" | "Executing" | "Scoring"
  | "Triaging" | "Deciding" | "Publishing" | "Published" | "Aborted";

// events.jsonl event union
export type ExpEvent =
  | { ts: string; type: "state_transition"; from: ExpFsmState; to: ExpFsmState; round: number }
  | { ts: string; type: "round_completed"; round: number; verdict: "continue" | "publish" }
  | { ts: string; type: "step_failed"; state: ExpFsmState; error: string; retryable: boolean }
  | { ts: string; type: "aborted"; round: number; reason: string };

// lineage entry
export interface LineageEntry {
  version: number;
  candidate_path: string;
  next_change: NextChange;
  status: "running" | "scored" | "guardrail_failed";
  appended_at: string;
}

// three-axis scores
export interface ThreeAxisScores {
  outcome: number;
  trajectory: number;
  guardrail: number;
  guardrail_hard_fail: boolean;
}

// per-query execution result
export interface QueryResult {
  query_id: string;
  assertion_results: Array<{ type: string; verdict: "pass" | "fail" | "skip"; reason?: string }>;
  trajectory_summary: {
    tool_call_sequence: string[];
    retry_count: number;
    latency_ms: number;
    error_codes: string[];
  };
  raw_trace_id?: string;
}

// round.yaml content
export interface RoundData {
  round: number;
  trial_version: number;
  scores?: ThreeAxisScores;
  per_query_results?: QueryResult[];
  trajectory_summaries?: QueryResult["trajectory_summary"][];
  guardrail_failed?: boolean;
  triage_conclusion?: {
    diagnoses: string[];
    hints: string[];
    verdict: "continue" | "publish";
    cross_round_memory_ref?: string;
  };
}
