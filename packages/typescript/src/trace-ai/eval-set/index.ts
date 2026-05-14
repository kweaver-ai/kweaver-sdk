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

export { build, ensureQueryId, BuilderError } from "./builder.js";
export type { BuildOpts, BuildSource } from "./builder.js";
export { run as runTest } from "./test-runner.js";
export type { RunOpts, RunnerDeps } from "./test-runner.js";
export { evaluateAssertion } from "./assertion-evaluator.js";
export type {
  AssertionContext,
  AssertionResult,
  SemanticMatchProvider,
  SemanticMatchVerdict,
} from "./assertion-evaluator.js";
export {
  createBuiltinSemanticMatchProvider,
  ANSWER_MATCH_REFERENCE_REF,
  AnswerMatchOutputSchema,
} from "./semantic-match-provider.js";
export type { CreateSemanticMatchProviderOpts } from "./semantic-match-provider.js";
