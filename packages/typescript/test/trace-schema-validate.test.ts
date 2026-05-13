import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import fs from "node:fs/promises";

import { parseTraceArgs } from "../src/commands/trace.js";
import { runSchemaValidate, inferKind, SchemaKindRequiredError } from "../src/commands/trace.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ── arg parsing ─────────────────────────────────────────────────────────

test("parseTraceArgs recognizes 'schema validate'", () => {
  const args = parseTraceArgs(["schema", "validate", "eval-sets/cs-v1/index.yaml"]);
  assert.equal(args.subcommand, "schema-validate");
  assert.equal(args.schemaValidatePath, "eval-sets/cs-v1/index.yaml");
});

test("parseTraceArgs accepts --kind=", () => {
  const args = parseTraceArgs([
    "schema",
    "validate",
    "any.yaml",
    "--kind=eval-set",
  ]);
  assert.equal(args.schemaKind, "eval-set");
});

// ── inferKind heuristics ────────────────────────────────────────────────

test("inferKind: index.yaml in eval-sets/* → eval-set-index", () => {
  assert.equal(inferKind("eval-sets/cs-v1/index.yaml"), "eval-set-index");
});

test("inferKind: *-test-report.yaml → test-report", () => {
  assert.equal(inferKind("test-runs/baseline/some-test-report.yaml"), "test-report");
});

test("inferKind: cases.yaml in eval-sets/* → eval-set", () => {
  assert.equal(inferKind("eval-sets/cs-v1/cases.yaml"), "eval-set");
});

test("inferKind: unknown file path → null (means --kind required)", () => {
  assert.equal(inferKind("/tmp/random.yaml"), null);
});

// ── end-to-end runSchemaValidate ────────────────────────────────────────

test("runSchemaValidate validates a valid eval-set-index file → 0", async () => {
  const tmp = path.join(__dirname, "fixtures", "eval-set", "tmp-index.yaml");
  await fs.writeFile(
    tmp,
    `schema_version: trace-eval-set-index/v1
eval_set_id: x
shards:
  - path: cases.yaml
`,
    "utf8",
  );
  try {
    const code = await runSchemaValidate({ filePath: tmp, kind: "eval-set-index" });
    assert.equal(code, 0);
  } finally {
    await fs.unlink(tmp);
  }
});

test("runSchemaValidate returns 1 for invalid yaml", async () => {
  const tmp = path.join(__dirname, "fixtures", "eval-set", "bad-index.yaml");
  await fs.writeFile(
    tmp,
    `schema_version: trace-eval-set-index/v1
eval_set_id: x
shards: []
`,
    "utf8",
  );
  try {
    const code = await runSchemaValidate({ filePath: tmp, kind: "eval-set-index" });
    assert.equal(code, 1);
  } finally {
    await fs.unlink(tmp);
  }
});

test("runSchemaValidate returns 2 when kind cannot be inferred and not provided", async () => {
  const tmp = path.join(tmpdir(), `wat-${Date.now()}.yaml`);
  await fs.writeFile(tmp, "x: 1\n", "utf8");
  try {
    await assert.rejects(
      runSchemaValidate({ filePath: tmp, kind: undefined }),
      (e) => e instanceof SchemaKindRequiredError,
    );
  } finally {
    await fs.unlink(tmp);
  }
});
