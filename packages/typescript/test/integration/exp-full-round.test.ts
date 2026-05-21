// test/integration/exp-full-round.test.ts
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { ExperimentCoordinator } from "../../src/trace-ai/exp/coordinator.js";
import { replayState } from "../../src/trace-ai/exp/exp-store/events-jsonl.js";
import type { TriageResult } from "../../src/trace-ai/exp/providers/triage-client.js";

async function makeExpDir() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "exp-integration-"));
  await fs.mkdir(path.join(dir, ".trace-state", "rounds"), { recursive: true });
  await fs.mkdir(path.join(dir, "candidates"), { recursive: true });
  await fs.mkdir(path.join(dir, "eval-sets", "v1"), { recursive: true });
  await fs.mkdir(path.join(dir, "outputs"), { recursive: true });
  await fs.writeFile(path.join(dir, ".trace-state", "events.jsonl"), "");
  await fs.writeFile(path.join(dir, "mission.md"), `---
schema_version: trace-mission/v1
goal: reduce retries
max_rounds: 2
eval_sets:
  - path: eval-sets/v1
    role: seed
current_candidate:
  path: candidates/baseline.yaml
next_change:
  target: agent.system_prompt
  hypothesis: add stop condition
  patch: '{"agent":{"system_prompt":"New prompt with stop condition."}}'
---
`);
  await fs.writeFile(path.join(dir, "candidates", "baseline.yaml"), "agent_id: test\ncandidate_version: v0\nagent:\n  system_prompt: hello\nskills: []\n");
  await fs.writeFile(path.join(dir, "eval-sets", "v1", "index.yaml"), "schema_version: trace-eval-set-index/v1\neval_set_id: test_v1\nshards: []\n");
  return dir;
}

test("full round: Deciding pause after round 1", async () => {
  const dir = await makeExpDir();
  try {
    const coord = new ExperimentCoordinator({
      expDir: dir,
      // Merged Triage+Synthesizer: triage() produces next_change in the same call.
      triage: {
        async triage(): Promise<TriageResult> {
          return {
            verdict: "continue",
            summary: "mock triage",
            failure_attribution: [],
            diagnoses: ["ok"],
            hints: ["try x"],
            new_memory_token: "mem1",
            next_change: { target: "agent.system_prompt", hypothesis: "mock", patch: '{"agent":{"system_prompt":"next"}}' },
          };
        },
      },
      runEval: async () => ({ queryResults: [] }),
    });

    await coord.run();

    const state = await replayState(dir);
    assert.equal(state.currentState, "Deciding");

    // Candidate v1 created
    await fs.access(path.join(dir, "candidates", "candidate-v1.yaml"));

    // round-1.yaml written
    await fs.access(path.join(dir, ".trace-state", "rounds", "round-1.yaml"));
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test("full round: publishes at max_rounds", async () => {
  const dir = await makeExpDir();
  try {
    // max_rounds: 2, set verdict to continue so max_rounds triggers publish
    const coord = new ExperimentCoordinator({
      expDir: dir,
      // Merged Triage+Synthesizer: continue (with next_change) at round 1, publish at round 2.
      triage: {
        async triage(input): Promise<TriageResult> {
          if (input.currentRound.round >= 2) {
            return { verdict: "publish", summary: "done", failure_attribution: [], diagnoses: [], hints: [], new_memory_token: "m" };
          }
          return {
            verdict: "continue",
            summary: "round 1",
            failure_attribution: [],
            diagnoses: [],
            hints: [],
            new_memory_token: "m",
            next_change: { target: "agent.system_prompt", hypothesis: "m", patch: '{"agent":{"system_prompt":"p"}}' },
          };
        },
      },
      runEval: async () => ({ queryResults: [] }),
    });

    await coord.run();         // round 1 → Deciding
    await coord.resume();      // round 2 → publish verdict → Published

    const state = await replayState(dir);
    assert.equal(state.currentState, "Published");

    // outputs written
    await fs.access(path.join(dir, "outputs", "bundle.yaml"));
    await fs.access(path.join(dir, "outputs", "manifest.yaml"));
    await fs.access(path.join(dir, "outputs", "provenance.yaml"));
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});
