import test from "node:test";
import assert from "node:assert/strict";
import {
  getFirstSqlTokenAfterComments,
  isDataviewSelectLikeSql,
} from "../src/commands/dataview.js";

test("isDataviewSelectLikeSql accepts SELECT and WITH", () => {
  assert.equal(isDataviewSelectLikeSql("SELECT 1"), true);
  assert.equal(isDataviewSelectLikeSql("  select * from t"), true);
  assert.equal(isDataviewSelectLikeSql("WITH x AS (SELECT 1) SELECT * FROM x"), true);
});

test("isDataviewSelectLikeSql rejects DDL/DML", () => {
  assert.equal(isDataviewSelectLikeSql("INSERT INTO t VALUES (1)"), false);
  assert.equal(isDataviewSelectLikeSql("UPDATE t SET a=1"), false);
  assert.equal(isDataviewSelectLikeSql("DELETE FROM t"), false);
  assert.equal(isDataviewSelectLikeSql("DROP TABLE t"), false);
  assert.equal(isDataviewSelectLikeSql("CREATE TABLE t (a int)"), false);
});

test("getFirstSqlTokenAfterComments skips line and block comments", () => {
  assert.equal(getFirstSqlTokenAfterComments("-- hello\nSELECT 1"), "select");
  assert.equal(getFirstSqlTokenAfterComments("/* c */ SELECT 1"), "select");
});
