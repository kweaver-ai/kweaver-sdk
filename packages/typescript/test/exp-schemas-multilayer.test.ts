// test/exp-schemas-multilayer.test.ts
import test from "node:test";
import assert from "node:assert/strict";
import {
  PatchTargetSchema,
  FailureAttributionSchema,
  NextChangeSchema,
  VegaCatalogEntrySchema,
  KnSchemaSnapshotSchema,
  KnContextSchema,
  SkillContextSchema,
  CandidateSchema,
  LineageEntrySchema,
} from "../src/trace-ai/exp/schemas.js";

test("PatchTargetSchema: accepts all five targets", () => {
  for (const t of ["agent.system_prompt", "agent.skills", "kn.object_type", "kn.relation_type", "skill.content"]) {
    assert.equal(PatchTargetSchema.safeParse(t).success, true);
  }
});

test("PatchTargetSchema: rejects unknown", () => {
  assert.equal(PatchTargetSchema.safeParse("bkn.foo").success, false);
});

test("FailureAttributionSchema: valid", () => {
  const r = FailureAttributionSchema.safeParse({
    layer: "kn", evidence: "no vehicle_sales", affected_queries: ["Q36"], suggested_target: "kn.object_type",
  });
  assert.equal(r.success, true);
});

test("FailureAttributionSchema: rejects bad layer", () => {
  assert.equal(FailureAttributionSchema.safeParse({ layer: "db", evidence: "x", affected_queries: [], suggested_target: "kn.object_type" }).success, false);
});

test("NextChangeSchema: kn.object_type with full patch", () => {
  const r = NextChangeSchema.safeParse({
    target: "kn.object_type",
    hypothesis: "vehicle_sales missing",
    patch: {
      kn_id: "kn01",
      add_object_types: [{ concept_name: "vehicle_sales", dataview_id: "dv01", primary_keys: ["vehicle_sales_id"], data_properties: [{ name: "month", type: "string" }] }],
      add_relation_types: [],
    },
  });
  assert.equal(r.success, true);
});

test("NextChangeSchema: skill.content", () => {
  const r = NextChangeSchema.safeParse({
    target: "skill.content",
    hypothesis: "missing sort_by",
    patch: { skill_id: "sop-01", append_section: "## Sort\n- use sort_by" },
  });
  assert.equal(r.success, true);
});

test("NextChangeSchema: agent.system_prompt backward compat", () => {
  const r = NextChangeSchema.safeParse({
    target: "agent.system_prompt", patch: { agent: { system_prompt: "new" } },
  });
  assert.equal(r.success, true);
});

test("NextChangeSchema: rejects unknown target", () => {
  assert.equal(NextChangeSchema.safeParse({ target: "bkn.foo", patch: {} }).success, false);
});

test("VegaCatalogEntrySchema: valid", () => {
  const r = VegaCatalogEntrySchema.safeParse({
    id: "dv01", name: "ht_data_vehicle_sales",
    columns: [{ name: "vehicle_sales_id", type: "string" }, { name: "month", type: "string" }],
  });
  assert.equal(r.success, true);
});

test("KnSchemaSnapshotSchema: valid", () => {
  const r = KnSchemaSnapshotSchema.safeParse({
    object_types: [{ concept_name: "vehicle", fields: [{ name: "VEHICLEID", type: "string" }] }],
    relation_types: [],
  });
  assert.equal(r.success, true);
});

test("KnContextSchema: valid", () => {
  const r = KnContextSchema.safeParse({
    kn_id: "kn01",
    existing_schema: { object_types: [], relation_types: [] },
    available_dataviews: [{ id: "dv01", name: "ht_vehicle_sales", columns: [] }],
  });
  assert.equal(r.success, true);
});

test("SkillContextSchema: valid", () => {
  const r = SkillContextSchema.safeParse({
    bound_skills: [{ id: "sop-01", version: "v1", content: "# SOP\n..." }],
  });
  assert.equal(r.success, true);
});

test("CandidateSchema: accepts kn section", () => {
  const r = CandidateSchema.safeParse({
    schema_version: "trace-candidate/v1",
    agent: { description: "x", system_prompt: "y" },
    kn: { id: "kn01", object_types: [], relation_types: [] },
  });
  assert.equal(r.success, true);
});

test("CandidateSchema: kn section optional", () => {
  assert.equal(CandidateSchema.safeParse({ schema_version: "trace-candidate/v1", agent: { description: "x", system_prompt: "y" } }).success, true);
});

test("LineageEntrySchema: skill_set + kn_patch_log default to []", () => {
  const r = LineageEntrySchema.safeParse({ version: 1, agent_id: "agt_01" });
  assert.equal(r.success, true);
  if (r.success) {
    assert.deepEqual(r.data.skill_set, []);
    assert.deepEqual(r.data.kn_patch_log, []);
  }
});

test("LineageEntrySchema: accepts skill_set and kn_patch_log", () => {
  const r = LineageEntrySchema.safeParse({
    version: 2, agent_id: "agt_01",
    skill_set: [{ id: "sop-01", version: "v2" }],
    kn_patch_log: [{ op: "add_object_type", concept_name: "vehicle_sales", dataview_id: "dv01", applied_at: "2026-05-16T00:00:00Z" }],
  });
  assert.equal(r.success, true);
});
