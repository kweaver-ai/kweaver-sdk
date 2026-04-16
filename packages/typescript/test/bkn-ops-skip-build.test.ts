import test from "node:test";
import assert from "node:assert/strict";

import { parseKnCreateFromDsArgs, shouldSkipBuildForResourceOTs } from "../src/commands/bkn-ops.js";

test("parseKnCreateFromDsArgs defaults --build to true", () => {
  const opts = parseKnCreateFromDsArgs(["ds-1", "--name", "test-kn"]);
  assert.equal(opts.build, true);
});

test("shouldSkipBuildForResourceOTs returns true when all OTs are resource-backed", () => {
  const otEntries = [
    { name: "users", data_source: { type: "resource", id: "res-1" } },
    { name: "orders", data_source: { type: "resource", id: "res-2" } },
  ];
  assert.equal(shouldSkipBuildForResourceOTs(otEntries), true);
});

test("shouldSkipBuildForResourceOTs returns false when some OTs are data_view-backed", () => {
  const otEntries = [
    { name: "users", data_source: { type: "resource", id: "res-1" } },
    { name: "orders", data_source: { type: "data_view", id: "dv-1" } },
  ];
  assert.equal(shouldSkipBuildForResourceOTs(otEntries), false);
});

test("shouldSkipBuildForResourceOTs returns false for empty list", () => {
  assert.equal(shouldSkipBuildForResourceOTs([]), false);
});
