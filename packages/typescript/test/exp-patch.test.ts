import test from "node:test";
import assert from "node:assert/strict";
import { applyPatch } from "../src/trace-ai/exp/patch/index.js";

const baseCandidate = {
  candidate_version: "v0",
  agent: { model: "claude-sonnet-4-6", temperature: 0.3, system_prompt: "You are an agent." },
  skills: [{ name: "retrieval_v1" }],
};

test("applyPatch: agent.system_prompt replacement", () => {
  const result = applyPatch(baseCandidate, {
    target: "agent.system_prompt",
    hypothesis: "new prompt",
    patch: JSON.stringify({ agent: { system_prompt: "New prompt text." } }),
  });
  assert.equal(result.agent.system_prompt, "New prompt text.");
  assert.equal(result.agent.model, "claude-sonnet-4-6");  // unchanged
});

test("applyPatch: agent.temperature change", () => {
  const result = applyPatch(baseCandidate, {
    target: "agent.temperature",
    hypothesis: "lower temp",
    patch: JSON.stringify({ agent: { temperature: 0.1 } }),
  });
  assert.equal(result.agent.temperature, 0.1);
});

test("applyPatch: skill.add", () => {
  const result = applyPatch(baseCandidate, {
    target: "skill.add",
    hypothesis: "add summarize skill",
    patch: JSON.stringify({ skills: { add: [{ name: "summarize_v2" }] } }),
  });
  assert.equal(result.skills.length, 2);
  assert.ok(result.skills.some((s: { name: string }) => s.name === "summarize_v2"));
});

test("applyPatch: skill.remove", () => {
  const result = applyPatch(baseCandidate, {
    target: "skill.remove",
    hypothesis: "remove retrieval",
    patch: JSON.stringify({ skills: { remove: ["retrieval_v1"] } }),
  });
  assert.equal(result.skills.length, 0);
});

test("applyPatch: skill.swap", () => {
  const result = applyPatch(baseCandidate, {
    target: "skill.swap",
    hypothesis: "swap retrieval for retrieval_v2",
    patch: JSON.stringify({ skills: { swap: { from: "retrieval_v1", to: { name: "retrieval_v2" } } } }),
  });
  assert.equal(result.skills.length, 1);
  assert.ok(result.skills.some((s: { name: string }) => s.name === "retrieval_v2"));
  assert.ok(!result.skills.some((s: { name: string }) => s.name === "retrieval_v1"));
});

test("applyPatch: skill.swap throws when skill not found", () => {
  assert.throws(
    () => applyPatch(baseCandidate, {
      target: "skill.swap",
      hypothesis: "swap nonexistent",
      patch: JSON.stringify({ skills: { swap: { from: "nonexistent_skill", to: { name: "new_skill" } } } }),
    }),
    /not found/i
  );
});

test("applyPatch: throws for unknown target prefix", () => {
  assert.throws(
    () => applyPatch(baseCandidate, { target: "bkn.entity", hypothesis: "x", patch: "{}" }),
    /unsupported.*target/i
  );
});
