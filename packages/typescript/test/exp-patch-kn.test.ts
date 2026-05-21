import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { KnPatcher } from "../src/trace-ai/exp/patch/kn.js";
import type { KnApiClient } from "../src/trace-ai/exp/patch/kn-api-client.js";

function mockClient(overrides: Partial<KnApiClient> = {}): KnApiClient {
  return {
    validateObjectType: async () => ({ valid: true }),
    addObjectType: async () => ({ concept_id: "c01" }),
    validateRelationType: async () => ({ valid: true }),
    addRelationType: async () => ({ relation_id: "r01" }),
    objectTypeExists: async () => false,
    relationTypeExists: async () => false,
    ...overrides,
  };
}

async function tmpDir() { return fs.mkdtemp(path.join(os.tmpdir(), "kn-test-")); }

test("KnPatcher: dry-run failure throws before any KN write", async () => {
  const dir = await tmpDir();
  const addCalls: string[] = [];
  const client = mockClient({
    validateObjectType: async () => ({ valid: false, error: "concept conflict" }),
    addObjectType: async (_, s) => { addCalls.push(s.concept_name); return { concept_id: "c01" }; },
  });
  const patcher = new KnPatcher(client, dir);
  await assert.rejects(
    () => patcher.apply({ kn_id: "kn01", add_object_types: [{ concept_name: "bad", dataview_id: "dv01", primary_keys: ["id"], data_properties: [] }], add_relation_types: [] }),
    /concept conflict/,
  );
  assert.deepEqual(addCalls, []);
  await assert.rejects(() => fs.access(path.join(dir, "rollback.yaml")), /ENOENT/);
});

test("KnPatcher: writes rollback step BEFORE calling addObjectType", async () => {
  const dir = await tmpDir();
  let rollbackExistedAtWrite = false;
  const client = mockClient({
    addObjectType: async () => {
      try { await fs.access(path.join(dir, "rollback.yaml")); rollbackExistedAtWrite = true; } catch {}
      return { concept_id: "c01" };
    },
  });
  await new KnPatcher(client, dir).apply({
    kn_id: "kn01",
    add_object_types: [{ concept_name: "vehicle_sales", dataview_id: "dv01", primary_keys: ["id"], data_properties: [] }],
    add_relation_types: [],
  });
  assert.equal(rollbackExistedAtWrite, true);
  const content = await fs.readFile(path.join(dir, "rollback.yaml"), "utf-8");
  assert.match(content, /vehicle_sales/);
  assert.match(content, /remove_object_type/);
});

test("KnPatcher: skips objectType that already exists (idempotent)", async () => {
  const dir = await tmpDir();
  const addCalls: string[] = [];
  const client = mockClient({
    objectTypeExists: async (_, name) => name === "existing",
    addObjectType: async (_, s) => { addCalls.push(s.concept_name); return { concept_id: "c01" }; },
  });
  await new KnPatcher(client, dir).apply({
    kn_id: "kn01",
    add_object_types: [
      { concept_name: "existing", dataview_id: "dv01", primary_keys: ["id"], data_properties: [] },
      { concept_name: "new_type", dataview_id: "dv02", primary_keys: ["id"], data_properties: [] },
    ],
    add_relation_types: [],
  });
  assert.deepEqual(addCalls, ["new_type"]);
});

test("KnPatcher: applies object types then relation types in order", async () => {
  const dir = await tmpDir();
  const calls: string[] = [];
  const client = mockClient({
    addObjectType: async (_, s) => { calls.push(`obj:${s.concept_name}`); return { concept_id: "c01" }; },
    addRelationType: async (_, s) => { calls.push(`rel:${s.concept_name}`); return { relation_id: "r01" }; },
  });
  await new KnPatcher(client, dir).apply({
    kn_id: "kn01",
    add_object_types: [{ concept_name: "vehicle_sales", dataview_id: "dv01", primary_keys: ["id"], data_properties: [] }],
    add_relation_types: [{ concept_name: "vehicle_has_sales", source_object_type: "vehicle", target_object_type: "vehicle_sales", join_key: "VEHICLEID → vehicle_id" }],
  });
  assert.equal(calls[0], "obj:vehicle_sales");
  assert.equal(calls[1], "rel:vehicle_has_sales");
});
