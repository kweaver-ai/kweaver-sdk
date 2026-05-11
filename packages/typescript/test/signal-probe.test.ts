import test from "node:test";
import assert from "node:assert/strict";

import { runRules } from "../src/trace-core/diagnose/signal-probe.js";
import {
  registerPredicate,
  clearRegistry,
} from "../src/trace-core/diagnose/predicate-registry.js";
import type { Hit, Predicate, Rule, TraceTree } from "../src/trace-core/diagnose/types.js";

const tree: TraceTree = {
  traceId: "tr_x",
  spans: [],
  byId: new Map(),
  parentToChildren: new Map(),
  byKind: new Map(),
  root: null,
};

const ruleFor = (id: string, predicateRef: string): Rule => ({
  schemaVersion: "diagnosis-rule/v1",
  id,
  severity: "high",
  symptom: "s",
  taxonomy: { signalsAxis: "execution", msClass: "retry_loop" },
  suggestedFix: { target: "t", changeTemplate: "c" },
  verifyWith: { assertionTemplates: [] },
  predicateRef,
  params: {},
  sourcePath: `mem:${id}`,
});

test("runRules: invokes each rule's predicate and groups hits by rule_id", async () => {
  clearRegistry();
  registerPredicate("a", (() => [{ evidenceSpans: ["s1"], excerpt: "x", bindings: {} }]) as Predicate);
  registerPredicate("b", (() => []) as Predicate);

  const ruleA = ruleFor("a", "builtin:a");
  const ruleB = ruleFor("b", "builtin:b");
  const out = await runRules([ruleA, ruleB], tree);

  assert.equal(out.size, 2);
  assert.equal(out.get("a")?.length, 1);
  assert.equal(out.get("b")?.length, 0);
});

test("runRules: passes rule.params through to the predicate", async () => {
  clearRegistry();
  let seenParams: Record<string, unknown> | undefined;
  registerPredicate("p", ((_t, params) => {
    seenParams = params;
    return [];
  }) as Predicate);
  const r = ruleFor("p", "builtin:p");
  r.params = { threshold: 5 };
  await runRules([r], tree);
  assert.deepEqual(seenParams, { threshold: 5 });
});

test("runRules: predicate throws → wraps into RuleProbeError naming the rule_id", async () => {
  clearRegistry();
  registerPredicate("x", (() => { throw new Error("boom"); }) as Predicate);
  const r = ruleFor("x", "builtin:x");
  await assert.rejects(
    () => runRules([r], tree),
    /predicate failed for rule 'x': boom/,
  );
});
