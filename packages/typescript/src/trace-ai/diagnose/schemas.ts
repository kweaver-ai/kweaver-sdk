import { z } from "zod";

const TaxonomySchema = z.object({
  signals_axis: z.enum(["interaction", "execution", "environment"]),
  ms_class: z.enum([
    "retry_loop",
    "tool_misuse",
    "context_loss",
    "goal_drift",
    "cascading_error",
    "silent_quality_degradation",
  ]),
});

const SuggestedFixSchema = z.object({
  target: z.string().min(1),
  change_template: z.string().min(1),
});

const VerifyWithSchema = z.object({
  assertion_templates: z.array(z.string()).default([]),
});

/**
 * Rubric input source descriptor. The supported source prefixes are
 * resolved by `diagnose/agent-binding.ts` against the in-memory TraceTree:
 *
 *   - `extract_from_root_attr:<dot.path>`   → root span attribute by name
 *   - `filter_by_kind:[kind1,kind2,...]`    → ordered span subset by kind
 *   - `literal:<json>`                      → constant blob (debug / fixtures)
 *
 * Authors describe **which slice of the trace** the agent needs as context;
 * the binding does the actual extraction so rule YAML stays declarative.
 */
const RubricInputSchema = z.object({
  kind: z.string().min(1),
  source: z.string().min(1),
});

/**
 * Minimal JSON-Schema-ish shape we accept for rubric output_schema. We
 * convert to a zod schema at load time (see `output-schema-converter.ts`);
 * keeping this loose here lets authors paste literal JSON Schema without
 * us re-implementing the whole spec — just the subset we need (object
 * with required[] + properties{type,enum,items}).
 */
const RubricOutputSchemaSchema = z.object({
  type: z.literal("object"),
  required: z.array(z.string()).default([]),
  properties: z.record(z.string(), z.record(z.string(), z.unknown())),
});

const AgentBindingSchema = z.object({
  provider: z.string().min(1),
  prompt_template_ref: z.string().regex(/^builtin:[a-zA-Z0-9_-]+$/),
});

const RubricSchema = z.object({
  judge_question: z.string().min(1),
  inputs: z.array(RubricInputSchema).default([]),
  output_schema: RubricOutputSchemaSchema,
  agent_binding: AgentBindingSchema,
  /**
   * Optional symbolic rule_ids that act as gate for this rubric in batch mode.
   * Empty/missing → rubric runs on all traces (PR-B fallback). In single-trace
   * mode this field is ignored; rubric always runs.
   */
  gates_on: z.array(z.string()).optional(),
});

export type RubricYaml = z.infer<typeof RubricSchema>;
export type RubricInputYaml = z.infer<typeof RubricInputSchema>;

/**
 * The convergence contract between Stage-1 (symbolic) and Stage-2 (rubric):
 * every rubric verdict MUST emit `first_violating_step_id` so cross-finding
 * links can correlate rubric findings with the spans symbolic rules cite.
 *
 * Enforced as a YAML-load-time check rather than at runtime so authors
 * see the violation in `trace diagnose rules validate <path>`.
 */
const FIRST_VIOLATING_STEP_ID = "first_violating_step_id";

export const RuleSchema = z
  .object({
    schema_version: z.literal("diagnosis-rule/v1"),
    id: z.string().regex(/^[a-z][a-z0-9_]*$/),
    severity: z.enum(["low", "medium", "high"]),
    symptom: z.string().min(1),
    taxonomy: TaxonomySchema,
    suggested_fix: SuggestedFixSchema,
    verify_with: VerifyWithSchema,
    predicate: z.string().regex(/^builtin:[a-z][a-z0-9_]*$/).optional(),
    rubric: RubricSchema.optional(),
    params: z.record(z.string(), z.unknown()).default({}),
  })
  .refine(
    (r) => Boolean(r.predicate) !== Boolean(r.rubric),
    { message: "exactly one of `predicate` or `rubric` must be present" },
  )
  .refine(
    (r) => !r.rubric || r.rubric.output_schema.required.includes(FIRST_VIOLATING_STEP_ID),
    {
      message: `rubric.output_schema.required must include '${FIRST_VIOLATING_STEP_ID}' (Stage-1↔Stage-2 convergence contract)`,
      path: ["rubric", "output_schema", "required"],
    },
  );

export type RuleYaml = z.infer<typeof RuleSchema>;

const FindingSchema = z.object({
  rule_id: z.string(),
  judgment_kind: z.enum(["symbolic", "rubric"]),
  severity: z.enum(["low", "medium", "high"]),
  symptom: z.string(),
  likely_cause: z.string(),
  evidence: z.object({
    spans: z.array(z.string()),
    excerpt: z.string(),
  }),
  suggested_fix: z.object({
    target: z.string(),
    change: z.string(),
  }),
  // Symbolic findings always emit `low` (no semantic basis for higher).
  // Rubric agent supplies its own confidence; rule-loader propagates the
  // value the agent returned in the rubric output. Accept the union.
  confidence: z.enum(["low", "medium", "high"]),
  verify_with: z.object({
    suggested_eval_case: z.object({
      query_id: z.string().nullable(),
      query: z.string().nullable(),
      assertions: z.array(z.string()),
    }),
  }),
});

const SummarySchema = z.object({
  headline: z.string().max(160),
  primary_root_cause: z
    .object({
      finding_ids: z.array(z.number().int().nonnegative()).min(1),
      description: z.string(),
      target_for_fix: z.string(),
    })
    .nullable(),
  fix_priority: z.array(
    z.object({
      finding_id: z.number().int().nonnegative(),
      reason: z.string(),
    }),
  ),
  cross_finding_links: z.array(
    z.object({
      finding_ids: z.array(z.number().int().nonnegative()).min(2),
      relation: z.string(),
    }),
  ),
});

export const ReportSchema = z.object({
  schema_version: z.literal("trace-diagnose-report/v1"),
  trace: z.object({
    trace_id: z.string(),
    agent_id: z.string().nullable(),
    tenant: z.string().nullable(),
  }),
  run: z.object({
    diagnosed_at: z.string(),
    cli_version: z.string(),
    mode: z.enum(["symbolic-only", "rubric-only", "hybrid"]),
    rules_applied: z.array(z.string()),
    rules_skipped: z.array(
      z.object({ rule_id: z.string(), reason: z.string() }),
    ),
    synthesizer_mode: z.enum(["template", "agent"]),
  }),
  summary: SummarySchema,
  findings: z.array(FindingSchema),
});

export type ReportYaml = z.infer<typeof ReportSchema>;

/** The Summary section in isolation — exported so the agent synthesizer
 *  can validate its LLM output against the same shape the report uses. */
export const SummaryOutputSchema = SummarySchema;
export type SummaryOutput = z.infer<typeof SummaryOutputSchema>;
