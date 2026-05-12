import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { parseTracesList, TracesListError } from "../src/trace-ai/scan/traces-list-parser.js";

test("parseTracesList: comma-separated parses to trimmed array", async () => {
  const ids = await parseTracesList("conv1,conv2,conv3");
  assert.deepEqual(ids, ["conv1", "conv2", "conv3"]);
});

test("parseTracesList: whitespace around commas is trimmed", async () => {
  const ids = await parseTracesList("conv1 , conv2 ,conv3");
  assert.deepEqual(ids, ["conv1", "conv2", "conv3"]);
});

test("parseTracesList: empty entries are filtered out", async () => {
  const ids = await parseTracesList("conv1,,conv2,");
  assert.deepEqual(ids, ["conv1", "conv2"]);
});

test("parseTracesList: @file reads one id per line", async () => {
  const f = path.join(await fs.mkdtemp(path.join(os.tmpdir(), "tlp-")), "ids.txt");
  await fs.writeFile(f, "conv_a\nconv_b\nconv_c\n", "utf8");
  const ids = await parseTracesList(`@${f}`);
  assert.deepEqual(ids, ["conv_a", "conv_b", "conv_c"]);
});

test("parseTracesList: @file ignores blank lines and # comments", async () => {
  const f = path.join(await fs.mkdtemp(path.join(os.tmpdir(), "tlp-")), "ids.txt");
  await fs.writeFile(f, "# header\nconv_a\n\n# inline\nconv_b\n", "utf8");
  const ids = await parseTracesList(`@${f}`);
  assert.deepEqual(ids, ["conv_a", "conv_b"]);
});

test("parseTracesList: @file missing → TracesListError code=file-not-found", async () => {
  await assert.rejects(
    () => parseTracesList("@/no/such/file.txt"),
    (e: unknown) => e instanceof TracesListError && (e as TracesListError).code === "file-not-found",
  );
});

test("parseTracesList: @file empty/all-blank → TracesListError code=empty", async () => {
  const f = path.join(await fs.mkdtemp(path.join(os.tmpdir(), "tlp-")), "empty.txt");
  await fs.writeFile(f, "\n\n   \n", "utf8");
  await assert.rejects(
    () => parseTracesList(`@${f}`),
    (e: unknown) => e instanceof TracesListError && (e as TracesListError).code === "empty",
  );
});

test("parseTracesList: empty string → TracesListError code=empty", async () => {
  await assert.rejects(
    () => parseTracesList(""),
    (e: unknown) => e instanceof TracesListError && (e as TracesListError).code === "empty",
  );
});

test("parseTracesList: only commas → TracesListError code=empty", async () => {
  await assert.rejects(
    () => parseTracesList(",,,"),
    (e: unknown) => e instanceof TracesListError && (e as TracesListError).code === "empty",
  );
});
