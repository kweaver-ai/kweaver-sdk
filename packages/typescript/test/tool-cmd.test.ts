import test from "node:test";
import assert from "node:assert/strict";
import { parseToolUploadArgs, parseToolStatusArgs } from "../src/commands/tool.js";

test("parseToolUploadArgs requires --toolbox and a file path", () => {
  assert.throws(() => parseToolUploadArgs([]), /--toolbox/);
  assert.throws(() => parseToolUploadArgs(["--toolbox", "b1"]), /file/i);
});

test("parseToolUploadArgs parses positional file + flags", () => {
  const opts = parseToolUploadArgs(["--toolbox", "b1", "/tmp/spec.json"]);
  assert.equal(opts.boxId, "b1");
  assert.equal(opts.filePath, "/tmp/spec.json");
  assert.equal(opts.metadataType, "openapi");
});

test("parseToolStatusArgs requires --toolbox and at least one id", () => {
  assert.throws(() => parseToolStatusArgs([], "enabled"), /--toolbox/);
  assert.throws(() => parseToolStatusArgs(["--toolbox", "b1"], "enabled"), /tool.*id/i);
});

test("parseToolStatusArgs accepts multiple tool ids", () => {
  const opts = parseToolStatusArgs(["--toolbox", "b1", "t1", "t2"], "enabled");
  assert.equal(opts.boxId, "b1");
  assert.deepEqual(opts.toolIds, ["t1", "t2"]);
  assert.equal(opts.status, "enabled");
});

test("parseToolStatusArgs flows status='disabled' through", () => {
  const opts = parseToolStatusArgs(["--toolbox", "b1", "t1"], "disabled");
  assert.equal(opts.status, "disabled");
});

test("parseToolUploadArgs handles file-path before --toolbox", () => {
  const opts = parseToolUploadArgs(["/tmp/spec.json", "--toolbox", "b1"]);
  assert.equal(opts.boxId, "b1");
  assert.equal(opts.filePath, "/tmp/spec.json");
});

test("parseToolUploadArgs rejects unsupported --metadata-type", () => {
  assert.throws(
    () => parseToolUploadArgs(["--toolbox", "b1", "--metadata-type", "swagger", "/tmp/spec.json"]),
    /metadata-type/i
  );
});
