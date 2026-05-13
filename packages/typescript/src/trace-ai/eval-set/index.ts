/**
 * M5 eval-set module — public exports.
 *
 * Consumers (commands/trace.ts, tests, future M6 reuse) import from this
 * barrel; internal modules cross-import via direct paths.
 */

export type {
  EvalCase,
  EvalCaseInput,
  EvalReference,
  EvalAssertion,
  AssertionType,
  EvalSetIndex,
  EvalSetIndexShard,
  BuildResult,
  RedactionRule,
} from "./types.js";
