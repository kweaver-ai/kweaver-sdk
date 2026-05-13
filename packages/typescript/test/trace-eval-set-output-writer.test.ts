import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import fs from "node:fs/promises";
import yaml from "js-yaml";

import {
  writeEvalSet,
  WriterError,
} from "../src/trace-ai/eval-set/output-writer.js";
import type { EvalCase } from "../src/trace-ai/eval-set/types.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function mkTempDir(): Promise<string> {
  return await fs.mkdtemp(path.join(tmpdir(), "m5-test-"));
}

const sampleCase = (id: string): EvalCase => ({
  query_id: id,
  input: { user_message: "msg" },
  reference: { answer: "ans" },
});

test("writeEvalSet creates index.yaml + cases.yaml when out dir is empty", async () => {
  const out = await mkTempDir();
  try {
    const result = await writeEvalSet({
      outDir: out,
      evalSetId: "test-v1",
      newCases: [sampleCase("q1"), sampleCase("q2")],
      onConflict: "fail",
    });
    assert.equal(result.cases_written, 2);
    assert.equal(result.conflicts.length, 0);

    const indexRaw = await fs.readFile(path.join(out, "index.yaml"), "utf8");
    const index = yaml.load(indexRaw) as { eval_set_id: string; shards: { path: string }[] };
    assert.equal(index.eval_set_id, "test-v1");
    assert.equal(index.shards.length, 1);

    const sharRaw = await fs.readFile(path.join(out, "cases.yaml"), "utf8");
    const shard = yaml.load(sharRaw) as { cases: { query_id: string }[] };
    assert.equal(shard.cases.length, 2);
  } finally {
    await fs.rm(out, { recursive: true, force: true });
  }
});

test("writeEvalSet fail strategy aborts on query_id conflict", async () => {
  const out = await mkTempDir();
  try {
    await writeEvalSet({
      outDir: out,
      evalSetId: "test-v1",
      newCases: [sampleCase("q1")],
      onConflict: "fail",
    });
    await assert.rejects(
      writeEvalSet({
        outDir: out,
        evalSetId: "test-v1",
        newCases: [sampleCase("q1")],
        onConflict: "fail",
      }),
      (e) => e instanceof WriterError && e.conflictIds?.includes("q1") === true,
    );
  } finally {
    await fs.rm(out, { recursive: true, force: true });
  }
});

test("writeEvalSet skip strategy keeps existing case unchanged", async () => {
  const out = await mkTempDir();
  try {
    await writeEvalSet({
      outDir: out,
      evalSetId: "test-v1",
      newCases: [{ ...sampleCase("q1"), reference: { answer: "old" } }],
      onConflict: "fail",
    });
    const result = await writeEvalSet({
      outDir: out,
      evalSetId: "test-v1",
      newCases: [{ ...sampleCase("q1"), reference: { answer: "new" } }, sampleCase("q2")],
      onConflict: "skip",
    });
    assert.equal(result.cases_written, 1);
    assert.equal(result.cases_skipped, 1);

    const shard = yaml.load(
      await fs.readFile(path.join(out, "cases.yaml"), "utf8"),
    ) as { cases: Array<{ query_id: string; reference: { answer: string } }> };
    assert.equal(shard.cases.length, 2);
    const q1 = shard.cases.find((c) => c.query_id === "q1");
    assert.equal(q1?.reference.answer, "old");
  } finally {
    await fs.rm(out, { recursive: true, force: true });
  }
});

test("writeEvalSet overwrite strategy replaces case and writes .bak", async () => {
  const out = await mkTempDir();
  try {
    await writeEvalSet({
      outDir: out,
      evalSetId: "test-v1",
      newCases: [{ ...sampleCase("q1"), reference: { answer: "old" } }],
      onConflict: "fail",
    });
    const result = await writeEvalSet({
      outDir: out,
      evalSetId: "test-v1",
      newCases: [{ ...sampleCase("q1"), reference: { answer: "new" } }],
      onConflict: "overwrite",
    });
    assert.equal(result.cases_written, 1);

    const shard = yaml.load(
      await fs.readFile(path.join(out, "cases.yaml"), "utf8"),
    ) as { cases: Array<{ query_id: string; reference: { answer: string } }> };
    assert.equal(shard.cases[0].reference.answer, "new");

    const bakRaw = await fs.readFile(path.join(out, "cases.yaml.bak"), "utf8");
    const bak = yaml.load(bakRaw) as { cases: Array<{ reference: { answer: string } }> };
    assert.equal(bak.cases[0].reference.answer, "old");
  } finally {
    await fs.rm(out, { recursive: true, force: true });
  }
});

test("writeEvalSet detects intra-batch duplicate query_ids", async () => {
  const out = await mkTempDir();
  try {
    await assert.rejects(
      writeEvalSet({
        outDir: out,
        evalSetId: "test-v1",
        newCases: [sampleCase("q1"), sampleCase("q1")],
        onConflict: "fail",
      }),
      (e) => e instanceof WriterError && e.message.includes("intra-batch"),
    );
  } finally {
    await fs.rm(out, { recursive: true, force: true });
  }
});
