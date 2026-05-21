import test from "node:test";
import assert from "node:assert/strict";
import type { VegaCatalogClient } from "../src/trace-ai/exp/context/vega-catalog-client.js";

test("VegaCatalogClient: interface is importable", async () => {
  const mod = await import("../src/trace-ai/exp/context/vega-catalog-client.js");
  assert.equal(typeof mod.KweaverVegaCatalogClient, "function");
});

test("KweaverVegaCatalogClient: returns empty array (data_probes is the primary enrichment path)", async () => {
  const { KweaverVegaCatalogClient } = await import("../src/trace-ai/exp/context/vega-catalog-client.js");
  const client = new KweaverVegaCatalogClient("http://localhost", "token");
  const result = await client.listDataviews();
  assert.deepEqual(result, []);
});
