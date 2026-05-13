import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import fs from "node:fs/promises";
import yaml from "js-yaml";

import { build } from "../src/trace-ai/eval-set/index.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const DIAGNOSE_FIXTURE_DIR = path.join(__dirname, "fixtures", "eval-set");

test("e2e: build --diagnosis= + schema validate 全链通", async () => {
  const out = await fs.mkdtemp(path.join(tmpdir(), "m5-e2e-"));
  // Copy Task 4b's diagnose-report-sample.yaml to an independent dir so the
  // shared fixtures/eval-set dir (which has queries-input-*.yaml) doesn't pollute.
  const diagDir = await fs.mkdtemp(path.join(tmpdir(), "m5-diag-"));
  await fs.copyFile(
    path.join(DIAGNOSE_FIXTURE_DIR, "diagnose-report-sample.yaml"),
    path.join(diagDir, "report.yaml"),
  );

  try {
    const result = await build({
      source: { kind: "diagnosis", path: diagDir },
      outDir: out,
      evalSetId: "e2e-test",
      onConflict: "fail",
      redactionRulesCliFlag: undefined,
      repoDir: undefined,
    });

    // Task 4b's fixture has 2 findings: 1 with query+assertions (lifted) + 1 with query:null (skipped)
    assert.equal(result.cases_written, 1);
    assert.ok(result.cases_skipped >= 1);

    // Schema validate the produced index + shard
    const indexRaw = await fs.readFile(path.join(out, "index.yaml"), "utf8");
    const parsedIndex = yaml.load(indexRaw);
    const { EvalSetIndexSchema, EvalSetShardSchema } = await import(
      "../src/trace-ai/eval-set/schemas.js"
    );
    assert.equal(EvalSetIndexSchema.safeParse(parsedIndex).success, true);

    const shardRaw = await fs.readFile(path.join(out, "cases.yaml"), "utf8");
    const parsedShard = yaml.load(shardRaw);
    assert.equal(EvalSetShardSchema.safeParse(parsedShard).success, true);
  } finally {
    await fs.rm(out, { recursive: true, force: true });
    await fs.rm(diagDir, { recursive: true, force: true });
  }
});
