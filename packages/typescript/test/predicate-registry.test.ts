import test from "node:test";
import assert from "node:assert/strict";

import {
  registerPredicate,
  resolvePredicate,
  clearRegistry,
  PredicateNotFoundError,
} from "../src/trace-ai/diagnose/predicate-registry.js";
import type { Hit, Predicate, TraceTree } from "../src/trace-ai/diagnose/types.js";

test("registerPredicate + resolvePredicate round-trip", () => {
  clearRegistry();
  const fn: Predicate = () => [];
  registerPredicate("dummy", fn);
  assert.strictEqual(resolvePredicate("builtin:dummy"), fn);
});

test("resolvePredicate throws PredicateNotFoundError for unknown name", () => {
  clearRegistry();
  assert.throws(
    () => resolvePredicate("builtin:no_such"),
    (e: unknown) => e instanceof PredicateNotFoundError,
  );
});

test("resolvePredicate rejects non-builtin: prefix", () => {
  clearRegistry();
  assert.throws(
    () => resolvePredicate("custom-ts:./foo.ts"),
    /unsupported predicate scheme/,
  );
});

test("registerPredicate twice throws (no silent override)", () => {
  clearRegistry();
  registerPredicate("dup", (() => []) as Predicate);
  assert.throws(
    () => registerPredicate("dup", (() => []) as Predicate),
    /already registered/,
  );
});
