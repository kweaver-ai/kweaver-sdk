import test from "node:test";
import assert from "node:assert/strict";
import { ContextAssembler } from "../src/trace-ai/exp/context/context-assembler.js";
import type { VegaCatalogClient } from "../src/trace-ai/exp/context/vega-catalog-client.js";
import type { KnSchemaClient } from "../src/trace-ai/exp/context/kn-schema-client.js";
import type { SkillApiClient } from "../src/trace-ai/exp/patch/skill-api-client.js";

function makeClients(overrides: {
  vega?: Partial<VegaCatalogClient>;
  knSchema?: Partial<KnSchemaClient>;
  skill?: Partial<SkillApiClient>;
} = {}) {
  const vega: VegaCatalogClient = {
    listDataviews: async () => [
      { id: "dv01", name: "ht_data_vehicle_sales", columns: [{ name: "vehicle_sales_id", type: "string" }, { name: "month", type: "string" }] },
    ],
    ...overrides.vega,
  };
  const knSchema: KnSchemaClient = {
    getSchema: async () => ({
      object_types: [{ concept_name: "vehicle", fields: [{ name: "VEHICLEID", type: "string" }] }],
      relation_types: [],
    }),
    ...overrides.knSchema,
  };
  const skill: SkillApiClient = {
    getSkillContent: async (id) => `# ${id} SOP\n\n## query_object_instance\nuse it like this...`,
    publishSkillVersion: async () => ({ version: "v2", content: "" }),
    ...overrides.skill,
  };
  return { vega, knSchema, skill };
}

test("ContextAssembler: kn.object_type — fetches KN schema and Vega catalog in parallel", async () => {
  const knSchemaCalls: string[] = [];
  const vegaCalls: number[] = [];
  const { vega, knSchema, skill } = makeClients({
    knSchema: { getSchema: async (id) => { knSchemaCalls.push(id); return { object_types: [], relation_types: [] }; } },
    vega: { listDataviews: async () => { vegaCalls.push(1); return []; } },
  });
  const assembler = new ContextAssembler(knSchema, vega, skill);
  const result = await assembler.assemble("kn.object_type", "kn01", []);
  assert.ok(result.kn_context);
  assert.equal(result.kn_context.kn_id, "kn01");
  assert.deepEqual(knSchemaCalls, ["kn01"]);
  assert.equal(vegaCalls.length, 1);
  assert.equal(result.skill_context, undefined);
});

test("ContextAssembler: kn.relation_type — same as kn.object_type", async () => {
  const { vega, knSchema, skill } = makeClients();
  const assembler = new ContextAssembler(knSchema, vega, skill);
  const result = await assembler.assemble("kn.relation_type", "kn01", []);
  assert.ok(result.kn_context);
  assert.equal(result.skill_context, undefined);
});

test("ContextAssembler: kn.* — throws if kn_id missing", async () => {
  const { vega, knSchema, skill } = makeClients();
  const assembler = new ContextAssembler(knSchema, vega, skill);
  await assert.rejects(() => assembler.assemble("kn.object_type", undefined, []), /kn_id/);
});

test("ContextAssembler: skill.content — fetches content for all bound skills", async () => {
  const fetched: string[] = [];
  const { vega, knSchema, skill } = makeClients({
    skill: { getSkillContent: async (id) => { fetched.push(id); return `content of ${id}`; } },
  });
  const assembler = new ContextAssembler(knSchema, vega, skill);
  const result = await assembler.assemble("skill.content", undefined, [
    { id: "sop-01", version: "v1" },
    { id: "sop-02", version: "v2" },
  ]);
  assert.equal(result.kn_context, undefined);
  assert.ok(result.skill_context);
  assert.equal(result.skill_context.bound_skills.length, 2);
  assert.deepEqual(new Set(fetched), new Set(["sop-01", "sop-02"]));
  assert.equal(result.skill_context.bound_skills.find(s => s.id === "sop-01")?.content, "content of sop-01");
});

test("ContextAssembler: skill.content — empty bound_skills returns empty skill_context", async () => {
  const { vega, knSchema, skill } = makeClients();
  const assembler = new ContextAssembler(knSchema, vega, skill);
  const result = await assembler.assemble("skill.content", undefined, []);
  assert.ok(result.skill_context);
  assert.deepEqual(result.skill_context.bound_skills, []);
});

test("ContextAssembler: agent.system_prompt — returns empty object", async () => {
  const { vega, knSchema, skill } = makeClients();
  const assembler = new ContextAssembler(knSchema, vega, skill);
  const result = await assembler.assemble("agent.system_prompt", undefined, []);
  assert.equal(result.kn_context, undefined);
  assert.equal(result.skill_context, undefined);
});

test("ContextAssembler: kn_context contains actual dataviews from Vega", async () => {
  const { vega, knSchema, skill } = makeClients();
  const assembler = new ContextAssembler(knSchema, vega, skill);
  const result = await assembler.assemble("kn.object_type", "kn01", []);
  assert.equal(result.kn_context!.available_dataviews.length, 1);
  assert.equal(result.kn_context!.available_dataviews[0].name, "ht_data_vehicle_sales");
});
