import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { ExperimentCoordinator } from "../src/trace-ai/exp/coordinator.js";
import type { SynthesizerClient, TriageClient } from "../src/trace-ai/exp/coordinator.js";
import type { NextChange, RoundData } from "../src/trace-ai/exp/schemas.js";

const MISSION_CONTENT = `---
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
  hypothesis: test change
  patch: '{"agent":{"system_prompt":"new prompt"}}'
---
`;

async function makeExpDir(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "coord-test-"));
  await fs.mkdir(path.join(dir, ".trace-state", "rounds"), { recursive: true });
  await fs.mkdir(path.join(dir, "candidates"), { recursive: true });
  await fs.mkdir(path.join(dir, "eval-sets", "v1"), { recursive: true });
  await fs.mkdir(path.join(dir, "outputs"), { recursive: true });
  await fs.writeFile(path.join(dir, ".trace-state", "events.jsonl"), "");
  await fs.writeFile(path.join(dir, "mission.md"), MISSION_CONTENT);
  // Minimal baseline candidate
  await fs.writeFile(path.join(dir, "candidates", "baseline.yaml"), "agent_id: test\ncandidate_version: v0\nagent:\n  system_prompt: old prompt\nskills: []\n");
  // Minimal eval-set index
  await fs.writeFile(path.join(dir, "eval-sets", "v1", "index.yaml"), "schema_version: trace-eval-set-index/v1\neval_set_id: test\nshards: []\n");
  return dir;
}

const mockSynthesizer: SynthesizerClient = {
  async generate(): Promise<NextChange> {
    return { target: "agent.system_prompt", hypothesis: "mock", patch: '{"agent":{"system_prompt":"mock prompt"}}' };
  },
};

const mockTriage: TriageClient = {
  async triage(): Promise<RoundData["triage_conclusion"] & { new_memory_token: string }> {
    return { diagnoses: [], hints: [], verdict: "continue", cross_round_memory_ref: "mem1", new_memory_token: "mem1" };
  },
};

const mockEvalRunner = async () => ({ queryResults: [] });

test("coordinator: run transitions to Deciding after round 1", async () => {
  const dir = await makeExpDir();
  const coord = new ExperimentCoordinator({
    expDir: dir,
    synthesizer: mockSynthesizer,
    triage: mockTriage,
    runEval: mockEvalRunner,
  });

  await coord.run();  // should pause at Deciding

  const { replayState } = await import("../src/trace-ai/exp/exp-store/events-jsonl.js");
  const state = await replayState(dir);
  assert.equal(state.currentState, "Deciding");
  assert.equal(state.currentRound, 1);
});

test("coordinator: abort signal stops run", async () => {
  const dir = await makeExpDir();
  const coord = new ExperimentCoordinator({
    expDir: dir,
    synthesizer: mockSynthesizer,
    triage: { async triage() { throw new Error("should not reach triage"); } },
    runEval: async () => {
      // Write abort signal mid-execution
      await fs.writeFile(path.join(dir, ".trace-state", "abort.signal"), "");
      return { queryResults: [] };
    },
  });

  await coord.run();
  const { replayState } = await import("../src/trace-ai/exp/exp-store/events-jsonl.js");
  const state = await replayState(dir);
  assert.equal(state.currentState, "Aborted");
});
