import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import fs from "node:fs/promises";
import yaml from "js-yaml";

import { build, BuilderError, ensureQueryId } from "../src/trace-ai/eval-set/builder.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function mkTempDir(): Promise<string> {
  return await fs.mkdtemp(path.join(tmpdir(), "m5-builder-"));
}

test("ensureQueryId is idempotent for the same input", () => {
  const c1 = { query_id: "", input: { user_message: "hello" }, tags: ["a"] };
  const c2 = { query_id: "", input: { user_message: "hello" }, tags: ["a"] };
  const id1 = ensureQueryId(c1);
  const id2 = ensureQueryId(c2);
  assert.equal(id1, id2);
  assert.equal(id1.length, 12);
});

test("ensureQueryId returns user-provided query_id unchanged", () => {
  const c = { query_id: "user_set_id", input: { user_message: "x" } };
  assert.equal(ensureQueryId(c), "user_set_id");
});

test("ensureQueryId differs for different inputs", () => {
  const c1 = { query_id: "", input: { user_message: "hello" } };
  const c2 = { query_id: "", input: { user_message: "world" } };
  assert.notEqual(ensureQueryId(c1), ensureQueryId(c2));
});

test("build with --queries= source end-to-end (lift → id → redact → write → validate)", async () => {
  const out = await mkTempDir();
  const fixture = path.join(__dirname, "fixtures", "eval-set", "queries-input-valid.yaml");
  try {
    const result = await build({
      source: { kind: "queries", path: fixture },
      outDir: out,
      evalSetId: "cs-v1",
      onConflict: "fail",
      redactionRulesCliFlag: undefined,
      repoDir: undefined,
    });
    assert.equal(result.cases_written, 2);
    assert.equal(result.redaction_rules_source, "builtin");

    const indexRaw = await fs.readFile(path.join(out, "index.yaml"), "utf8");
    const index = yaml.load(indexRaw) as { shards: { path: string }[] };
    assert.equal(index.shards.length, 1);

    const shardRaw = await fs.readFile(path.join(out, "cases.yaml"), "utf8");
    const shard = yaml.load(shardRaw) as { cases: { query_id: string }[] };
    assert.equal(shard.cases.length, 2);
    assert.equal(shard.cases[0].query_id, "refund_001");
    assert.ok(/^[0-9a-f]{12}$/.test(shard.cases[1].query_id));
  } finally {
    await fs.rm(out, { recursive: true, force: true });
  }
});

test("build with --queries= rejects refinement-violating input", async () => {
  const out = await mkTempDir();
  const fixture = path.join(__dirname, "fixtures", "eval-set", "queries-input-empty-refinement.yaml");
  try {
    await assert.rejects(
      build({
        source: { kind: "queries", path: fixture },
        outDir: out,
        evalSetId: "cs-v1",
        onConflict: "fail",
        redactionRulesCliFlag: undefined,
        repoDir: undefined,
      }),
      (e) => e instanceof BuilderError,
    );
  } finally {
    await fs.rm(out, { recursive: true, force: true });
  }
});

test("build with --queries= redacts builtin PII patterns in user_message", async () => {
  const out = await mkTempDir();
  const tmpFixture = path.join(__dirname, "fixtures", "eval-set", "queries-with-pii.yaml");
  await fs.writeFile(
    tmpFixture,
    `schema_version: trace-eval-set-input/v1
cases:
  - input:
      user_message: "我电话 13812345678 想咨询"
    reference:
      answer: "好的"
`,
    "utf8",
  );
  try {
    await build({
      source: { kind: "queries", path: tmpFixture },
      outDir: out,
      evalSetId: "test-v1",
      onConflict: "fail",
      redactionRulesCliFlag: undefined,
      repoDir: undefined,
    });
    const shardRaw = await fs.readFile(path.join(out, "cases.yaml"), "utf8");
    assert.ok(shardRaw.includes("<phone:"), "expected <phone:hash6> placeholder");
    assert.equal(shardRaw.includes("13812345678"), false, "raw phone must be replaced");
  } finally {
    await fs.unlink(tmpFixture);
    await fs.rm(out, { recursive: true, force: true });
  }
});

test("build with --diagnosis= where all findings have query=null throws friendly 0-cases error", async () => {
  const diagDir = await fs.mkdtemp(path.join(tmpdir(), "m5-zero-cases-"));
  const out = await mkTempDir();
  try {
    // M4 report where the only finding has query: null (the 62 runtime case)
    await fs.writeFile(
      path.join(diagDir, "report.yaml"),
      `schema_version: trace-diagnose-report/v1
trace: { trace_id: tr1, agent_id: agt, tenant: null }
run:
  diagnosed_at: "2026-05-13T00:00:00Z"
  cli_version: "0.7.4"
  mode: symbolic-only
  rules_applied: ["r1"]
  rules_skipped: []
  synthesizer_mode: template
summary:
  headline: x
  primary_root_cause: null
  fix_priority: []
  cross_finding_links: []
findings:
  - rule_id: r1
    judgment_kind: symbolic
    severity: low
    symptom: s
    likely_cause: lc
    evidence: { spans: [sp1], excerpt: e }
    suggested_fix: { target: t, change: c }
    confidence: low
    verify_with:
      suggested_eval_case:
        query_id: conv1
        query: null
        assertions: ["some_assertion"]
`,
      "utf8",
    );
    await assert.rejects(
      build({
        source: { kind: "diagnosis", path: diagDir },
        outDir: out,
        evalSetId: "x",
        onConflict: "fail",
        redactionRulesCliFlag: undefined,
        repoDir: undefined,
      }),
      (e) => {
        if (!(e instanceof BuilderError)) return false;
        // verify message mentions 0-cases + actionable alternatives
        return (
          /lifted 0 eval-cases/.test(e.message) &&
          /Skipped 1 finding/.test(e.message) &&
          /--queries=/.test(e.message) &&
          /gen_ai\.input\.messages/.test(e.message)
        );
      },
    );
  } finally {
    await fs.rm(diagDir, { recursive: true, force: true });
    await fs.rm(out, { recursive: true, force: true });
  }
});
