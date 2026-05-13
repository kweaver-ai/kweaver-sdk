/**
 * M5 eval-set zod schemas (PR-A, MVP-B scope).
 *
 * 4 schemas in this file:
 *   - EvalSetIndexSchema:  trace-eval-set-index/v1   (eval-set dir's index.yaml)
 *   - EvalSetShardSchema:  trace-eval-set/v1         (final shard yaml file)
 *   - EvalSetInputSchema:  trace-eval-set-input/v1   (--queries simplified input)
 *   - TestReportSchema:    trace-test-report/v1      (test report; PR-A defines schema only;
 *                                                     PR-B consumer)
 *
 * EvalSetShardSchema and EvalSetInputSchema share the same refinement:
 *   "for each case, at least one of {reference, non-empty assertions} must be present."
 *
 * The D5 builtin rubric `answer-match-reference` output schema is NOT here —
 * it belongs to the rubric template definition (per spec doc §4.1).
 */

import { z } from "zod";

const InputSchema = z.object({
  user_message: z.string().min(1),
});

const ReferenceSchema = z.object({
  answer: z.string().min(1),
});

const AssertionSchema = z.object({
  type: z.enum([
    "contains",
    "not_contains",
    "regex",
    "tool_call_count",
    "tool_call_order",
    "semantic_match",
    "latency_ms",
  ]),
}).passthrough(); // allow type-specific fields (value, pattern, tool, op, n, ...)

// ── trace-eval-set-index/v1 ──────────────────────────────────────────────

const ShardRefSchema = z.object({
  path: z
    .string()
    .min(1)
    .refine((p) => !p.includes("..") && !p.startsWith("/"), {
      message: "shard path must be a relative path within the eval-set directory (no '..' / '/')",
    }),
  role: z.enum(["seed", "regression", "holdout"]).optional(),
});

export const EvalSetIndexSchema = z.object({
  schema_version: z.literal("trace-eval-set-index/v1"),
  eval_set_id: z.string().min(1),
  shards: z.array(ShardRefSchema).min(1),
});

// ── trace-eval-set/v1 ────────────────────────────────────────────────────

const refineCase = (
  data: { reference?: unknown; assertions?: unknown[] },
  ctx: z.RefinementCtx,
): void => {
  const hasReference = data.reference !== undefined && data.reference !== null;
  const hasAssertions = Array.isArray(data.assertions) && data.assertions.length > 0;
  if (!hasReference && !hasAssertions) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message:
        "each case must have either a 'reference' object or a non-empty 'assertions' array; both empty is not allowed (evaluator has no pass/fail signal)",
    });
  }
};

const FinalCaseSchema = z
  .object({
    query_id: z.string().min(1),
    input: InputSchema,
    reference: ReferenceSchema.optional(),
    assertions: z.array(AssertionSchema).optional(),
    tags: z.array(z.string()).optional(),
  })
  .superRefine(refineCase);

export const EvalSetShardSchema = z.object({
  schema_version: z.literal("trace-eval-set/v1"),
  cases: z.array(FinalCaseSchema).min(1),
});

// ── trace-eval-set-input/v1 (D1: same refinement as final) ───────────────

const InputCaseSchema = z
  .object({
    input: InputSchema,
    query_id: z.string().min(1).optional(),
    tags: z.array(z.string()).optional(),
    reference: ReferenceSchema.optional(),
    assertions: z.array(AssertionSchema).optional(),
  })
  .superRefine(refineCase);

export const EvalSetInputSchema = z.object({
  schema_version: z.literal("trace-eval-set-input/v1"),
  cases: z.array(InputCaseSchema).min(1),
});

// ── trace-test-report/v1 (PR-A defines; PR-B writes) ─────────────────────

const AssertionResultSchema = z.object({
  assertion: AssertionSchema,
  verdict: z.enum(["pass", "fail", "skip"]),
  actual: z.unknown().optional(),
});

const CaseResultSchema = z.object({
  query_id: z.string().min(1),
  status: z.enum(["pass", "fail", "error", "skip"]),
  conversation_id: z.string().nullable(),
  trace_id: z.string().nullable().optional(),
  duration_ms: z.number().nonnegative().optional(),
  assertion_results: z.array(AssertionResultSchema),
  failure_reason: z.string().optional(),
  error_code: z.string().optional(),
  error_message: z.string().optional(),
});

export const TestReportSchema = z.object({
  schema_version: z.literal("trace-test-report/v1"),
  meta: z.object({
    eval_set_dir: z.string().min(1),
    eval_set_id: z.string().min(1),
    candidate: z.object({
      agent_id: z.string().min(1),
      agent_version: z.string().optional(),
    }),
    cli_version: z.string().min(1),
    ran_at: z.string().min(1),
    duration_ms: z.number().nonnegative(),
  }),
  summary: z.object({
    total: z.number().int().nonnegative(),
    pass: z.number().int().nonnegative(),
    fail: z.number().int().nonnegative(),
    error: z.number().int().nonnegative(),
    skip: z.number().int().nonnegative(),
    by_assertion_type: z.record(z.string(), z.object({
      pass: z.number().int().nonnegative(),
      fail: z.number().int().nonnegative(),
    })),
  }),
  cases: z.array(CaseResultSchema),
});
