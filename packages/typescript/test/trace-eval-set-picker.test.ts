import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { liftFromQueriesFile, liftFromDiagnosis, QueryPickerError } from "../src/trace-ai/eval-set/query-picker.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = (name: string) => path.join(__dirname, "fixtures", "eval-set", name);

test("liftFromQueriesFile lifts a valid simplified input file", async () => {
  const cases = await liftFromQueriesFile(FIXTURE("queries-input-valid.yaml"));
  assert.equal(cases.length, 2);
  assert.equal(cases[0].query_id, "refund_001");
  assert.equal(cases[0].reference?.answer, "请在订单详情页点击申请退款。");
  assert.equal(cases[0].assertions?.[0].type, "semantic_match");
  assert.equal(cases[1].input.user_message, "查询账户余额");
  // query_id 未填时 picker 透传空串（NOT undefined）让 builder.ensureQueryId 后续填入；
  // EvalCase.query_id 在 types.ts 是必填 string，picker 阶段不允许 undefined
  assert.equal(cases[1].query_id, "");
});

test("liftFromQueriesFile rejects refinement-violating input (both reference and assertions empty)", async () => {
  await assert.rejects(
    liftFromQueriesFile(FIXTURE("queries-input-empty-refinement.yaml")),
    (e) => e instanceof QueryPickerError && /reference.*assertions/.test(e.message),
  );
});

test("liftFromQueriesFile rejects nonexistent file with clear error", async () => {
  await assert.rejects(
    liftFromQueriesFile("/nonexistent/path.yaml"),
    (e) => e instanceof QueryPickerError && /file not found/i.test(e.message),
  );
});

test("liftFromQueriesFile rejects malformed yaml", async () => {
  const tmpPath = path.join(__dirname, "fixtures", "eval-set", "broken.yaml");
  const fs = await import("node:fs/promises");
  await fs.writeFile(tmpPath, "schema_version: trace-eval-set-input/v1\ncases: [\n", "utf8");
  try {
    await assert.rejects(
      liftFromQueriesFile(tmpPath),
      (e) => e instanceof QueryPickerError,
    );
  } finally {
    await fs.unlink(tmpPath);
  }
});

test("liftFromDiagnosis lifts suggested_eval_case from M4 report findings", async () => {
  // Use independent subdir to avoid mixing with queries-input fixtures
  const subDir = path.join(__dirname, "fixtures", "eval-set", "diagnose-only");
  const fs = await import("node:fs/promises");
  await fs.mkdir(subDir, { recursive: true });
  await fs.copyFile(
    path.join(__dirname, "fixtures", "eval-set", "diagnose-report-sample.yaml"),
    path.join(subDir, "diagnose-report-sample.yaml"),
  );
  try {
    const result = await liftFromDiagnosis(subDir);
    // 2 findings in fixture: 1st has query="如何申请退款？" + 1 assertion → lifted
    //                       2nd has query=null + empty assertions → skipped
    assert.equal(result.cases.length, 1);
    assert.equal(result.skipped_findings_count, 1);
    const c = result.cases[0];
    assert.equal(c.input.user_message, "如何申请退款？");
    assert.equal(c.query_id, "conv_abc");
    assert.ok(c.assertions && c.assertions.length === 1);
    assert.equal(c.assertions[0].type, "contains");
    assert.equal(c.assertions[0].value, "tool_call_count(retrieval) <= 2");
    assert.ok(typeof c.assertions[0]._note === "string");
  } finally {
    await fs.rm(subDir, { recursive: true, force: true });
  }
});

test("liftFromDiagnosis fails fast when dir contains a non-diagnose-report yaml", async () => {
  // The shared fixtures/eval-set dir has queries-input-*.yaml mixed in;
  // liftFromDiagnosis must fail-fast when it sees a yaml that doesn't
  // match the M4 ReportSchema (treat all *.yaml in dir as diagnose reports)
  await assert.rejects(
    liftFromDiagnosis(path.join(__dirname, "fixtures", "eval-set")),
    (e) => e instanceof QueryPickerError && /schema validation failed/.test(e.message),
  );
});

test("liftFromDiagnosis returns directory-not-found error for missing dir", async () => {
  await assert.rejects(
    liftFromDiagnosis("/nonexistent/dir/path"),
    (e) => e instanceof QueryPickerError && /directory not found/i.test(e.message),
  );
});
