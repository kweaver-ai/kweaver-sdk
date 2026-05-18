import test, { describe, it } from "node:test";
import assert from "node:assert/strict";

test("KnSchemaClient: interface is importable", async () => {
  const mod = await import("../src/trace-ai/exp/context/kn-schema-client.js");
  assert.equal(typeof mod.KweaverKnSchemaClient, "function");
});

describe("KweaverKnSchemaClient.getSchema", () => {
  it("maps searchSchema response to KnSchemaSnapshot", async () => {
    const mockSearchSchema = async (_opts: unknown, _args: unknown) => ({
      object_types: [
        {
          concept_name: "vehicle_sales",
          data_source: { id: "dv-001", type: "data_view" },
          properties: [{ name: "sales", type: "integer" }, { name: "month", type: "string" }],
        },
      ],
      relation_types: [],
    });

    const { KweaverKnSchemaClient } = await import("../src/trace-ai/exp/context/kn-schema-client.js");
    const client = new KweaverKnSchemaClient("http://host", "tok", mockSearchSchema as never);
    const schema = await client.getSchema("kn-123");

    assert.strictEqual(schema.object_types.length, 1);
    assert.strictEqual(schema.object_types[0].concept_name, "vehicle_sales");
    assert.strictEqual(schema.object_types[0].data_view_id, "dv-001");
    assert.deepStrictEqual(
      schema.object_types[0].fields,
      [{ name: "sales", type: "integer" }, { name: "month", type: "string" }],
    );
    assert.deepStrictEqual(schema.relation_types, []);
  });

  it("handles missing data_source gracefully", async () => {
    const mockSearchSchema = async () => ({
      object_types: [{ concept_name: "orphan", properties: [] }],
      relation_types: [],
    });
    const { KweaverKnSchemaClient } = await import("../src/trace-ai/exp/context/kn-schema-client.js");
    const client = new KweaverKnSchemaClient("http://host", "tok", mockSearchSchema as never);
    const schema = await client.getSchema("kn-x");
    assert.strictEqual(schema.object_types[0].data_view_id, undefined);
  });
});
