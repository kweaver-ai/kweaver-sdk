import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { liftFromQueriesFile, QueryPickerError } from "../src/trace-ai/eval-set/query-picker.js";

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
