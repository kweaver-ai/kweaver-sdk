import test from "node:test";
import assert from "node:assert/strict";

import { resolveArtifactsBase } from "../src/trace-ai/scan/artifacts/paths.js";

test("batch mode: --out=<dir> → <dir>/artifacts/", () => {
  assert.equal(resolveArtifactsBase({ mode: "batch", out: "diagnosis/ticket-42" }), "diagnosis/ticket-42/artifacts");
});

test("batch mode: trailing slash on --out is normalized", () => {
  assert.equal(resolveArtifactsBase({ mode: "batch", out: "diagnosis/ticket-42/" }), "diagnosis/ticket-42/artifacts");
});

test("single-trace mode: --out=<dir>/<stem>.yaml → <dir>/<stem>.artifacts/", () => {
  assert.equal(resolveArtifactsBase({ mode: "single", out: "diagnosis/refund.yaml" }), "diagnosis/refund.artifacts");
});

test("single-trace mode: --out=<dir>/<stem>.yml → <dir>/<stem>.artifacts/", () => {
  assert.equal(resolveArtifactsBase({ mode: "single", out: "diagnosis/refund.yml" }), "diagnosis/refund.artifacts");
});

test("single-trace mode: --out=<dir>/<stem>.md → <dir>/<stem>.artifacts/", () => {
  assert.equal(resolveArtifactsBase({ mode: "single", out: "diagnosis/refund.md" }), "diagnosis/refund.artifacts");
});

test("single-trace mode: --out without extension → <out>.artifacts/", () => {
  assert.equal(resolveArtifactsBase({ mode: "single", out: "diagnosis/refund" }), "diagnosis/refund.artifacts");
});
