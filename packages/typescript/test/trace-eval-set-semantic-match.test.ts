import test from "node:test";
import assert from "node:assert/strict";

import { evaluateAssertion } from "../src/trace-ai/eval-set/assertion-evaluator.js";
import type { AssertionContext, SemanticMatchProvider } from "../src/trace-ai/eval-set/assertion-evaluator.js";

// ── mock provider ─────────────────────────────────────────────────────────────

function mockProvider(verdict: "pass" | "fail"): SemanticMatchProvider {
  return {
    async judgeSemanticMatch(_question, _candidate, _reference) {
      return { verdict, reasoning: `mock: ${verdict}` };
    },
  };
}

function baseCtx(overrides: Partial<AssertionContext> = {}): AssertionContext {
  return {
    answer: "default answer",
    spans: [],
    reference: { answer: "reference answer" },
    ...overrides,
  };
}

// ── semantic_match ────────────────────────────────────────────────────────────

test("semantic_match: pass when provider returns pass", async () => {
  const result = await evaluateAssertion(
    {
      type: "semantic_match",
      rubric_template_ref: "builtin:answer-match-reference",
    },
    baseCtx({
      answer: "宁德时代属于汽车零部件板块",
      reference: { answer: "宁德时代属于汽车零部件产业链" },
      semanticMatchProvider: mockProvider("pass"),
    }),
  );
  assert.equal(result.verdict, "pass");
  assert.ok(String(result.actual).includes("mock: pass"));
});

test("semantic_match: fail when provider returns fail", async () => {
  const result = await evaluateAssertion(
    {
      type: "semantic_match",
      rubric_template_ref: "builtin:answer-match-reference",
    },
    baseCtx({
      answer: "宁德时代属于汽车零部件板块",
      reference: { answer: "宁德时代属于汽车零部件产业链" },
      semanticMatchProvider: mockProvider("fail"),
    }),
  );
  assert.equal(result.verdict, "fail");
});

test("semantic_match: skip when no provider supplied", async () => {
  const result = await evaluateAssertion(
    {
      type: "semantic_match",
      rubric_template_ref: "builtin:answer-match-reference",
    },
    baseCtx({ semanticMatchProvider: undefined }),
  );
  assert.equal(result.verdict, "skip");
  assert.ok(String(result.reason).includes("provider"));
});

test("semantic_match: assertion.question takes precedence over ctx.question", async () => {
  let seenQuestion = "";
  const provider: SemanticMatchProvider = {
    async judgeSemanticMatch(q, _c, _r) {
      seenQuestion = q;
      return { verdict: "pass", reasoning: "ok" };
    },
  };
  await evaluateAssertion(
    { type: "semantic_match", question: "explicit-from-assertion" },
    baseCtx({ question: "fallback-from-ctx", semanticMatchProvider: provider }),
  );
  assert.equal(seenQuestion, "explicit-from-assertion");
});

test("semantic_match: falls back to ctx.question when assertion.question is absent", async () => {
  let seenQuestion = "";
  const provider: SemanticMatchProvider = {
    async judgeSemanticMatch(q, _c, _r) {
      seenQuestion = q;
      return { verdict: "pass", reasoning: "ok" };
    },
  };
  await evaluateAssertion(
    { type: "semantic_match" },
    baseCtx({ question: "user-message-from-case", semanticMatchProvider: provider }),
  );
  assert.equal(seenQuestion, "user-message-from-case");
});

test("semantic_match: skip when reference.answer is missing", async () => {
  const result = await evaluateAssertion(
    {
      type: "semantic_match",
      rubric_template_ref: "builtin:answer-match-reference",
    },
    baseCtx({
      reference: undefined,
      semanticMatchProvider: mockProvider("pass"),
    }),
  );
  assert.equal(result.verdict, "skip");
  assert.ok(String(result.reason).includes("reference"));
});
