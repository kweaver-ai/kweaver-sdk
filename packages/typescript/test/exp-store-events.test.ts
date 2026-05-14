import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { appendEvent, replayState } from "../src/trace-ai/exp/exp-store/events-jsonl.js";
import type { ExpFsmState } from "../src/trace-ai/exp/schemas.js";

async function makeTmpDir() {
  return fs.mkdtemp(path.join(os.tmpdir(), "trace-exp-events-"));
}

test("replayState: returns Init for empty events.jsonl", async () => {
  const dir = await makeTmpDir();
  await fs.mkdir(path.join(dir, ".trace-state"), { recursive: true });
  await fs.writeFile(path.join(dir, ".trace-state", "events.jsonl"), "");
  const state = await replayState(dir);
  assert.equal(state.currentState, "Init");
  assert.equal(state.currentRound, 0);
  assert.equal(state.lastEvent, null);
});

test("appendEvent + replayState: reflects last transition", async () => {
  const dir = await makeTmpDir();
  await fs.mkdir(path.join(dir, ".trace-state"), { recursive: true });
  await fs.writeFile(path.join(dir, ".trace-state", "events.jsonl"), "");

  await appendEvent(dir, { type: "state_transition", from: "Init", to: "Generating", round: 1 });
  await appendEvent(dir, { type: "state_transition", from: "Generating", to: "Executing", round: 1 });

  const state = await replayState(dir);
  assert.equal(state.currentState, "Executing");
  assert.equal(state.currentRound, 1);
});

test("replayState: detects step_failed", async () => {
  const dir = await makeTmpDir();
  await fs.mkdir(path.join(dir, ".trace-state"), { recursive: true });
  await fs.writeFile(path.join(dir, ".trace-state", "events.jsonl"), "");

  await appendEvent(dir, { type: "state_transition", from: "Init", to: "Generating", round: 1 });
  await appendEvent(dir, { type: "step_failed", state: "Generating", error: "timeout", retryable: true });

  const state = await replayState(dir);
  assert.equal(state.currentState, "Generating");
  assert.equal(state.lastFailure?.retryable, true);
});

test("replayState: terminal state Published", async () => {
  const dir = await makeTmpDir();
  await fs.mkdir(path.join(dir, ".trace-state"), { recursive: true });
  await fs.writeFile(path.join(dir, ".trace-state", "events.jsonl"), "");
  await appendEvent(dir, { type: "state_transition", from: "Publishing", to: "Published", round: 2 });
  const state = await replayState(dir);
  assert.equal(state.isTerminal, true);
});
