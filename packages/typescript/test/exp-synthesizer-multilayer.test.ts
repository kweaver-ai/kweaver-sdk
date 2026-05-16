// test/exp-synthesizer-multilayer.test.ts
import test from "node:test";
import assert from "node:assert/strict";
import {
  buildKnContextPrompt,
  buildSkillContextPrompt,
} from "../src/trace-ai/exp/providers/synthesizer-client.js";
import type { KnContext, SkillContext } from "../src/trace-ai/exp/schemas.js";

const knContext: KnContext = {
  kn_id: "kn01",
  existing_schema: {
    object_types: [{ concept_name: "vehicle", fields: [{ name: "VEHICLEID", type: "string" }] }],
    relation_types: [],
  },
  available_dataviews: [
    { id: "dv01", name: "ht_data_513_vehicle_sales", columns: [{ name: "vehicle_sales_id", type: "string" }, { name: "vehicle_id", type: "string" }, { name: "month", type: "string" }] },
    { id: "dv02", name: "ht_data_customer", columns: [{ name: "customer_id", type: "string" }] },
  ],
};

const skillContext: SkillContext = {
  bound_skills: [
    { id: "industry-sop", version: "v1", content: "# Industry SOP\n## query_object_instance\nUse this tool to query objects." },
    { id: "query-sop", version: "v2", content: "# Query SOP\n## General guidance\nUse kn_search first." },
  ],
};

test("buildKnContextPrompt: contains existing object type names", () => {
  const prompt = buildKnContextPrompt(knContext);
  assert.match(prompt, /vehicle/);
  assert.match(prompt, /VEHICLEID/);
});

test("buildKnContextPrompt: contains all available dataview names and ids", () => {
  const prompt = buildKnContextPrompt(knContext);
  assert.match(prompt, /ht_data_513_vehicle_sales/);
  assert.match(prompt, /dv01/);
  assert.match(prompt, /ht_data_customer/);
});

test("buildKnContextPrompt: contains join_key normalization rule", () => {
  const prompt = buildKnContextPrompt(knContext);
  assert.match(prompt, /lowercase/i);
  assert.match(prompt, /underscore/i);
});

test("buildKnContextPrompt: mentions primary_keys inference rule", () => {
  const prompt = buildKnContextPrompt(knContext);
  assert.match(prompt, /primary_key/i);
  assert.match(prompt, /_id/);
});

test("buildSkillContextPrompt: lists all bound skills with their content", () => {
  const prompt = buildSkillContextPrompt(skillContext);
  assert.match(prompt, /industry-sop/);
  assert.match(prompt, /query_object_instance/);
  assert.match(prompt, /query-sop/);
  assert.match(prompt, /kn_search/);
});

test("buildSkillContextPrompt: instructs to identify skill by tool name in evidence", () => {
  const prompt = buildSkillContextPrompt(skillContext);
  assert.match(prompt, /skill_id/);
  assert.match(prompt, /tool/i);
});
