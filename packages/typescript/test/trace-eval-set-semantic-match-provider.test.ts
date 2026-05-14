import test from "node:test";
import assert from "node:assert/strict";

import { StubAgentProvider } from "../src/agent-providers/providers/stub.js";
import { PromptTemplateRegistry } from "../src/agent-providers/prompt-template.js";
import { AgentProviderError } from "../src/agent-providers/types.js";
import { createBuiltinSemanticMatchProvider } from "../src/trace-ai/eval-set/semantic-match-provider.js";

// ── helpers ───────────────────────────────────────────────────────────────────

function withInlineTemplate(): PromptTemplateRegistry {
  const reg = new PromptTemplateRegistry();
  // Mirrors the on-disk template's variable surface so the adapter's
  // render call exercises the real placeholders.
  reg.registerInline(
    "builtin:answer-match-reference",
    [
      "Question: {{question}}",
      "Reference: {{reference_answer}}",
      "Candidate: {{candidate_answer}}",
      "{{language_instruction}}",
      "Schema: {{output_schema}}",
    ].join("\n"),
  );
  return reg;
}

// ── pass / fail mapping ───────────────────────────────────────────────────────

test("createBuiltinSemanticMatchProvider: maps provider verdict=pass to SemanticMatchVerdict.pass", async () => {
  const stub = new StubAgentProvider({
    responses: [{ verdict: "pass", reasoning: "equivalent" }],
  });
  const smp = createBuiltinSemanticMatchProvider({
    provider: stub,
    promptRegistry: withInlineTemplate(),
  });

  const v = await smp.judgeSemanticMatch(
    "宁德时代属于哪个产业链？",
    "宁德时代属于汽车零部件板块",
    "宁德时代属于汽车零部件产业链",
  );
  assert.equal(v.verdict, "pass");
  assert.equal(v.reasoning, "equivalent");
  assert.equal(stub.calls.length, 1);
});

test("createBuiltinSemanticMatchProvider: maps provider verdict=fail to SemanticMatchVerdict.fail", async () => {
  const stub = new StubAgentProvider({
    responses: [{ verdict: "fail", reasoning: "missing key fact" }],
  });
  const smp = createBuiltinSemanticMatchProvider({
    provider: stub,
    promptRegistry: withInlineTemplate(),
  });

  const v = await smp.judgeSemanticMatch("Q", "candidate", "reference");
  assert.equal(v.verdict, "fail");
  assert.ok(v.reasoning.includes("missing key fact"));
});

// ── prompt rendering ──────────────────────────────────────────────────────────

test("createBuiltinSemanticMatchProvider: injects question / reference / candidate into the rendered prompt", async () => {
  let capturedPrompt = "";
  const stub = new StubAgentProvider({
    responseFn: (prompt) => {
      capturedPrompt = prompt;
      return { verdict: "pass", reasoning: "ok" };
    },
  });
  const smp = createBuiltinSemanticMatchProvider({
    provider: stub,
    promptRegistry: withInlineTemplate(),
  });

  await smp.judgeSemanticMatch("THE_QUESTION", "THE_CANDIDATE", "THE_REFERENCE");

  assert.ok(capturedPrompt.includes("Question: THE_QUESTION"), capturedPrompt);
  assert.ok(capturedPrompt.includes("Reference: THE_REFERENCE"), capturedPrompt);
  assert.ok(capturedPrompt.includes("Candidate: THE_CANDIDATE"), capturedPrompt);
  // output_schema is interpolated as a JSON blob (object → 2-space indent).
  assert.ok(capturedPrompt.includes("\"verdict\""), capturedPrompt);
});

test("createBuiltinSemanticMatchProvider: lang=zh emits the Simplified Chinese instruction in the prompt", async () => {
  let capturedPrompt = "";
  const stub = new StubAgentProvider({
    responseFn: (prompt) => {
      capturedPrompt = prompt;
      return { verdict: "pass", reasoning: "ok" };
    },
  });
  const smp = createBuiltinSemanticMatchProvider({
    provider: stub,
    promptRegistry: withInlineTemplate(),
    lang: "zh",
  });

  await smp.judgeSemanticMatch("Q", "C", "R");
  assert.ok(capturedPrompt.includes("Simplified Chinese"), capturedPrompt);
});

// ── schema enforcement (failure path) ─────────────────────────────────────────

test("createBuiltinSemanticMatchProvider: rejects provider output with wrong verdict enum (schema_violation)", async () => {
  const stub = new StubAgentProvider({
    responses: [{ verdict: "maybe", reasoning: "hedging" }],
  });
  const smp = createBuiltinSemanticMatchProvider({
    provider: stub,
    promptRegistry: withInlineTemplate(),
  });

  await assert.rejects(
    () => smp.judgeSemanticMatch("Q", "C", "R"),
    (err: unknown) => err instanceof AgentProviderError && err.kind === "schema_violation",
  );
});

// ── missing template ─────────────────────────────────────────────────────────

test("createBuiltinSemanticMatchProvider: missing prompt template throws a useful error", async () => {
  const stub = new StubAgentProvider({
    responses: [{ verdict: "pass", reasoning: "ok" }],
  });
  const emptyRegistry = new PromptTemplateRegistry();
  const smp = createBuiltinSemanticMatchProvider({
    provider: stub,
    promptRegistry: emptyRegistry,
  });

  await assert.rejects(
    () => smp.judgeSemanticMatch("Q", "C", "R"),
    /builtin:answer-match-reference/,
  );
});
