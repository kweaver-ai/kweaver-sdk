// test/exp-run-preflight.test.ts
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import yaml from "js-yaml";
import { runPreflight } from "../src/trace-ai/exp/run-preflight.js";
import { PreflightMismatchError, type AgentFingerprint } from "../src/trace-ai/exp/preflight.js";
import {
  writeExpectedFingerprint,
  readExpectedFingerprint,
} from "../src/trace-ai/exp/exp-store/expected-fingerprint.js";

function agentConfig(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "agent-1",
    key: "k",
    version: "v7",
    system_prompt: "sp",
    llms: [{ is_default: true, llm_config: { name: "deepseek-chat", temperature: 0 } }],
    skills: {
      tools: [
        { tool_id: "t1", tool_box_id: "b1", tool_input: [{ input_name: "kn_id", map_value: "kn-bound" }] },
      ],
    },
    ...overrides,
  };
}

async function tmpExpDir(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), "exp-preflight-"));
}

async function makeEvalSet(parent: string, name: string, targetKn?: string): Promise<string> {
  const dir = path.join(parent, name);
  await fs.mkdir(dir, { recursive: true });
  const index: Record<string, unknown> = {
    schema_version: "trace-eval-set-index/v1",
    eval_set_id: name,
    shards: [{ path: "cases.yaml" }],
  };
  if (targetKn !== undefined) index["target_kn"] = targetKn;
  await fs.writeFile(path.join(dir, "index.yaml"), yaml.dump(index));
  return dir;
}

test("runPreflight captures a baseline expected fingerprint on first run", async () => {
  const dir = await tmpExpDir();
  try {
    const evalSet = await makeEvalSet(dir, "es");
    await runPreflight({
      expDir: dir,
      agentId: "agent-1",
      fetchConfig: async () => agentConfig(),
      evalSetPaths: [evalSet],
    });
    const stored = await readExpectedFingerprint(dir);
    assert.ok(stored);
    assert.equal(stored.agent_id, "agent-1");
    assert.equal(stored.model, "deepseek-chat");
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test("runPreflight throws when agent KN binding != eval set target_kn", async () => {
  const dir = await tmpExpDir();
  try {
    const evalSet = await makeEvalSet(dir, "es", "kn-correct");
    await assert.rejects(
      runPreflight({
        expDir: dir,
        agentId: "agent-1",
        fetchConfig: async () => agentConfig(), // bound to kn-bound, not kn-correct
        evalSetPaths: [evalSet],
      }),
      (err: unknown) => err instanceof PreflightMismatchError && err.mismatches.some(m => m.field === "kn_binding"),
    );
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test("runPreflight re-baselines every round and does not gate on config drift", async () => {
  const dir = await tmpExpDir();
  try {
    const evalSet = await makeEvalSet(dir, "es");
    const stale: AgentFingerprint = {
      agent_id: "agent-1",
      version: "v7",
      system_prompt: "ORIGINAL prompt",
      model: "deepseek-chat",
      temperature: 0,
      tools: [{ tool_id: "t1", tool_box_id: "b1" }],
      kn_ids: ["kn-bound"],
    };
    await writeExpectedFingerprint(dir, stale);
    // The live agent changed. Without an executor the loop cannot tell an
    // intentional change from drift, so it must NOT fail the round.
    await assert.doesNotReject(
      runPreflight({
        expDir: dir,
        agentId: "agent-1",
        fetchConfig: async () => agentConfig({ system_prompt: "CHANGED prompt" }),
        evalSetPaths: [evalSet],
      }),
    );
    // ...and the stored fingerprint is refreshed to the live config.
    const stored = await readExpectedFingerprint(dir);
    assert.equal(stored?.system_prompt, "CHANGED prompt");
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test("runPreflight passes when the agent matches expected and the target_kn", async () => {
  const dir = await tmpExpDir();
  try {
    const evalSet = await makeEvalSet(dir, "es", "kn-bound");
    await assert.doesNotReject(
      runPreflight({
        expDir: dir,
        agentId: "agent-1",
        fetchConfig: async () => agentConfig(),
        evalSetPaths: [evalSet],
      }),
    );
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test("runPreflight throws when eval sets declare conflicting target_kn", async () => {
  const dir = await tmpExpDir();
  try {
    const es1 = await makeEvalSet(dir, "es1", "kn-a");
    const es2 = await makeEvalSet(dir, "es2", "kn-b");
    await assert.rejects(
      runPreflight({
        expDir: dir,
        agentId: "agent-1",
        fetchConfig: async () => agentConfig(),
        evalSetPaths: [es1, es2],
      }),
      /conflicting target_kn/,
    );
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});
