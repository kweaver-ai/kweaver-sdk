import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { runPerTracePipeline } from "../src/trace-ai/scan/runner.js";

async function tmpDir(): Promise<string> {
  return await fs.mkdtemp(path.join(os.tmpdir(), "scan-runner-"));
}

test("runPerTracePipeline: existing <conv_id>.yaml → skipped, returns reused=true", async () => {
  const out = await tmpDir();
  // Pre-write a valid yaml.
  await fs.writeFile(path.join(out, "conv_a.yaml"),
    "schema_version: trace-diagnose-report/v1\n" +
    "trace: { trace_id: tr_a, agent_id: 01KR_x, tenant: null }\n" +
    "run: { diagnosed_at: x, cli_version: 0.7.4, mode: hybrid, rules_applied: [], rules_skipped: [], synthesizer_mode: template }\n" +
    "summary: { headline: h, primary_root_cause: null, fix_priority: [], cross_finding_links: [] }\n" +
    "findings: []\n", "utf8");
  let pipelineCalled = false;
  const r = await runPerTracePipeline({
    convId: "conv_a",
    outDir: out,
    runDiagnose: async () => { pipelineCalled = true; return null as never; },
  });
  assert.equal(r.reused, true);
  assert.equal(pipelineCalled, false);
  await fs.rm(out, { recursive: true, force: true });
});

test("runPerTracePipeline: legacy flat report is copied into outDir and reused", async () => {
  const legacy = await tmpDir();
  const out = path.join(legacy, "traces");
  const legacyYaml =
    "schema_version: trace-diagnose-report/v1\n" +
    "trace: { trace_id: tr_a, agent_id: 01KR_x, tenant: null }\n" +
    "run: { diagnosed_at: x, cli_version: 0.7.4, mode: hybrid, rules_applied: [], rules_skipped: [], synthesizer_mode: template }\n" +
    "summary: { headline: h, primary_root_cause: null, fix_priority: [], cross_finding_links: [] }\n" +
    "findings: []\n";
  await fs.writeFile(path.join(legacy, "conv_a.yaml"), legacyYaml, "utf8");
  await fs.writeFile(path.join(legacy, "conv_a.md"), "# legacy\n", "utf8");
  let pipelineCalled = false;
  const r = await runPerTracePipeline({
    convId: "conv_a",
    outDir: out,
    legacyOutDir: legacy,
    runDiagnose: async () => { pipelineCalled = true; return null as never; },
  });
  assert.equal(r.reused, true);
  assert.equal(pipelineCalled, false);
  assert.equal(await fs.readFile(path.join(out, "conv_a.yaml"), "utf8"), legacyYaml);
  assert.equal(await fs.readFile(path.join(out, "conv_a.md"), "utf8"), "# legacy\n");
  await fs.rm(legacy, { recursive: true, force: true });
});

test("runPerTracePipeline: no existing yaml → calls runDiagnose, returns reused=false", async () => {
  const out = await tmpDir();
  let calls = 0;
  const r = await runPerTracePipeline({
    convId: "conv_a",
    outDir: out,
    runDiagnose: async (convId, partialPath) => {
      calls++;
      await fs.writeFile(partialPath, "yaml content here", "utf8");
      return { traceId: "tr_a", agentId: "01KR_x" };
    },
  });
  assert.equal(calls, 1);
  assert.equal(r.reused, false);
  // The .partial should have been atomic-renamed to the final path.
  const finalContents = await fs.readFile(path.join(out, "conv_a.yaml"), "utf8");
  assert.equal(finalContents, "yaml content here");
  const partialExists = await fs.stat(path.join(out, "conv_a.yaml.partial")).then(() => true).catch(() => false);
  assert.equal(partialExists, false);
  await fs.rm(out, { recursive: true, force: true });
});

test("runPerTracePipeline: corrupt existing yaml → log warning, treat as fresh, recompute", async () => {
  const out = await tmpDir();
  await fs.writeFile(path.join(out, "conv_a.yaml"), "{{not valid yaml or schema", "utf8");
  let calls = 0;
  const r = await runPerTracePipeline({
    convId: "conv_a",
    outDir: out,
    runDiagnose: async (_convId, partial) => {
      calls++;
      await fs.writeFile(partial, "fresh yaml content", "utf8");
      return { traceId: "tr_a", agentId: "01KR_x" };
    },
  });
  assert.equal(calls, 1);
  assert.equal(r.reused, false);
  await fs.rm(out, { recursive: true, force: true });
});

test("runPerTracePipeline: parallel invocations with --max-parallel respected (proxy: counts concurrent)", async () => {
  const out = await tmpDir();
  let concurrent = 0;
  let max = 0;
  const runOne = async (i: number) => runPerTracePipeline({
    convId: `conv_${i}`,
    outDir: out,
    runDiagnose: async (_id, partial) => {
      concurrent++;
      max = Math.max(max, concurrent);
      await new Promise((r) => setTimeout(r, 20));
      concurrent--;
      await fs.writeFile(partial, `y_${i}`, "utf8");
      return { traceId: `tr_${i}`, agentId: "01KR_x" };
    },
  });
  // Note: runPerTracePipeline itself doesn't enforce parallelism — caller does
  // (via Promise.all with chunking). This test just exercises the function in
  // parallel and confirms it doesn't serialize internally.
  await Promise.all([0, 1, 2, 3, 4].map(runOne));
  assert.ok(max >= 2);   // some concurrency observed
  await fs.rm(out, { recursive: true, force: true });
});
