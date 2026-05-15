// test/exp-bundle-writer.test.ts
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { writeBundles } from "../src/trace-ai/exp/bundle-writer.js";
import type { LineageEntry, RoundData } from "../src/trace-ai/exp/schemas.js";
import yaml from "js-yaml";

async function makeTmpDir() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "trace-bundle-"));
  await fs.mkdir(path.join(dir, "outputs"), { recursive: true });
  return dir;
}

test("writeBundles: creates bundle.yaml, manifest.yaml, provenance.yaml", async () => {
  const dir = await makeTmpDir();
  const lineage: LineageEntry[] = [{
    version: 1,
    candidate_path: "candidates/candidate-v1.yaml",
    next_change: { target: "agent.system_prompt", hypothesis: "test", patch: "{}" },
    status: "scored",
    appended_at: new Date().toISOString(),
  }];
  const rounds: RoundData[] = [{
    round: 1,
    trial_version: 1,
    scores: { outcome: 0.8, trajectory: 0.9, guardrail: 1, guardrail_hard_fail: false },
    per_query_results: [],
    triage_conclusion: {
      diagnoses: ["tool retries too high"],
      hints: ["add stop condition"],
      verdict: "publish",
      cross_round_memory_ref: "mem_token_1",
    },
  }];

  await writeBundles({ expDir: dir, experimentId: "exp_test", lineage, rounds, createdBy: "testuser" });

  const bundle = yaml.load(await fs.readFile(path.join(dir, "outputs", "bundle.yaml"), "utf8")) as Record<string, unknown>;
  assert.equal(bundle["schema_version"], "trace-bundle/v1");
  assert.equal(bundle["experiment_id"], "exp_test");

  const manifest = yaml.load(await fs.readFile(path.join(dir, "outputs", "manifest.yaml"), "utf8")) as Record<string, unknown>;
  assert.equal(manifest["schema_version"], "trace-manifest/v1");

  await fs.access(path.join(dir, "outputs", "provenance.yaml"));
});
