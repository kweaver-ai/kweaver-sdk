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

// PR-A: only `predicate` branch (rubric XOR enforced in PR-B).
// We still encode the XOR shape so PR-B can enable rubric without breaking parsers.
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
    rubric: z.unknown().optional(),  // PR-B will define a real schema
    params: z.record(z.string(), z.unknown()).default({}),
  })
  .refine(
    (r) => Boolean(r.predicate) !== Boolean(r.rubric),
    { message: "exactly one of `predicate` or `rubric` must be present" },
  );

export type RuleYaml = z.infer<typeof RuleSchema>;

const FindingSchema = z.object({
  rule_id: z.string(),
  judgment_kind: z.enum(["symbolic"]),  // PR-B will add "rubric"
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
  confidence: z.literal("low"),
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
