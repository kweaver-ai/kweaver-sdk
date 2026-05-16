import { z } from "zod";

const GuardrailSchema = z.object({
  name: z.string(),
  kind: z.enum(["hard", "soft"]),
  rule: z.string(),
});
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
  | { ts: string; type: "aborted"; round: number; reason: string }
  | { ts: string; type: "TriageComplete"; round: number; verdict: string; summary: string; failure_attribution: FailureAttribution[] };

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

// ── Multilayer Patch ──────────────────────────────────────────────────────

export const PatchTargetSchema = z.enum([
  "agent.system_prompt",
  "agent.skills",
  "kn.object_type",
  "kn.relation_type",
  "skill.content",
]);
export type PatchTarget = z.infer<typeof PatchTargetSchema>;

export const FailureAttributionSchema = z.object({
  layer: z.enum(["kn", "skill", "agent"]),
  evidence: z.string(),
  affected_queries: z.array(z.string()),
  suggested_target: PatchTargetSchema,
});
export type FailureAttribution = z.infer<typeof FailureAttributionSchema>;

// ── KN Patch types ────────────────────────────────────────────────────────

export const KnDataPropertySchema = z.object({ name: z.string(), type: z.string() });

export const KnObjectTypeDefSchema = z.object({
  concept_name: z.string(),
  dataview_id: z.string(),
  primary_keys: z.array(z.string()),
  data_properties: z.array(KnDataPropertySchema).default([]),
});
export type KnObjectTypeDef = z.infer<typeof KnObjectTypeDefSchema>;

export const KnRelationTypeDefSchema = z.object({
  concept_name: z.string(),
  source_object_type: z.string(),
  target_object_type: z.string(),
  join_key: z.string(),
});
export type KnRelationTypeDef = z.infer<typeof KnRelationTypeDefSchema>;

export const KnPatchSchema = z.object({
  kn_id: z.string(),
  add_object_types: z.array(KnObjectTypeDefSchema).default([]),
  add_relation_types: z.array(KnRelationTypeDefSchema).default([]),
});
export type KnPatch = z.infer<typeof KnPatchSchema>;

// ── Skill Patch types ─────────────────────────────────────────────────────

export const SkillContentPatchSchema = z.object({
  skill_id: z.string(),
  append_section: z.string(),
});
export type SkillContentPatch = z.infer<typeof SkillContentPatchSchema>;

export const SkillBindingSchema = z.object({ id: z.string(), version: z.string() });
export type SkillBinding = z.infer<typeof SkillBindingSchema>;

export const AgentSkillsPatchSchema = z.object({
  unbind: z.array(z.string()).default([]),
  bind: z.array(SkillBindingSchema).default([]),
});
export type AgentSkillsPatch = z.infer<typeof AgentSkillsPatchSchema>;

// ── NextChange discriminated union ────────────────────────────────────────

export const NextChangeSchema = z.discriminatedUnion("target", [
  z.object({ target: z.literal("agent.system_prompt"), hypothesis: z.string().optional(), patch: z.union([z.string(), z.record(z.string(), z.unknown())]) }),
  z.object({ target: z.literal("agent.skills"), hypothesis: z.string().optional(), patch: AgentSkillsPatchSchema }),
  z.object({ target: z.literal("kn.object_type"), hypothesis: z.string(), patch: KnPatchSchema }),
  z.object({ target: z.literal("kn.relation_type"), hypothesis: z.string(), patch: KnPatchSchema }),
  z.object({ target: z.literal("skill.content"), hypothesis: z.string(), patch: SkillContentPatchSchema }),
]);
export type NextChange = z.infer<typeof NextChangeSchema>;

// ── MissionSchema (depends on NextChangeSchema) ───────────────────────────

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

// ── ContextAssembler types ────────────────────────────────────────────────

export const VegaCatalogEntrySchema = z.object({
  id: z.string(),
  name: z.string(),
  columns: z.array(z.object({ name: z.string(), type: z.string() })),
});
export type VegaCatalogEntry = z.infer<typeof VegaCatalogEntrySchema>;

export const KnSchemaSnapshotSchema = z.object({
  object_types: z.array(z.object({
    concept_name: z.string(),
    fields: z.array(z.object({ name: z.string(), type: z.string() })),
  })),
  relation_types: z.array(z.object({
    concept_name: z.string(),
    source: z.string(),
    target: z.string(),
    join_key: z.string(),
  })),
});
export type KnSchemaSnapshot = z.infer<typeof KnSchemaSnapshotSchema>;

export const KnContextSchema = z.object({
  kn_id: z.string(),
  existing_schema: KnSchemaSnapshotSchema,
  available_dataviews: z.array(VegaCatalogEntrySchema),
});
export type KnContext = z.infer<typeof KnContextSchema>;

export const SkillContextSchema = z.object({
  bound_skills: z.array(z.object({ id: z.string(), version: z.string(), content: z.string() })),
});
export type SkillContext = z.infer<typeof SkillContextSchema>;

// ── CandidateSchema ───────────────────────────────────────────────────────

export const CandidateSchema = z.object({
  schema_version: z.literal("trace-candidate/v1"),
  agent: z.object({
    description: z.string(),
    system_prompt: z.string(),
  }),
  kn: z.object({
    id: z.string(),
    object_types: z.array(KnObjectTypeDefSchema).default([]),
    relation_types: z.array(KnRelationTypeDefSchema).default([]),
  }).optional(),
});
export type Candidate = z.infer<typeof CandidateSchema>;

// ── Lineage extension ─────────────────────────────────────────────────────

// lineage entry (original interface — used by candidate-lineage-yaml.ts)
export interface LineageEntry {
  version: number;
  candidate_path: string;
  next_change: NextChange;
  status: "running" | "scored" | "guardrail_failed";
  appended_at: string;
}

export const SkillSetEntrySchema = z.object({ id: z.string(), version: z.string() });
export type SkillSetEntry = z.infer<typeof SkillSetEntrySchema>;

export const KnPatchLogEntrySchema = z.object({
  op: z.enum(["add_object_type", "add_relation_type"]),
  concept_name: z.string(),
  dataview_id: z.string().optional(),
  applied_at: z.string(),
});
export type KnPatchLogEntry = z.infer<typeof KnPatchLogEntrySchema>;

export const LineageEntrySchema = z.object({
  version: z.number(),
  agent_id: z.string(),
  skill_set: z.array(SkillSetEntrySchema).default([]),
  kn_patch_log: z.array(KnPatchLogEntrySchema).default([]),
});
export type LineageEntryExtended = z.infer<typeof LineageEntrySchema>;
