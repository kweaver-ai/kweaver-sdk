import test from "node:test";
import assert from "node:assert/strict";

import { runKnMetricCommand } from "../src/commands/bkn-metric.js";

test("bkn metric --help returns 0 without auth", async () => {
  const code = await runKnMetricCommand(["--help"]);
  assert.equal(code, 0);
});

test("bkn metric with no action shows help", async () => {
  const code = await runKnMetricCommand([]);
  assert.equal(code, 0);
});
