import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { ContextAssembler } from "../src/trace-ai/exp/context/context-assembler.js";
import type { KnSchemaClient } from "../src/trace-ai/exp/context/kn-schema-client.js";
import type { VegaCatalogClient } from "../src/trace-ai/exp/context/vega-catalog-client.js";
import type { SkillApiClient } from "../src/trace-ai/exp/patch/skill-api-client.js";
import type { QueryFailureAnalysis } from "../src/trace-ai/exp/schemas.js";

const mockKnSchema: KnSchemaClient = {
  async getSchema() {
    return {
      object_types: [{ concept_name: "vehicle_sales", data_view_id: "dv-sales", fields: [] }],
      relation_types: [],
    };
  },
};
const mockVega: VegaCatalogClient = { async listDataviews() { return []; } };
const mockSkill: SkillApiClient = { async getSkillContent() { return ""; } };

describe("ContextAssembler with data probes", () => {
  it("includes data_probes in KnContext when probe fn and failureAnalysis provided", async () => {
    const mockProbe = async () => [{ concept_name: "vehicle_sales", data_view_id: "dv-sales", total_records: 1453 }];
    const assembler = new ContextAssembler(mockKnSchema, mockVega, mockSkill, mockProbe as never);

    const failureAnalysis: QueryFailureAnalysis[] = [
      { query_id: "Q38", verdict: "fail", assertion_reason: "wrong", tool_call_summary: ["kn_search(vehicle_sales)→10"] },
    ];
    const { kn_context } = await assembler.assemble("kn.object_type", "kn-x", [], failureAnalysis);

    assert.ok(kn_context);
    assert.ok(Array.isArray(kn_context.data_probes));
    assert.strictEqual(kn_context.data_probes!.length, 1);
    assert.strictEqual(kn_context.data_probes![0].concept_name, "vehicle_sales");
    assert.strictEqual(kn_context.data_probes![0].total_records, 1453);
  });

  it("omits data_probes when no probe fn passed", async () => {
    const assembler = new ContextAssembler(mockKnSchema, mockVega, mockSkill);
    const { kn_context } = await assembler.assemble("kn.object_type", "kn-x", []);
    assert.ok(kn_context);
    assert.strictEqual(kn_context.data_probes, undefined);
  });

  it("omits data_probes when failureAnalysis is empty array", async () => {
    const mockProbe = async () => [{ concept_name: "vehicle_sales", data_view_id: "dv-sales", total_records: 1453 }];
    const assembler = new ContextAssembler(mockKnSchema, mockVega, mockSkill, mockProbe as never);
    const { kn_context } = await assembler.assemble("kn.object_type", "kn-x", [], []);
    assert.ok(kn_context);
    assert.strictEqual(kn_context.data_probes, undefined);
  });

  it("omits data_probes when probe fn throws (best-effort)", async () => {
    const failingProbe = async () => { throw new Error("probe failed"); };
    const assembler = new ContextAssembler(mockKnSchema, mockVega, mockSkill, failingProbe as never);
    const failureAnalysis: QueryFailureAnalysis[] = [
      { query_id: "Q1", verdict: "fail", assertion_reason: "err", tool_call_summary: [] },
    ];
    const { kn_context } = await assembler.assemble("kn.object_type", "kn-x", [], failureAnalysis);
    assert.ok(kn_context);
    assert.strictEqual(kn_context.data_probes, undefined);
  });
});
