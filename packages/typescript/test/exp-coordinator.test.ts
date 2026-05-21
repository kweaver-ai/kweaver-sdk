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

test("coordinator: mechanism failure (agent retrieved no KN data) → step_failed, triage skipped", async () => {
  const dir = await makeExpDir();
  // The trace shows every KN tool call erroring — the agent retrieved no data.
  // Triage must be skipped: the round measured a wiring failure, not the prompt.
  let triageCalled = false;
  const spyTriage: TriageClient = {
    async triage(): Promise<TriageResult> {
      triageCalled = true;
      return {
        verdict: "continue", summary: "x", failure_attribution: [], diagnoses: [], hints: [],
        new_memory_token: "m",
        next_change: { target: "agent.system_prompt", hypothesis: "h", patch: "{}" },
      };
    },
  };
  const failing = ["Q1", "Q2", "Q3"].map(id => ({
    query_id: id,
    assertion_results: [{ type: "semantic_match", verdict: "fail" as const, reason: "wrong answer" }],
    trajectory_summary: { tool_call_sequence: [], retry_count: 0, latency_ms: 0, error_codes: [] },
    conversation_id: `conv-${id}`,
  }));
  const errorResult = '{"answer": "data: {\\"error_code\\":\\"ObjectTypeNotFound\\"}\\n\\n"}';
  const coord = new ExperimentCoordinator({
    expDir: dir,
    triage: spyTriage,
    runEval: async () => ({ queryResults: failing }),
    fetchTrace: async () => ({
      spans: [{
        traceId: "t", spanId: "s", name: "execute_tool query_object_instance", startTime: "",
        status: { code: "Ok" },
        attributes: {
          "gen_ai.operation.name": "execute_tool",
          "gen_ai.tool.name": "query_object_instance",
          "gen_ai.tool.call.result": errorResult,
        },
      }],
    }),
  });

  await coord.run();

  const { readAllEvents } = await import("../src/trace-ai/exp/exp-store/events-jsonl.js");
  const events = await readAllEvents(dir);
  const stepFailed = events.find(e => e["type"] === "step_failed");
  assert.ok(stepFailed, "expected a mechanism step_failed event");
  assert.match(String(stepFailed!["error"] ?? ""), /mechanism/i);
  assert.equal(triageCalled, false, "triage LLM must be skipped when the mechanism is broken");
});

test("coordinator: a few no-data failures in an otherwise healthy round do NOT trip the mechanism guard", async () => {
  const dir = await makeExpDir();
  // 3 failing queries retrieved nothing, but a 4th query did retrieve KN data —
  // the round is healthy, the 3 are localized failures for triage to handle.
  let triageCalled = false;
  const spyTriage: TriageClient = {
    async triage(): Promise<TriageResult> {
      triageCalled = true;
      return {
        verdict: "continue", summary: "x", failure_attribution: [], diagnoses: [], hints: [],
        new_memory_token: "m",
        next_change: { target: "agent.system_prompt", hypothesis: "h", patch: "{}" },
      };
    },
  };
  const failing = ["Q1", "Q2", "Q3"].map(id => ({
    query_id: id,
    assertion_results: [{ type: "semantic_match", verdict: "fail" as const, reason: "wrong answer" }],
    trajectory_summary: { tool_call_sequence: [], retry_count: 0, latency_ms: 0, error_codes: [] },
    conversation_id: `conv-${id}`,
  }));
  const passing = {
    query_id: "Q4",
    assertion_results: [{ type: "semantic_match", verdict: "pass" as const, reason: "ok" }],
    trajectory_summary: { tool_call_sequence: [], retry_count: 0, latency_ms: 0, error_codes: [] },
    conversation_id: "conv-Q4",
  };
  const errorResult = '{"answer": "data: {\\"error_code\\":\\"ObjectTypeNotFound\\"}\\n\\n"}';
  const dataResult = '{"answer": {"datas": [{"r": 1}]}}';
  const span = (result: string) => ({
    traceId: "t", spanId: "s", name: "execute_tool query_object_instance", startTime: "",
    status: { code: "Ok" },
    attributes: {
      "gen_ai.operation.name": "execute_tool",
      "gen_ai.tool.name": "query_object_instance",
      "gen_ai.tool.call.result": result,
    },
  });
  const coord = new ExperimentCoordinator({
    expDir: dir,
    triage: spyTriage,
    runEval: async () => ({ queryResults: [...failing, passing] }),
    fetchTrace: async (id: string) => ({ spans: [span(id === "conv-Q4" ? dataResult : errorResult)] }),
  });

  await coord.run();

  const { readAllEvents } = await import("../src/trace-ai/exp/exp-store/events-jsonl.js");
  const events = await readAllEvents(dir);
  const mechFail = events.find(e => e["type"] === "step_failed" && /mechanism/i.test(String(e["error"] ?? "")));
  assert.equal(mechFail, undefined, "mechanism guard must not trip when the round did retrieve KN data");
  assert.equal(triageCalled, true, "triage must run for a healthy round with localized failures");
});
