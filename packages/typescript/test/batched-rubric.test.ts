import test from "node:test";
import assert from "node:assert/strict";
import { z } from "zod";

import { runBatchedRubric, type BatchTraceItem } from "../src/trace-ai/scan/batched-rubric.js";
import { StubAgentProvider } from "../src/agent-providers/providers/stub.js";
import { PromptTemplateRegistry } from "../src/agent-providers/prompt-template.js";
import { ArtifactWriter } from "../src/trace-ai/scan/artifacts/writer.js";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

function buildPromptRegistry(): PromptTemplateRegistry {
  const r = new PromptTemplateRegistry();
  r.registerInline(
    "builtin:rubric-judge-batch-v1",
    "rule={{rule_id}} batch={{batch_size}} agent={{agent_id}} traces={{traces_yaml}} schema={{output_schema}} {{language_instruction}}",
  );
  return r;
}

const OutputSchema = z.object({
  trace_results: z.array(z.object({
    trace_id: z.string(),
    category: z.enum(["a", "b", "other"]),
    reasoning: z.string(),
    severity: z.enum(["low", "medium", "high"]),
    first_violating_step_id: z.string(),
    evidence_span_ids: z.array(z.string()).optional(),
  })),
});

function rubric() {
  return {
    ruleId: "r_batch",
    judgeQuestion: "is this A or B?",
    outputSchema: OutputSchema,
    outputSchemaRaw: { type: "object" },                  // simplified for prompt render
    promptTemplateRef: "builtin:rubric-judge-batch-v1",
  };
}

function traceItem(id: string, spans = ["sp1", "sp2"]): BatchTraceItem {
  return { traceId: id, spans, inputs: { user_intent: `intent-${id}` } };
}

test("runBatchedRubric: chunk K=10 splits 25 traces into 3 chunks", async () => {
  const stub = new StubAgentProvider({
    name: "stub",
    responseFn: async (_p) => ({
      trace_results: [],   // empty for simplicity; real impl will populate per-trace
    }),
  });
  const traces = Array.from({ length: 25 }, (_, i) => traceItem(`tr_${i}`, [`sp_${i}_a`]));
  await runBatchedRubric({
    rule: rubric(),
    traces,
    agentId: "agent_A",
    provider: stub,
    promptRegistry: buildPromptRegistry(),
    chunkSize: 10,
  });
  assert.equal(stub.calls.length, 3);  // 25/10 = 2 full + 1 partial
});

test("runBatchedRubric: per-item schema_violation isolates to that trace only", async () => {
  const stub = new StubAgentProvider({
    name: "stub",
    responseFn: async (_p) => ({
      trace_results: [
        { trace_id: "tr_0", category: "a", reasoning: "ok", severity: "high", first_violating_step_id: "sp_0_a" },
        { trace_id: "tr_1", category: "a", reasoning: "ok", severity: "high", first_violating_step_id: "NOT_IN_SPANS" },
      ],
    }),
  });
  const traces = [traceItem("tr_0", ["sp_0_a"]), traceItem("tr_1", ["sp_1_a"])];
  const out = await runBatchedRubric({
    rule: rubric(),
    traces,
    agentId: "agent_A",
    provider: stub,
    promptRegistry: buildPromptRegistry(),
    chunkSize: 10,
  });
  assert.equal(out.verdicts.length, 1);
  assert.equal(out.verdicts[0].traceId, "tr_0");
  assert.equal(out.skipped.length, 1);
  assert.equal(out.skipped[0].traceId, "tr_1");
  assert.match(out.skipped[0].reason, /schema_violation/);
});

test("runBatchedRubric: whole-chunk provider failure → all chunk traces skipped with agent-error:transport", async () => {
  const stub = new StubAgentProvider({
    name: "stub",
    responseFn: async () => { throw new Error("boom"); },
  });
  const traces = [traceItem("tr_a"), traceItem("tr_b")];
  const out = await runBatchedRubric({
    rule: rubric(),
    traces,
    agentId: "agent_A",
    provider: stub,
    promptRegistry: buildPromptRegistry(),
    chunkSize: 10,
  });
  assert.equal(out.verdicts.length, 0);
  assert.equal(out.skipped.length, 2);
  assert.ok(out.skipped.every((s) => s.reason.startsWith("agent-error:")));
});

test("runBatchedRubric: trace_id echo-back missing → that entry is dropped with reason schema_violation", async () => {
  const stub = new StubAgentProvider({
    name: "stub",
    responseFn: async () => ({
      trace_results: [
        { trace_id: "tr_unknown", category: "a", reasoning: "ok", severity: "high", first_violating_step_id: "sp_0_a" },
      ],
    }),
  });
  const out = await runBatchedRubric({
    rule: rubric(),
    traces: [traceItem("tr_0", ["sp_0_a"])],
    agentId: "agent_A",
    provider: stub,
    promptRegistry: buildPromptRegistry(),
    chunkSize: 10,
  });
  assert.equal(out.verdicts.length, 0);
  assert.equal(out.skipped.length, 1);
  assert.match(out.skipped[0].reason, /schema_violation/);
});

test("runBatchedRubric: duplicate trace_id in LLM response → second occurrence dropped with schema_violation, first kept", async () => {
  const stub = new StubAgentProvider({
    name: "stub",
    responseFn: async () => ({
      trace_results: [
        { trace_id: "tr_0", category: "a", reasoning: "first", severity: "high", first_violating_step_id: "sp_0_a" },
        { trace_id: "tr_0", category: "b", reasoning: "duplicate", severity: "low", first_violating_step_id: "sp_0_a" },
      ],
    }),
  });
  const out = await runBatchedRubric({
    rule: rubric(),
    traces: [traceItem("tr_0", ["sp_0_a"])],
    agentId: "agent_A",
    provider: stub,
    promptRegistry: buildPromptRegistry(),
    chunkSize: 10,
  });
  assert.equal(out.verdicts.length, 1);
  assert.equal(out.verdicts[0].reasoning, "first");
  assert.equal(out.skipped.length, 1);
  assert.match(out.skipped[0].reason, /duplicate/);
  assert.equal(out.skipped[0].traceId, "tr_0");
});

test("runBatchedRubric: with ArtifactWriter, writes work-queue + prompt + response per chunk", async () => {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), "br-art-"));
  const artifacts = new ArtifactWriter({ base, enabled: true });
  const stub = new StubAgentProvider({
    name: "stub",
    responseFn: async () => ({ trace_results: [] }),
  });
  await runBatchedRubric({
    rule: rubric(),
    traces: [traceItem("tr_0", ["sp_0_a"])],
    agentId: "agent_A",
    provider: stub,
    promptRegistry: buildPromptRegistry(),
    chunkSize: 10,
    artifacts,
  });
  const ruleDir = path.join(base, "stage-2-rubric", "r_batch");
  assert.ok(await fs.stat(path.join(ruleDir, "work-queue.json")).then(() => true).catch(() => false));
  assert.ok(await fs.stat(path.join(ruleDir, "chunk-000.prompt.md")).then(() => true).catch(() => false));
  assert.ok(await fs.stat(path.join(ruleDir, "chunk-000.response.json")).then(() => true).catch(() => false));
  await fs.rm(base, { recursive: true, force: true });
});
