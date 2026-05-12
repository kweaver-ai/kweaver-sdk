import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { ArtifactWriter } from "../src/trace-ai/scan/artifacts/writer.js";

async function tmpDir(): Promise<string> {
  return await fs.mkdtemp(path.join(os.tmpdir(), "artifacts-test-"));
}

test("ArtifactWriter: enabled=false → no-op for all write methods", async () => {
  const base = await tmpDir();
  const w = new ArtifactWriter({ base, enabled: false });
  await w.writeStageTwoPrompt("rule_a", 0, "prompt text");
  await w.writeStageTwoResponse("rule_a", 0, { foo: "bar" });
  await w.writeRunMetadata({ cli_args: {} } as never);
  const entries = await fs.readdir(base).catch(() => []);
  assert.equal(entries.length, 0);
  await fs.rm(base, { recursive: true, force: true });
});

test("ArtifactWriter: stage-2 prompt + response + parse-errors write to <rule_id>/chunk-NNN.*", async () => {
  const base = await tmpDir();
  const w = new ArtifactWriter({ base, enabled: true });
  await w.writeStageTwoWorkQueue("tool_retry_intent_mismatch", ["conv_a", "conv_b"]);
  await w.writeStageTwoPrompt("tool_retry_intent_mismatch", 3, "prompt body");
  await w.writeStageTwoResponse("tool_retry_intent_mismatch", 3, { trace_results: [] });
  await w.writeStageTwoParseErrors("tool_retry_intent_mismatch", 3, [{ trace_id: "x", reason: "bad" }]);

  const ruleDir = path.join(base, "stage-2-rubric", "tool_retry_intent_mismatch");
  const queue = JSON.parse(await fs.readFile(path.join(ruleDir, "work-queue.json"), "utf8"));
  assert.deepEqual(queue, ["conv_a", "conv_b"]);
  const prompt = await fs.readFile(path.join(ruleDir, "chunk-003.prompt.md"), "utf8");
  assert.equal(prompt, "prompt body");
  const response = JSON.parse(await fs.readFile(path.join(ruleDir, "chunk-003.response.json"), "utf8"));
  assert.deepEqual(response, { trace_results: [] });
  const errors = JSON.parse(await fs.readFile(path.join(ruleDir, "chunk-003.parse-errors.json"), "utf8"));
  assert.equal(errors[0].trace_id, "x");
  await fs.rm(base, { recursive: true, force: true });
});

test("ArtifactWriter: chunk indices zero-padded to 3 digits", async () => {
  const base = await tmpDir();
  const w = new ArtifactWriter({ base, enabled: true });
  await w.writeStageTwoPrompt("r", 0, "p0");
  await w.writeStageTwoPrompt("r", 12, "p12");
  await w.writeStageTwoPrompt("r", 999, "p999");
  const dir = path.join(base, "stage-2-rubric", "r");
  const files = (await fs.readdir(dir)).sort();
  assert.ok(files.includes("chunk-000.prompt.md"));
  assert.ok(files.includes("chunk-012.prompt.md"));
  assert.ok(files.includes("chunk-999.prompt.md"));
  await fs.rm(base, { recursive: true, force: true });
});

test("ArtifactWriter: stage-3-synth writes prompt + response (single-trace mode)", async () => {
  const base = await tmpDir();
  const w = new ArtifactWriter({ base, enabled: true });
  await w.writeStageThreeSynthPrompt("synth prompt body");
  await w.writeStageThreeSynthResponse({ headline: "h" });
  assert.equal(await fs.readFile(path.join(base, "stage-3-synth", "prompt.md"), "utf8"), "synth prompt body");
  const r = JSON.parse(await fs.readFile(path.join(base, "stage-3-synth", "response.json"), "utf8"));
  assert.equal(r.headline, "h");
  await fs.rm(base, { recursive: true, force: true });
});

test("ArtifactWriter: stage-4 cross-trace writes aggregates / samples / prompt / response", async () => {
  const base = await tmpDir();
  const w = new ArtifactWriter({ base, enabled: true });
  await w.writeStageFourInputs({ rule_frequency: [] }, { samples: ["conv_a"] });
  await w.writeStageFourPrompt("cross-trace prompt");
  await w.writeStageFourResponse({ headline: "x" });
  const dir = path.join(base, "stage-4-cross-trace-synth");
  assert.ok((await fs.readFile(path.join(dir, "aggregates.json"), "utf8")).includes("rule_frequency"));
  assert.ok((await fs.readFile(path.join(dir, "samples.json"), "utf8")).includes("conv_a"));
  assert.equal(await fs.readFile(path.join(dir, "prompt.md"), "utf8"), "cross-trace prompt");
  const r = JSON.parse(await fs.readFile(path.join(dir, "response.json"), "utf8"));
  assert.equal(r.headline, "x");
  await fs.rm(base, { recursive: true, force: true });
});

test("ArtifactWriter: run-metadata.json written with full shape", async () => {
  const base = await tmpDir();
  const w = new ArtifactWriter({ base, enabled: true });
  await w.writeRunMetadata({
    cli_args: { traces: "a,b", out: "/tmp/out" },
    agent_id: "01KR_x",
    rule_load_summary: { rules_applied: ["r1"], rules_skipped_at_load: [], rules_dir: "builtin" },
    single_agent_validation: { checked_conv_ids: 2, agent_id_resolved: "01KR_x" },
    timing: { stage_1_ms: 10, stage_2_ms: 100, stage_3_ms: 5, stage_4_ms: 50, total_ms: 165 },
    llm_calls: { stage_2_chunks: 1, stage_3: 0, stage_4: 1, total: 2 },
    cost_estimate_usd: { stage_2: 0.005, stage_4: 0.05, total: 0.055, model_price_table_version: "2026-05" },
  });
  const meta = JSON.parse(await fs.readFile(path.join(base, "run-metadata.json"), "utf8"));
  assert.equal(meta.agent_id, "01KR_x");
  assert.equal(meta.llm_calls.total, 2);
  await fs.rm(base, { recursive: true, force: true });
});
