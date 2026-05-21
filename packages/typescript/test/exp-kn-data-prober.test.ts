import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { probeObjectTypes } from "../src/trace-ai/exp/context/kn-data-prober.js";
import type { KnSchemaSnapshot, QueryFailureAnalysis } from "../src/trace-ai/exp/schemas.js";

const schema: KnSchemaSnapshot = {
  object_types: [
    { concept_name: "vehicle_sales", data_view_id: "dv-sales", fields: [{ name: "sales", type: "int" }] },
    { concept_name: "config_supplier", data_view_id: "dv-sup", fields: [{ name: "name", type: "string" }] },
    { concept_name: "no_dv", fields: [{ name: "x", type: "string" }] },
  ],
  relation_types: [],
};

const failures: QueryFailureAnalysis[] = [
  { query_id: "Q38", verdict: "fail", assertion_reason: "wrong", tool_call_summary: ["kn_search(vehicle_sales)→10"] },
  { query_id: "Q42", verdict: "fail", assertion_reason: "wrong concept", tool_call_summary: ["kn_search(config_supplier)→8"] },
];

describe("probeObjectTypes", () => {
  it("probes data views for object types mentioned in tool_call_summary", async () => {
    const mockQuery = async (opts: { id: string }) => ({
      total_count: opts.id === "dv-sales" ? 1453 : 142,
    });
    const probes = await probeObjectTypes(schema, failures, mockQuery as never);
    assert.strictEqual(probes.length, 2);
    const salesProbe = probes.find(p => p.concept_name === "vehicle_sales");
    assert.ok(salesProbe);
    assert.strictEqual(salesProbe.total_records, 1453);
    assert.strictEqual(salesProbe.data_view_id, "dv-sales");
  });

  it("skips object types without data_view_id", async () => {
    const failures2: QueryFailureAnalysis[] = [
      { query_id: "Q1", verdict: "fail", assertion_reason: "x", tool_call_summary: ["kn_search(no_dv)→0"] },
    ];
    const probes = await probeObjectTypes(schema, failures2, async () => ({ total_count: 0 }));
    assert.strictEqual(probes.length, 0);
  });

  it("deduplicates when same concept appears in multiple queries", async () => {
    const dupeFailures: QueryFailureAnalysis[] = [
      { query_id: "Q1", verdict: "fail", assertion_reason: "x", tool_call_summary: ["kn_search(vehicle_sales)→1"] },
      { query_id: "Q2", verdict: "fail", assertion_reason: "y", tool_call_summary: ["kn_search(vehicle_sales)→2"] },
    ];
    let callCount = 0;
    const probes = await probeObjectTypes(schema, dupeFailures, async () => { callCount++; return { total_count: 5 }; });
    assert.strictEqual(probes.length, 1);
    assert.strictEqual(callCount, 1);
  });

  it("returns empty array when no tool calls reference known object types", async () => {
    const noMatch: QueryFailureAnalysis[] = [
      { query_id: "Q1", verdict: "fail", assertion_reason: "x", tool_call_summary: [] },
    ];
    const probes = await probeObjectTypes(schema, noMatch, async () => ({ total_count: 0 }));
    assert.deepStrictEqual(probes, []);
  });
});
