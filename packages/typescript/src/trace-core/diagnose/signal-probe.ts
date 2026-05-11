/**
 * Stage-1 (symbolic) runner. Rubric rules are handled separately in
 * `agent-binding.ts` and merged into the findings list by `index.ts`.
 *
 * Rationale for keeping the split here: symbolic predicates are cheap,
 * deterministic, sync; rubric judgments are slow, non-deterministic,
 * async. Running them in one loop would entangle backpressure,
 * timeout, and retry concerns that only apply to one of the two paths.
 */

import { resolvePredicate } from "./predicate-registry.js";
import type { Hit, Rule, TraceTree } from "./types.js";

export class RuleProbeError extends Error {
  constructor(ruleId: string, cause: Error) {
    super(`predicate failed for rule '${ruleId}': ${cause.message}`);
    this.name = "RuleProbeError";
  }
}

export async function runRules(rules: Rule[], tree: TraceTree): Promise<Map<string, Hit[]>> {
  const out = new Map<string, Hit[]>();
  for (const rule of rules) {
    if (!rule.predicateRef) continue;  // rubric rule — handled by agent-binding
    const fn = resolvePredicate(rule.predicateRef);
    try {
      const hits = fn(tree, rule.params);
      out.set(rule.id, hits);
    } catch (e) {
      throw new RuleProbeError(rule.id, e as Error);
    }
  }
  return out;
}

/** Helpers that split a rule list by which stage owns them. */
export function symbolicRules(rules: Rule[]): Rule[] {
  return rules.filter((r) => r.predicateRef !== null);
}

export function rubricRules(rules: Rule[]): Rule[] {
  return rules.filter((r) => r.rubric !== null);
}
