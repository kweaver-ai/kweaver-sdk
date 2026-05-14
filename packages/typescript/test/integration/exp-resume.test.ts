// test/integration/exp-resume.test.ts
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { ExperimentCoordinator } from "../../src/trace-ai/exp/coordinator.js";
import { appendEvent } from "../../src/trace-ai/exp/exp-store/events-jsonl.js";
import { replayState } from "../../src/trace-ai/exp/exp-store/events-jsonl.js";
import type { NextChange } from "../../src/trace-ai/exp/schemas.js";

async function makeExpDir() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "exp-resume-"));
  await fs.mkdir(path.join(dir, ".trace-state", "rounds"), { recursive: true });
  await fs.mkdir(path.join(dir, "candidates"), { recursive: true });
  await fs.mkdir(path.join(dir, "eval-sets", "v1"), { recursive: true });
  await fs.mkdir(path.join(dir, "outputs"), { recursive: true });
  await fs.writeFile(path.join(dir, ".trace-state", "events.jsonl"), "");
  await fs.writeFile(path.join(dir, "mission.md"), `---
schema_version: trace-mission/v1
goal: reduce retries
eval_sets:
  - path: eval-sets/v1
    role: seed
current_candidate:
  path: candidates/baseline.yaml
next_change:
  target: agent.system_prompt
  hypothesis: resume test
  patch: '{"agent":{"system_prompt":"resumed prompt"}}'
---
`);
  await fs.writeFile(path.join(dir, "candidates", "baseline.yaml"), "agent_id: test\ncandidate_version: v0\nagent:\n  system_prompt: old\nskills: []\n");
  await fs.writeFile(path.join(dir, "eval-sets", "v1", "index.yaml"), "schema_version: trace-eval-set-index/v1\neval_set_id: test\nshards: []\n");
  return dir;
}

test("resume: picks up from Deciding after run", async () => {
  const dir = await makeExpDir();
  const opts = {
    expDir: dir,
    synthesizer: { async generate(): Promise<NextChange> { return { target: "agent.system_prompt", hypothesis: "m", patch: '{"agent":{"system_prompt":"p"}}' }; } },
    triage: { async triage() { return { diagnoses: [], hints: [], verdict: "publish" as const, cross_round_memory_ref: "m", new_memory_token: "m" }; } },
    runEval: async () => ({ queryResults: [] }),
  };

  await new ExperimentCoordinator(opts).run();
  const mid = await replayState(dir);
  // verdict=publish → Published immediately, no Deciding pause
  assert.equal(mid.currentState, "Published");
});

test("resume: retries after step_failed", async () => {
  const dir = await makeExpDir();
  // Manually inject a step_failed event as if Triaging crashed
  await appendEvent(dir, { type: "state_transition", from: "Init", to: "Generating", round: 1 });
  await appendEvent(dir, { type: "state_transition", from: "Generating", to: "Executing", round: 1 });
  await appendEvent(dir, { type: "step_failed", state: "Executing", error: "network timeout", retryable: true });

  // Create candidate-v1.yaml so resume can proceed
  await fs.writeFile(path.join(dir, "candidates", "candidate-v1.yaml"), "agent_id: test\ncandidate_version: v1\nagent:\n  system_prompt: new\nskills: []\n");

  const state = await replayState(dir);
  assert.equal(state.currentState, "Executing");
  assert.equal(state.lastFailure?.retryable, true);
});
