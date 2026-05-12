import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { loadRules, RuleLoadError } from "../src/trace-ai/diagnose/rule-loader.js";
import {
  registerPredicate,
  clearRegistry,
} from "../src/trace-ai/diagnose/predicate-registry.js";
import type { Predicate } from "../src/trace-ai/diagnose/types.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIX = path.join(__dirname, "fixtures/trace-diagnose");

test("loadRules: loads a single valid rule yaml and resolves its predicate", async () => {
  clearRegistry();
  const fn: Predicate = () => [];
  registerPredicate("r_one", fn);
  const rules = await loadRules({
    builtinDir: null,
    cwdRulesDir: path.join(FIX, "rules-good"),
    extraRulesDir: null,
    noBuiltin: true,
  });
  assert.equal(rules.length, 1);
  assert.equal(rules[0].id, "r_one");
  assert.equal(rules[0].predicateRef, "builtin:r_one");
});

test("loadRules: rejects yaml with missing taxonomy", async () => {
  clearRegistry();
  registerPredicate("r_bad", (() => []) as Predicate);
  await assert.rejects(
    () => loadRules({
      builtinDir: null,
      cwdRulesDir: path.join(FIX, "rules-bad"),
      extraRulesDir: null,
      noBuiltin: true,
    }),
    (e: unknown) => e instanceof RuleLoadError && /taxonomy/.test((e as Error).message),
  );
});

test("loadRules: name conflict between two dirs fails fast", async () => {
  clearRegistry();
  registerPredicate("r_one", (() => []) as Predicate);
  await assert.rejects(
    () => loadRules({
      builtinDir: path.join(FIX, "rules-good"),
      cwdRulesDir: path.join(FIX, "rules-good"),  // same dir → forces conflict
      extraRulesDir: null,
      noBuiltin: false,
    }),
    (e: unknown) => e instanceof RuleLoadError && /conflict/.test((e as Error).message),
  );
});

test("loadRules: unknown predicate ref fails at load time", async () => {
  clearRegistry();
  // do NOT register r_one
  await assert.rejects(
    () => loadRules({
      builtinDir: null,
      cwdRulesDir: path.join(FIX, "rules-good"),
      extraRulesDir: null,
      noBuiltin: true,
    }),
    (e: unknown) => e instanceof RuleLoadError && /predicate not registered/.test((e as Error).message),
  );
});

test("loadRules: noBuiltin=true skips builtinDir entirely", async () => {
  clearRegistry();
  const rules = await loadRules({
    builtinDir: path.join(FIX, "rules-good"),
    cwdRulesDir: null,
    extraRulesDir: null,
    noBuiltin: true,
  });
  assert.equal(rules.length, 0);
});
