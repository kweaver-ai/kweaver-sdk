import test from "node:test";
import assert from "node:assert/strict";
import { tmpdir } from "node:os";
import { writeFileSync, rmSync, mkdirSync } from "node:fs";
import { join } from "node:path";

import {
  parseCsvFile,
  buildTableName,
  splitBatches,
  buildFieldMappings,
  buildDagBody,
} from "../src/commands/import-csv.js";
import type { DagBodyOptions } from "../src/commands/import-csv.js";

const TMP_DIR = join(tmpdir(), "import-csv-test-" + process.pid);

// ── Setup ─────────────────────────────────────────────────────────────────────

test("setup: create temp dir", () => {
  mkdirSync(TMP_DIR, { recursive: true });
});

// ── parseCsvFile ──────────────────────────────────────────────────────────────

test("parseCsvFile: parses valid UTF-8 CSV", async () => {
  const filePath = join(TMP_DIR, "basic.csv");
  writeFileSync(filePath, "name,age\nAlice,30\nBob,25\n", "utf8");

  const result = await parseCsvFile(filePath);

  assert.deepEqual(result.headers, ["name", "age"]);
  assert.equal(result.rows.length, 2);
  assert.deepEqual(result.rows[0], { name: "Alice", age: "30" });
  assert.deepEqual(result.rows[1], { name: "Bob", age: "25" });
});

test("parseCsvFile: handles UTF-8 BOM — headers must not include BOM", async () => {
  const filePath = join(TMP_DIR, "bom.csv");
  writeFileSync(filePath, "\uFEFFname,age\nAlice,30\n", "utf8");

  const result = await parseCsvFile(filePath);

  assert.deepEqual(result.headers, ["name", "age"]);
  assert.ok(!result.headers[0].startsWith("\uFEFF"), "First header must not start with BOM character");
});

test("parseCsvFile: converts empty strings to null", async () => {
  const filePath = join(TMP_DIR, "empty-fields.csv");
  writeFileSync(filePath, "name,age,note\nAlice,,hello\n,25,\n", "utf8");

  const result = await parseCsvFile(filePath);

  assert.equal(result.rows[0]!.age, null);
  assert.equal(result.rows[1]!.name, null);
  assert.equal(result.rows[1]!.note, null);
});

test("parseCsvFile: throws on invalid CSV (column count mismatch)", async () => {
  const filePath = join(TMP_DIR, "invalid.csv");
  writeFileSync(filePath, "a,b\n1,2,3\n", "utf8");

  await assert.rejects(
    () => parseCsvFile(filePath),
    (err: Error) => {
      assert.ok(err instanceof Error);
      return true;
    }
  );
});

test("parseCsvFile: returns empty rows for header-only file", async () => {
  const filePath = join(TMP_DIR, "headers-only.csv");
  writeFileSync(filePath, "name,age,city\n", "utf8");

  const result = await parseCsvFile(filePath);

  assert.deepEqual(result.headers, ["name", "age", "city"]);
  assert.equal(result.rows.length, 0);
});

// ── buildTableName ────────────────────────────────────────────────────────────

test("buildTableName: strips .csv and prepends prefix (Chinese filename)", () => {
  const result = buildTableName("/path/to/物料.csv", "my_");
  assert.equal(result, "my_物料");
});

test("buildTableName: empty prefix, simple filename", () => {
  const result = buildTableName("data.csv", "");
  assert.equal(result, "data");
});

test("buildTableName: case insensitive .CSV extension", () => {
  const result = buildTableName("/some/path/Report.CSV", "tbl_");
  assert.equal(result, "tbl_Report");
});

// ── splitBatches ──────────────────────────────────────────────────────────────

test("splitBatches: 7 rows with batch size 3 → 3 batches [3, 3, 1]", () => {
  const rows = [1, 2, 3, 4, 5, 6, 7];
  const batches = splitBatches(rows, 3);

  assert.equal(batches.length, 3);
  assert.deepEqual(batches[0], [1, 2, 3]);
  assert.deepEqual(batches[1], [4, 5, 6]);
  assert.deepEqual(batches[2], [7]);
});

test("splitBatches: 1 row with batch size 500 → 1 batch", () => {
  const rows = [{ id: 1 }];
  const batches = splitBatches(rows, 500);

  assert.equal(batches.length, 1);
  assert.deepEqual(batches[0], [{ id: 1 }]);
});

// ── buildFieldMappings ────────────────────────────────────────────────────────

test("buildFieldMappings: maps each header to source/target mapping", () => {
  const headers = ["name", "age", "city"];
  const mappings = buildFieldMappings(headers);

  assert.equal(mappings.length, 3);
  assert.deepEqual(mappings[0], {
    source: { name: "name" },
    target: { name: "name", data_type: "VARCHAR(512)" },
  });
  assert.deepEqual(mappings[1], {
    source: { name: "age" },
    target: { name: "age", data_type: "VARCHAR(512)" },
  });
  assert.deepEqual(mappings[2], {
    source: { name: "city" },
    target: { name: "city", data_type: "VARCHAR(512)" },
  });
});

// ── buildDagBody ──────────────────────────────────────────────────────────────

test("buildDagBody: creates correct DAG with trigger step + write step", () => {
  const options: DagBodyOptions = {
    datasourceId: "ds-123",
    datasourceType: "postgresql",
    tableName: "my_table",
    tableExist: false,
    data: [{ name: "Alice", age: "30" }],
    fieldMappings: [
      { source: { name: "name" }, target: { name: "name", data_type: "VARCHAR(512)" } },
      { source: { name: "age" }, target: { name: "age", data_type: "VARCHAR(512)" } },
    ],
  };

  const body = buildDagBody(options);

  // Title must be a non-empty string
  assert.ok(typeof body.title === "string" && body.title.length > 0, "title must be non-empty string");

  // trigger_config must have operator
  assert.ok(typeof body.trigger_config.operator === "string");

  // Must have exactly 2 steps: trigger + write
  assert.equal(body.steps.length, 2);

  const [triggerStep, writeStep] = body.steps;

  // Write step uses @internal/database/write operator
  assert.equal(writeStep!.operator, "@internal/database/write");

  // Write step parameters
  const params = writeStep!.parameters as Record<string, unknown>;
  assert.equal(params.datasource_type, "postgresql");
  assert.equal(params.datasource_id, "ds-123");
  assert.equal(params.table_name, "my_table");
  assert.equal(params.table_exist, false);
  assert.equal(params.operate_type, "append");
  assert.deepEqual(params.data, [{ name: "Alice", age: "30" }]);
  assert.ok(params.sync_model_fields !== undefined, "sync_model_fields must be present");
});

// ── Teardown ──────────────────────────────────────────────────────────────────

test("teardown: remove temp dir", () => {
  rmSync(TMP_DIR, { recursive: true, force: true });
});
