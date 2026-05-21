// test/exp-expected-fingerprint.test.ts
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import {
  writeExpectedFingerprint,
  readExpectedFingerprint,
} from "../src/trace-ai/exp/exp-store/expected-fingerprint.js";
import type { AgentFingerprint } from "../src/trace-ai/exp/preflight.js";

const sample: AgentFingerprint = {
  agent_id: "agent-1",
  version: "v7",
  system_prompt: "you are a helpful agent",
  model: "deepseek-chat",
  temperature: 0.7,
  tools: [
    { tool_id: "t-a", tool_box_id: "box-1" },
    { tool_id: "t-b", tool_box_id: "box-2" },
  ],
  kn_ids: ["kn-a", "kn-b"],
  non_fixed_kn_bindings: [],
};

async function tmpDir(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), "exp-fp-"));
}

test("writeExpectedFingerprint then readExpectedFingerprint round-trips the fingerprint", async () => {
  const dir = await tmpDir();
  try {
    await writeExpectedFingerprint(dir, sample);
    const got = await readExpectedFingerprint(dir);
    assert.deepEqual(got, sample);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test("readExpectedFingerprint returns undefined when no fingerprint is stored", async () => {
  const dir = await tmpDir();
  try {
    const got = await readExpectedFingerprint(dir);
    assert.equal(got, undefined);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test("writeExpectedFingerprint overwrites a previously stored fingerprint", async () => {
  const dir = await tmpDir();
  try {
    await writeExpectedFingerprint(dir, sample);
    const updated: AgentFingerprint = { ...sample, version: "v8", model: "claude-opus-4-7" };
    await writeExpectedFingerprint(dir, updated);
    const got = await readExpectedFingerprint(dir);
    assert.deepEqual(got, updated);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});
