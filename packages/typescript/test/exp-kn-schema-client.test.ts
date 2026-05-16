import test from "node:test";
import assert from "node:assert/strict";

test("KnSchemaClient: interface is importable", async () => {
  const mod = await import("../src/trace-ai/exp/context/kn-schema-client.js");
  assert.equal(typeof mod.KweaverKnSchemaClient, "function");
});

test("KweaverKnSchemaClient: throws on real call (expected — use mock in tests)", async () => {
  const { KweaverKnSchemaClient } = await import("../src/trace-ai/exp/context/kn-schema-client.js");
  const client = new KweaverKnSchemaClient("http://localhost", "token");
  await assert.rejects(() => client.getSchema("kn01"), /not yet implemented/);
});
