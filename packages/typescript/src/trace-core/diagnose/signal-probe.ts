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
