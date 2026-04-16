import test from "node:test";
import assert from "node:assert/strict";

import { generateObjectTypeBkn } from "../src/commands/bkn-ops.js";

test("generateObjectTypeBkn uses 'resource' as data source type, not 'data_view'", () => {
  const md = generateObjectTypeBkn("users", "res-1", "id", "name", [
    { name: "id", type: "int" },
    { name: "name", type: "varchar" },
  ]);
  assert.ok(md.includes("| resource |"), "data source type should be 'resource'");
  assert.ok(!md.includes("| data_view |"), "should not contain 'data_view'");
});
