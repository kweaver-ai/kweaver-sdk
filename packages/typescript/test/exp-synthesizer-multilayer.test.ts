// test/exp-synthesizer-multilayer.test.ts
import test from "node:test";
import assert from "node:assert/strict";
import {
  buildKnContextPrompt,
  buildSkillContextPrompt,
  buildSynthesizerPrompt,
} from "../src/trace-ai/exp/providers/synthesizer-client.js";
import type { SynthesizerInput } from "../src/trace-ai/exp/providers/synthesizer-client.js";
import type { KnContext, Mission, SkillContext } from "../src/trace-ai/exp/schemas.js";

const minimalMission: Mission = {
  schema_version: "trace-mission/v1",
  goal: "reduce retries",
  eval_sets: [{ path: "eval-sets/v1", role: "seed" }],
  current_candidate: { path: "candidates/baseline.yaml" },
};

const minimalInput: SynthesizerInput = {
  mission: minimalMission,
  candidateConfig: { agent: { system_prompt: "old" } },
  prevRounds: [],
};

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

// ── buildSynthesizerPrompt (extracted from generate()) ────────────────────

test("buildSynthesizerPrompt: contains all required output instruction fields", () => {
  const prompt = buildSynthesizerPrompt(minimalInput);
  for (const field of ["target", "hypothesis", "patch"]) {
    assert.match(prompt, new RegExp(`"${field}"`), `prompt should mention required field ${field}`);
  }
});

test("buildSynthesizerPrompt: has output example for every NextChange target", () => {
  const prompt = buildSynthesizerPrompt(minimalInput);
  // Each target must appear as a "target":"<literal>" example in OUTPUT EXAMPLES.
  const targets = [
    "agent.system_prompt",
    "agent.skills",
    "kn.object_type",
    "kn.relation_type",
    "skill.content",
  ];
  for (const t of targets) {
    assert.match(prompt, new RegExp(`"target":"${t.replace(/\./g, "\\.")}"`), `missing output example for ${t}`);
  }
});

test("buildSynthesizerPrompt: kn.* example shows structured patch shape, not string", () => {
  const prompt = buildSynthesizerPrompt(minimalInput);
  // KnPatch requires {kn_id, add_object_types:[{...primary_keys, data_properties}], add_relation_types}
  assert.match(prompt, /add_object_types/, "kn example must mention add_object_types");
  assert.match(prompt, /primary_keys/, "kn example must mention primary_keys");
  assert.match(prompt, /data_properties/, "kn example must mention data_properties");
});

test("buildSynthesizerPrompt: skill.content example shows {skill_id, append_section} shape", () => {
  const prompt = buildSynthesizerPrompt(minimalInput);
  assert.match(prompt, /"skill_id"/);
  assert.match(prompt, /"append_section"/);
});

test("buildSynthesizerPrompt: agent.skills example shows {unbind, bind} shape", () => {
  const prompt = buildSynthesizerPrompt(minimalInput);
  assert.match(prompt, /"unbind"/);
  assert.match(prompt, /"bind"/);
});

test("buildSynthesizerPrompt: renders failure_attribution when present", () => {
  const prompt = buildSynthesizerPrompt({
    ...minimalInput,
    failure_attribution: [
      { layer: "kn", evidence: "missing concept X", affected_queries: ["Q1"], suggested_target: "kn.object_type" },
    ],
  });
  assert.match(prompt, /FAILURE ATTRIBUTION/);
  assert.match(prompt, /missing concept X/);
  assert.match(prompt, /suggested_target=kn\.object_type/);
});

test("buildSynthesizerPrompt: includes kn_context section when provided", () => {
  const prompt = buildSynthesizerPrompt({ ...minimalInput, kn_context: knContext });
  assert.match(prompt, /Existing KN Schema/);
  assert.match(prompt, /ht_data_513_vehicle_sales/);
});
