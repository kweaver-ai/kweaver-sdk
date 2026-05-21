import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { ExperimentCoordinator } from "../src/trace-ai/exp/coordinator.js";
import type { TriageClient } from "../src/trace-ai/exp/coordinator.js";
import type { TriageResult } from "../src/trace-ai/exp/providers/triage-client.js";

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

const mockTriage: TriageClient = {
  async triage(): Promise<TriageResult> {
    return {
      verdict: "continue",
      summary: "mock",
      failure_attribution: [],
      diagnoses: [],
      hints: [],
      new_memory_token: "mem1",
      next_change: { target: "agent.system_prompt", hypothesis: "mock", patch: '{"agent":{"system_prompt":"mock prompt"}}' },
    };
  },
};

const mockEvalRunner = async () => ({ queryResults: [] });

test("coordinator: run transitions to Deciding after round 1", async () => {
  const dir = await makeExpDir();
  const coord = new ExperimentCoordinator({
    expDir: dir,
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

test("coordinator: Layer 2 auto-recovery — stuck Executing gets step_failed and redoes round", async () => {
  const dir = await makeExpDir();
  // Pre-seed: prior holder transitioned to Generating→Executing for round 1 then died
  // without writing step_failed (simulating SIGKILL/OOM/power-loss).
  const eventsPath = path.join(dir, ".trace-state", "events.jsonl");
  const events = [
    { ts: "2026-05-18T01:00:00.000Z", type: "state_transition", from: "Deciding", to: "Generating", round: 1 },
    { ts: "2026-05-18T01:00:00.001Z", type: "state_transition", from: "Generating", to: "Executing", round: 1 },
  ];
  await fs.writeFile(eventsPath, events.map(e => JSON.stringify(e)).join("\n") + "\n");

  let runEvalCalls = 0;
  const coord = new ExperimentCoordinator({
    expDir: dir,
    triage: mockTriage,
    runEval: async () => { runEvalCalls++; return { queryResults: [] }; },
  });

  await coord.run();

  const { replayState, readAllEvents } = await import("../src/trace-ai/exp/exp-store/events-jsonl.js");
  const allEvents = await readAllEvents(dir);
  const stepFailed = allEvents.find(e => e["type"] === "step_failed");
  assert.ok(stepFailed, "expected an auto-recovery step_failed event");
  assert.equal(stepFailed!["state"], "Executing");
  assert.match(String(stepFailed!["error"] ?? ""), /auto-recovered/);

  const state = await replayState(dir);
  assert.equal(runEvalCalls, 1, "runEval should have been called once for the redone round 1");
  assert.equal(state.currentState, "Deciding", "after redo, should pause at Deciding");
  assert.equal(state.currentRound, 1);
});

test("coordinator: Layer 2 — does NOT inject step_failed when one already exists", async () => {
  const dir = await makeExpDir();
  const eventsPath = path.join(dir, ".trace-state", "events.jsonl");
  const events = [
    { ts: "2026-05-18T01:00:00.000Z", type: "state_transition", from: "Deciding", to: "Generating", round: 1 },
    { ts: "2026-05-18T01:00:00.001Z", type: "state_transition", from: "Generating", to: "Executing", round: 1 },
    { ts: "2026-05-18T01:00:00.002Z", type: "step_failed", state: "Executing", error: "real failure", retryable: true },
  ];
  await fs.writeFile(eventsPath, events.map(e => JSON.stringify(e)).join("\n") + "\n");

  const coord = new ExperimentCoordinator({
    expDir: dir,
    triage: mockTriage,
    runEval: mockEvalRunner,
  });
  await coord.run();

  const { readAllEvents } = await import("../src/trace-ai/exp/exp-store/events-jsonl.js");
  const allEvents = await readAllEvents(dir);
  const stepFailedEvents = allEvents.filter(e => e["type"] === "step_failed");
  assert.equal(stepFailedEvents.length, 1, "should not have injected a second step_failed");
  assert.match(String(stepFailedEvents[0]!["error"] ?? ""), /real failure/);
});

test("coordinator: Layer 2 — terminal state refuses run (Aborted no longer special-cased)", async () => {
  const dir = await makeExpDir();
  const eventsPath = path.join(dir, ".trace-state", "events.jsonl");
  await fs.writeFile(eventsPath,
    JSON.stringify({ ts: "2026-05-18T01:00:00.000Z", type: "aborted", round: 1, reason: "user" }) + "\n"
  );
  const coord = new ExperimentCoordinator({
    expDir: dir, triage: mockTriage, runEval: mockEvalRunner,
  });
  await assert.rejects(() => coord.run(), /terminal state Aborted.*--new-run/);
});

test("coordinator: rejects next_change.target not in enabled_targets", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "coord-test-"));
  await fs.mkdir(path.join(dir, ".trace-state", "rounds"), { recursive: true });
  await fs.mkdir(path.join(dir, "candidates"), { recursive: true });
  await fs.mkdir(path.join(dir, "eval-sets", "v1"), { recursive: true });
  await fs.mkdir(path.join(dir, "outputs"), { recursive: true });
  await fs.writeFile(path.join(dir, ".trace-state", "events.jsonl"), "");
  await fs.writeFile(path.join(dir, "mission.md"), `---
schema_version: trace-mission/v1
goal: x
max_rounds: 1
enabled_targets: [skill.content]
eval_sets:
  - path: eval-sets/v1
    role: seed
current_candidate:
  path: candidates/baseline.yaml
next_change:
  target: agent.system_prompt
  hypothesis: x
  patch: '{"agent":{"system_prompt":"x"}}'
---
`);
  await fs.writeFile(path.join(dir, "candidates", "baseline.yaml"), "candidate_version: v0\nagent:\n  system_prompt: old\nskills: []\n");
  await fs.writeFile(path.join(dir, "eval-sets", "v1", "index.yaml"), "schema_version: trace-eval-set-index/v1\neval_set_id: x\nshards: []\n");

  const coord = new ExperimentCoordinator({ expDir: dir, triage: mockTriage, runEval: mockEvalRunner });
  await assert.rejects(() => coord.run(), /agent\.system_prompt.*enabled_targets.*skill\.content/);
});

test("coordinator: Layer 1 — installs and uninstalls signal handlers across run()", async () => {
  const dir = await makeExpDir();
  const sigs: NodeJS.Signals[] = ["SIGINT", "SIGHUP", "SIGTERM"];
  const before = Object.fromEntries(sigs.map(s => [s, process.listenerCount(s)]));

  const coord = new ExperimentCoordinator({
    expDir: dir, triage: mockTriage, runEval: mockEvalRunner,
  });
  await coord.run();

  for (const s of sigs) {
    assert.equal(process.listenerCount(s), before[s], `${s} listener count should be restored after run()`);
  }
});

function agentConfigBoundTo(kn: string): Record<string, unknown> {
  return {
    id: "test",
    key: "k",
    version: "v1",
    system_prompt: "x",
    llms: [{ is_default: true, llm_config: { name: "m", temperature: 0 } }],
    skills: {
      tools: [
        { tool_id: "t1", tool_box_id: "b1", tool_input: [{ input_name: "kn_id", map_value: kn }] },
      ],
    },
  };
}

test("coordinator: preflight KN mismatch → step_failed, eval not run", async () => {
  const dir = await makeExpDir();
  await fs.writeFile(
    path.join(dir, "eval-sets", "v1", "index.yaml"),
    "schema_version: trace-eval-set-index/v1\neval_set_id: test\nshards:\n  - path: cases.yaml\ntarget_kn: kn-correct\n",
  );
  let runEvalCalls = 0;
  const coord = new ExperimentCoordinator({
    expDir: dir,
    triage: mockTriage,
    runEval: async () => { runEvalCalls++; return { queryResults: [] }; },
    fetchAgentConfig: async () => agentConfigBoundTo("kn-wrong"),
  });

  await coord.run();

  const { readAllEvents } = await import("../src/trace-ai/exp/exp-store/events-jsonl.js");
  const events = await readAllEvents(dir);
  const stepFailed = events.find(e => e["type"] === "step_failed");
  assert.ok(stepFailed, "expected a preflight step_failed event");
  assert.equal(stepFailed!["state"], "Executing");
  assert.match(String(stepFailed!["error"] ?? ""), /preflight/);
  assert.equal(runEvalCalls, 0, "runEval must NOT run when preflight fails");
});

test("coordinator: preflight pass → fetches live agent and proceeds to Deciding", async () => {
  const dir = await makeExpDir();
  await fs.writeFile(
    path.join(dir, "eval-sets", "v1", "index.yaml"),
    "schema_version: trace-eval-set-index/v1\neval_set_id: test\nshards:\n  - path: cases.yaml\ntarget_kn: kn-right\n",
  );
  let runEvalCalls = 0;
  let fetchConfigCalls = 0;
  const coord = new ExperimentCoordinator({
    expDir: dir,
    triage: mockTriage,
    runEval: async () => { runEvalCalls++; return { queryResults: [] }; },
    fetchAgentConfig: async () => { fetchConfigCalls++; return agentConfigBoundTo("kn-right"); },
  });

  await coord.run();

  const { replayState } = await import("../src/trace-ai/exp/exp-store/events-jsonl.js");
  const state = await replayState(dir);
  assert.ok(fetchConfigCalls > 0, "preflight should have fetched the live agent config");
  assert.equal(runEvalCalls, 1, "runEval should run when preflight passes");
  assert.equal(state.currentState, "Deciding");
});

test("coordinator: fetchAgentConfig provided but candidate missing agent_id → step_failed", async () => {
  const dir = await makeExpDir();
  // candidate without a top-level agent_id — preflight cannot verify the agent
  await fs.writeFile(
    path.join(dir, "candidates", "baseline.yaml"),
    "candidate_version: v0\nagent:\n  system_prompt: old prompt\nskills: []\n",
  );
  let runEvalCalls = 0;
  const coord = new ExperimentCoordinator({
    expDir: dir,
    triage: mockTriage,
    runEval: async () => { runEvalCalls++; return { queryResults: [] }; },
    fetchAgentConfig: async () => agentConfigBoundTo("kn-x"),
  });

  await coord.run();

  const { readAllEvents } = await import("../src/trace-ai/exp/exp-store/events-jsonl.js");
  const events = await readAllEvents(dir);
  const stepFailed = events.find(e => e["type"] === "step_failed");
  assert.ok(stepFailed, "expected a step_failed when agent_id cannot be resolved");
  assert.match(String(stepFailed!["error"] ?? ""), /agent_id/);
  assert.equal(runEvalCalls, 0, "runEval must NOT run when preflight cannot resolve agent_id");
});
