import test from "node:test";
import assert from "node:assert/strict";
import type { VegaCatalogClient } from "../src/trace-ai/exp/context/vega-catalog-client.js";

test("VegaCatalogClient: interface is importable", async () => {
  const mod = await import("../src/trace-ai/exp/context/vega-catalog-client.js");
  assert.equal(typeof mod.KweaverVegaCatalogClient, "function");
});

test("KweaverVegaCatalogClient: throws on real call (expected — use mock in tests)", async () => {
  const { KweaverVegaCatalogClient } = await import("../src/trace-ai/exp/context/vega-catalog-client.js");
  const client = new KweaverVegaCatalogClient("http://localhost", "token");
  await assert.rejects(() => client.listDataviews(), /not yet implemented/);
});
