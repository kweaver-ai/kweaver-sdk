// test/exp-list-info-dispatch.test.ts
import test from "node:test";
import assert from "node:assert/strict";
import { parseExpArgs } from "../src/trace-ai/exp/index.js";

test("parseExpArgs: parses 'list' with no dir → expDir is empty string", () => {
  const result = parseExpArgs(["list"]);
  assert.equal(result.subcommand, "list");
  assert.equal(result.expDir, "");
});

test("parseExpArgs: parses 'list' with explicit path → expDir is resolved", () => {
  const result = parseExpArgs(["list", "/some/path"]);
  assert.equal(result.subcommand, "list");
  assert.equal(result.expDir, "/some/path");
});

test("parseExpArgs: parses 'info' with no dir → expDir is empty string", () => {
  const result = parseExpArgs(["info"]);
  assert.equal(result.subcommand, "info");
  assert.equal(result.expDir, "");
});

test("parseExpArgs: parses 'info' with explicit path → expDir is resolved", () => {
  const result = parseExpArgs(["info", "/some/path"]);
  assert.equal(result.subcommand, "info");
  assert.equal(result.expDir, "/some/path");
});

test("parseExpArgs: error message includes list and info", () => {
  assert.throws(
    () => parseExpArgs(["bogus"]),
    /list.*info|info.*list/i,
  );
});

test("parseExpArgs: still accepts all legacy subcommands", () => {
  for (const sub of ["run", "resume", "show", "status", "abort", "doctor"]) {
    const result = parseExpArgs([sub]);
    assert.equal(result.subcommand, sub);
  }
});
