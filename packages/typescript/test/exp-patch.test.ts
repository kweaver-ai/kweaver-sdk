import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { PatchApplier } from "../src/trace-ai/exp/patch/index.js";
import type { KnApiClient } from "../src/trace-ai/exp/patch/kn-api-client.js";
import type { SkillApiClient } from "../src/trace-ai/exp/patch/skill-api-client.js";
import type { KnObjectTypeDef, KnRelationTypeDef } from "../src/trace-ai/exp/schemas.js";

async function mkWorkDir(): Promise<string> {
  return await fs.mkdtemp(path.join(os.tmpdir(), "patch-test-"));
}

const baseCandidate = {
  candidate_version: "v0",
  agent: {
    model: "claude-sonnet-4-6",
    temperature: 0.3,
    system_prompt: "You are an agent.",
    skills: [{ id: "skill-a", version: "v1" }],
  },
};

test("PatchApplier: agent.system_prompt with string patch", async () => {
  const work = await mkWorkDir();
  const applier = new PatchApplier(work);
  const { candidate } = await applier.apply(baseCandidate, {
    target: "agent.system_prompt",
    hypothesis: "new prompt",
    patch: JSON.stringify({ agent: { system_prompt: "New prompt." } }),
  });
  const agent = candidate["agent"] as Record<string, unknown>;
  assert.equal(agent["system_prompt"], "New prompt.");
  assert.equal(agent["model"], "claude-sonnet-4-6");
});

test("PatchApplier: agent.system_prompt with object patch (auto-stringified)", async () => {
  const work = await mkWorkDir();
  const applier = new PatchApplier(work);
  const { candidate } = await applier.apply(baseCandidate, {
    target: "agent.system_prompt",
    patch: { agent: { system_prompt: "Object prompt." } },
  });
  assert.equal((candidate["agent"] as Record<string, unknown>)["system_prompt"], "Object prompt.");
});

test("PatchApplier: agent.skills unbinds then binds", async () => {
  const work = await mkWorkDir();
  const applier = new PatchApplier(work);
  const { candidate } = await applier.apply(baseCandidate, {
    target: "agent.skills",
    patch: { unbind: ["skill-a"], bind: [{ id: "skill-b", version: "v2" }] },
  });
  const skills = (candidate["agent"] as Record<string, unknown>)["skills"] as Array<{ id: string; version: string }>;
  assert.deepEqual(skills, [{ id: "skill-b", version: "v2" }]);
});

test("PatchApplier: agent.skills bind replaces existing same-id binding", async () => {
  const work = await mkWorkDir();
  const applier = new PatchApplier(work);
  const { candidate } = await applier.apply(baseCandidate, {
    target: "agent.skills",
    patch: { unbind: [], bind: [{ id: "skill-a", version: "v9" }] },
  });
  const skills = (candidate["agent"] as Record<string, unknown>)["skills"] as Array<{ id: string; version: string }>;
  assert.deepEqual(skills, [{ id: "skill-a", version: "v9" }]);
});

test("PatchApplier: kn.object_type calls KnPatcher and merges into candidate.kn", async () => {
  const work = await mkWorkDir();
  const calls: string[] = [];
  const objSpec: KnObjectTypeDef = {
    concept_name: "vehicle_sales",
    dataview_id: "dv-sales",
    primary_keys: ["id"],
    data_properties: [{ name: "sales", type: "integer" }],
  };
  const knClient: KnApiClient = {
    async validateObjectType() { return { valid: true }; },
    async addObjectType(_kn, spec) { calls.push(`add:${spec.concept_name}`); return { concept_id: "c1" }; },
    async validateRelationType() { return { valid: true }; },
    async addRelationType() { return { relation_id: "r1" }; },
    async objectTypeExists() { return false; },
    async relationTypeExists() { return false; },
  };
  const applier = new PatchApplier(work, knClient);
  const { candidate } = await applier.apply(baseCandidate, {
    target: "kn.object_type",
    hypothesis: "add vehicle_sales",
    patch: { kn_id: "kn-1", add_object_types: [objSpec], add_relation_types: [] },
  });
  assert.deepEqual(calls, ["add:vehicle_sales"]);
  const kn = candidate["kn"] as Record<string, unknown>;
  assert.equal(kn["id"], "kn-1");
  assert.deepEqual(kn["object_types"], [objSpec]);
});

test("PatchApplier: kn.relation_type merges into candidate.kn.relation_types", async () => {
  const work = await mkWorkDir();
  const relSpec: KnRelationTypeDef = {
    concept_name: "sold_by", source_object_type: "vehicle", target_object_type: "dealer", join_key: "dealer_id",
  };
  const knClient: KnApiClient = {
    async validateObjectType() { return { valid: true }; },
    async addObjectType() { return { concept_id: "c1" }; },
    async validateRelationType() { return { valid: true }; },
    async addRelationType() { return { relation_id: "r1" }; },
    async objectTypeExists() { return false; },
    async relationTypeExists() { return false; },
  };
  const applier = new PatchApplier(work, knClient);
  const { candidate } = await applier.apply(baseCandidate, {
    target: "kn.relation_type",
    hypothesis: "add sold_by",
    patch: { kn_id: "kn-1", add_object_types: [], add_relation_types: [relSpec] },
  });
  const kn = candidate["kn"] as Record<string, unknown>;
  assert.deepEqual(kn["relation_types"], [relSpec]);
});

test("PatchApplier: skill.content publishes and bumps candidate.agent.skills version", async () => {
  const work = await mkWorkDir();
  const publishes: Array<{ id: string; content: string }> = [];
  const skillClient: SkillApiClient = {
    async getSkillContent(id) { return `# ${id} existing`; },
    async publishSkillVersion(id, content) { publishes.push({ id, content }); return { version: "v7", content }; },
  };
  const applier = new PatchApplier(work, undefined, skillClient);
  const { candidate, skillVersion } = await applier.apply(baseCandidate, {
    target: "skill.content",
    hypothesis: "append usage note",
    patch: { skill_id: "skill-a", append_section: "## New section" },
  });
  assert.equal(skillVersion, "v7");
  assert.equal(publishes.length, 1);
  assert.equal(publishes[0]?.id, "skill-a");
  assert.match(publishes[0]?.content ?? "", /## New section/);
  const skills = (candidate["agent"] as Record<string, unknown>)["skills"] as Array<{ id: string; version: string }>;
  assert.deepEqual(skills, [{ id: "skill-a", version: "v7" }]);
});

test("PatchApplier: kn.* without KnApiClient throws", async () => {
  const work = await mkWorkDir();
  const applier = new PatchApplier(work);
  await assert.rejects(
    () => applier.apply(baseCandidate, {
      target: "kn.object_type",
      hypothesis: "x",
      patch: { kn_id: "kn-1", add_object_types: [], add_relation_types: [] },
    }),
    /KnApiClient not provided/,
  );
});

test("PatchApplier: skill.content without SkillApiClient throws", async () => {
  const work = await mkWorkDir();
  const applier = new PatchApplier(work);
  await assert.rejects(
    () => applier.apply(baseCandidate, {
      target: "skill.content",
      hypothesis: "x",
      patch: { skill_id: "skill-a", append_section: "..." },
    }),
    /SkillApiClient not provided/,
  );
});

test("PatchApplier: unknown target rejected by NextChangeSchema", async () => {
  const work = await mkWorkDir();
  const applier = new PatchApplier(work);
  await assert.rejects(
    () => applier.apply(baseCandidate, { target: "bkn.entity", hypothesis: "x", patch: "{}" }),
    /Invalid|discriminator|target/i,
  );
});

test("PatchApplier: does not mutate input candidate", async () => {
  const work = await mkWorkDir();
  const applier = new PatchApplier(work);
  const before = JSON.stringify(baseCandidate);
  await applier.apply(baseCandidate, {
    target: "agent.system_prompt",
    patch: { agent: { system_prompt: "mutated" } },
  });
  assert.equal(JSON.stringify(baseCandidate), before);
});
