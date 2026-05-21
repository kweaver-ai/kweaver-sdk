/**
 * Internal types for the M5 eval-set module (PR-A).
 *
 * These mirror the zod schemas in `./schemas.ts` but are kept independent so
 * non-validating code paths (builder / picker / redactor / output-writer) can
 * import the types without paying the zod parse overhead at module load.
 */

export interface EvalCaseInput {
  user_message: string;
}

export interface EvalReference {
  answer: string;
}

export type AssertionType =
  | "contains"
  | "not_contains"
  | "regex"
  | "tool_call_count"
  | "tool_call_order"
  | "semantic_match"
  | "latency_ms";

export interface EvalAssertion {
  type: AssertionType;
  [key: string]: unknown;
}

export interface EvalCase {
  query_id: string;
  input: EvalCaseInput;
  reference?: EvalReference;
  assertions?: EvalAssertion[];
  tags?: string[];
}

export interface EvalSetIndexShard {
  path: string;
  role?: "seed" | "regression" | "holdout";
}

export interface EvalSetIndex {
  schema_version: "trace-eval-set-index/v1";
  eval_set_id: string;
  shards: EvalSetIndexShard[];
  /** KN id the reference answers were authored against (see EvalSetIndexSchema). */
  target_kn?: string;
}

export interface BuildResult {
  cases_written: number;
  cases_skipped: number;
  conflicts: string[];
  shard_paths: string[];
  redaction_rules_source: "cli-flag" | "repo" | "builtin";
}

export interface RedactionRule {
  name: string;
  pattern: RegExp;
  replace: string;
}
