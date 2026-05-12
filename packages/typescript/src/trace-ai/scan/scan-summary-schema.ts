// packages/typescript/src/trace-ai/scan/scan-summary-schema.ts
import { z } from "zod";

const PrimaryRootCauseShape = z.object({
  rule_ids: z.array(z.string()).min(1),
  description: z.string(),
  target_for_fix: z.string(),
});

const FixPriorityItemShape = z.object({
  rule_id: z.string(),
  affected_trace_count: z.number().int().nonnegative(),
  reason: z.string(),
});

const CrossRuleLinkShape = z.object({
  rule_ids: z.array(z.string()).min(2),
  relation: z.string(),
});

/**
 * The `summary` block shape — used both as the embedded field of the full
 * scan-summary report AND as the output schema the Stage-4 cross-trace
 * synthesizer LLM must satisfy.
 */
export const ScanSummaryShape = z.object({
  headline: z.string().max(160),
  primary_root_cause: PrimaryRootCauseShape.nullable(),
  fix_priority: z.array(FixPriorityItemShape),
  cross_rule_links: z.array(CrossRuleLinkShape),
});

export type ScanSummaryShape = z.infer<typeof ScanSummaryShape>;

const RuleFrequencyItemShape = z.object({
  rule_id: z.string(),
  count: z.number().int().nonnegative(),
  severity_breakdown: z.object({
    high: z.number().int().nonnegative(),
    medium: z.number().int().nonnegative(),
    low: z.number().int().nonnegative(),
  }),
});

const PerTraceIndexItemShape = z.object({
  trace_id: z.string(),
  conversation_id: z.string(),
  report_path: z.string(),
  finding_count: z.number().int().nonnegative(),
});

export const ScanSummarySchema = z.object({
  schema_version: z.literal("scan-summary/v1"),
  scan: z.object({
    agent_id: z.string().min(1),
    trace_count: z.number().int().nonnegative(),
    traces_with_findings: z.number().int().nonnegative(),
    traces_reused: z.number().int().nonnegative(),
    traces_freshly_diagnosed: z.number().int().nonnegative(),
    resumed_from_partial: z.boolean(),
    diagnosed_at: z.string(),
    cli_version: z.string(),
    synthesizer_mode: z.literal("agent"),
  }),
  summary: ScanSummaryShape.nullable(),
  aggregates: z.object({
    rule_frequency: z.array(RuleFrequencyItemShape),
  }),
  per_trace_index: z.array(PerTraceIndexItemShape),
});

export type ScanSummary = z.infer<typeof ScanSummarySchema>;
