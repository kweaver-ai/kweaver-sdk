// test/exp-info.test.ts
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";

const MISSION_CONTENT = `---
schema_version: trace-mission/v1
goal: reduce retries
eval_sets:
  - path: eval-sets/v1
    role: seed
current_candidate:
  path: candidates/baseline.yaml
---
`;

async function makeExpDir(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "exp-info-"));
  await fs.mkdir(path.join(dir, ".trace-state", "rounds"), { recursive: true });
  await fs.mkdir(path.join(dir, "candidates"), { recursive: true });
  await fs.mkdir(path.join(dir, "eval-sets", "v1"), { recursive: true });
  await fs.writeFile(path.join(dir, ".trace-state", "events.jsonl"), "");
  await fs.writeFile(path.join(dir, "mission.md"), MISSION_CONTENT);
  await fs.writeFile(path.join(dir, "candidates", "baseline.yaml"), "agent_id: test\n");
  await fs.writeFile(path.join(dir, "eval-sets", "v1", "index.yaml"), "schema_version: trace-eval-set-index/v1\neval_set_id: test\nshards: []\n");
  return dir;
}

test("getHealthChecks: all pass on valid experiment dir", async () => {
  const dir = await makeExpDir();
  const { getHealthChecks } = await import("../src/trace-ai/exp/info.js");
  const health = await getHealthChecks(dir);
  assert.equal(health.mission_valid, true);
  assert.equal(health.eval_set_valid, true);
  assert.equal(health.candidate_readable, true);
  assert.equal(health.no_step_failed, true);
  assert.equal(typeof health.provider_available, "boolean");
});

test("getHealthChecks: mission_valid=false when mission.md missing", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "exp-info-nomission-"));
  await fs.mkdir(path.join(dir, ".trace-state"), { recursive: true });
  await fs.writeFile(path.join(dir, ".trace-state", "events.jsonl"), "");
  const { getHealthChecks } = await import("../src/trace-ai/exp/info.js");
  const health = await getHealthChecks(dir);
  assert.equal(health.mission_valid, false);
  assert.equal(health.eval_set_valid, false);
  assert.equal(health.candidate_readable, false);
});

test("getHealthChecks: no_step_failed=false when step_failed in events", async () => {
  const dir = await makeExpDir();
  const eventsPath = path.join(dir, ".trace-state", "events.jsonl");
  await fs.appendFile(eventsPath, JSON.stringify({ ts: new Date().toISOString(), type: "step_failed", state: "Generating", error: "timeout", retryable: true }) + "\n");
  const { getHealthChecks } = await import("../src/trace-ai/exp/info.js");
  const health = await getHealthChecks(dir);
  assert.equal(health.no_step_failed, false);
});

test("buildExpSnapshot: returns correct shape for fresh experiment", async () => {
  const dir = await makeExpDir();
  const { buildExpSnapshot } = await import("../src/trace-ai/exp/info.js");
  const snap = await buildExpSnapshot(dir);
  assert.equal(snap.workspace, dir);
  assert.equal(snap.state, "Init");
  assert.equal(snap.round, 0);
  assert.equal(snap.scores, null);
  assert.equal(snap.triage_summary, null);
  assert.equal(snap.suggested_next, null);
  assert.equal(snap.lineage_versions, 0);
  assert.equal(typeof snap.health.mission_valid, "boolean");
});

test("buildExpSnapshot: picks up scores from last round", async () => {
  const dir = await makeExpDir();
  const { ExpStore } = await import("../src/trace-ai/exp/exp-store/index.js");
  const store = new ExpStore(dir);
  await store.writeRound(1, {
    round: 1,
    trial_version: 1,
    scores: { outcome: 0.85, trajectory: 0.9, guardrail: 1.0, guardrail_hard_fail: false },
    triage_conclusion: { diagnoses: ["retry too high"], hints: [], verdict: "continue" },
  });
  const { buildExpSnapshot } = await import("../src/trace-ai/exp/info.js");
  const snap = await buildExpSnapshot(dir);
  assert.ok(snap.scores !== null);
  assert.equal(snap.scores!.outcome, 0.85);
  assert.equal(snap.triage_summary, "retry too high");
});

test("buildExpSnapshot: picks up suggested_next from mission next_change", async () => {
  const dir = await makeExpDir();
  const missionWithChange = `---
schema_version: trace-mission/v1
goal: reduce retries
eval_sets:
  - path: eval-sets/v1
    role: seed
current_candidate:
  path: candidates/baseline.yaml
next_change:
  target: agent.system_prompt
  hypothesis: try shorter prompt
  patch: '{"agent":{"system_prompt":"short"}}'
---
`;
  await fs.writeFile(path.join(dir, "mission.md"), missionWithChange);
  const { buildExpSnapshot } = await import("../src/trace-ai/exp/info.js");
  const snap = await buildExpSnapshot(dir);
  assert.ok(snap.suggested_next !== null);
  assert.equal(snap.suggested_next!.target, "agent.system_prompt");
  assert.equal(snap.suggested_next!.hypothesis, "try shorter prompt");
});

test("formatSnapshotYaml: output contains key fields", async () => {
  const dir = await makeExpDir();
  const { buildExpSnapshot, formatSnapshotYaml } = await import("../src/trace-ai/exp/info.js");
  const snap = await buildExpSnapshot(dir);
  const out = formatSnapshotYaml(snap);
  assert.ok(out.includes("workspace:"));
  assert.ok(out.includes("state:"));
  assert.ok(out.includes("round:"));
  assert.ok(out.includes("health:"));
});

test("runList: prints (missing) row for nonexistent path", async () => {
  const { runList } = await import("../src/trace-ai/exp/info.js");
  const chunks: string[] = [];
  const orig = process.stdout.write.bind(process.stdout);
  (process.stdout as any).write = (chunk: string | Uint8Array): boolean => { chunks.push(String(chunk)); return true; };
  try {
    await runList([{ path: "/definitely/does/not/exist", last_active_ts: "2026-05-15T10:00:00.000Z" }]);
  } finally {
    (process.stdout as any).write = orig;
  }
  const output = chunks.join("");
  assert.ok(output.includes("(missing)"), `Expected (missing) in output: ${output}`);
});

test("runInfo: outputs yaml for a valid experiment dir", async () => {
  const dir = await makeExpDir();
  const { runInfo } = await import("../src/trace-ai/exp/info.js");
  const chunks: string[] = [];
  const orig = process.stdout.write.bind(process.stdout);
  (process.stdout as any).write = (chunk: string | Uint8Array): boolean => { chunks.push(String(chunk)); return true; };
  try {
    await runInfo(dir);
  } finally {
    (process.stdout as any).write = orig;
  }
  const output = chunks.join("");
  assert.ok(output.includes("workspace:"), `Expected workspace: in output`);
  assert.ok(output.includes("state:"), `Expected state: in output`);
});

test("runInfo: outputs JSON when opts.json=true", async () => {
  const dir = await makeExpDir();
  const { runInfo } = await import("../src/trace-ai/exp/info.js");
  const chunks: string[] = [];
  const orig = process.stdout.write.bind(process.stdout);
  (process.stdout as any).write = (chunk: string | Uint8Array): boolean => { chunks.push(String(chunk)); return true; };
  try {
    await runInfo(dir, { json: true });
  } finally {
    (process.stdout as any).write = orig;
  }
  const parsed = JSON.parse(chunks.join(""));
  assert.equal(parsed.state, "Init");
  assert.equal(parsed.workspace, dir);
});
