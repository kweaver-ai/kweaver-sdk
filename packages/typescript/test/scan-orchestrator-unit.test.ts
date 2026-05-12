import test from "node:test";
import assert from "node:assert/strict";

import { type RunBatchOpts, type RunBatchResult } from "../src/trace-ai/scan/index.js";

test("runBatch types: RunBatchOpts exposes traces[], out, ...PR-B opts", () => {
  // Compile-time test — if module exports don't exist or types diverge, this fails to load.
  const fakeOpts: RunBatchOpts = {
    traces: ["conv1", "conv2"],
    out: "/tmp/whatever",
    rulesDir: null,
    noBuiltin: false,
    noArtifacts: false,
    lang: "en",
    timeoutMs: 60000,
    maxParallel: 4,
    baseUrl: "http://x",
    token: "tk",
    businessDomain: "bd_public",
  };
  // Type-level check; no runtime assertion needed beyond this allocation.
  assert.equal(fakeOpts.traces.length, 2);
});

test("runBatch types: RunBatchResult has scanSummaryPath + perTraceReportPaths", () => {
  const fakeResult: RunBatchResult = {
    scanSummaryPath: "/tmp/whatever/scan-summary.yaml",
    perTraceReportPaths: ["/tmp/whatever/conv1.yaml", "/tmp/whatever/conv2.yaml"],
    tracesDiagnosed: 2,
    tracesReused: 0,
  };
  assert.equal(fakeResult.tracesDiagnosed, 2);
});
