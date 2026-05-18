import test from "node:test";
import assert from "node:assert/strict";
import { MissionSchema, BundleSchema, ManifestSchema } from "../src/trace-ai/exp/schemas.js";

test("MissionSchema: accepts valid mission", () => {
  const result = MissionSchema.safeParse({
    schema_version: "trace-mission/v1",
    goal: "reduce retry rate",
    eval_sets: [{ path: "eval-sets/v1", role: "seed" }],
    current_candidate: { path: "candidates/baseline.yaml" },
  });
  assert.equal(result.success, true);
});

test("MissionSchema: rejects missing goal", () => {
  const result = MissionSchema.safeParse({
    schema_version: "trace-mission/v1",
    eval_sets: [],
    current_candidate: { path: "candidates/baseline.yaml" },
  });
  assert.equal(result.success, false);
});

test("BundleSchema: accepts valid bundle", () => {
  const result = BundleSchema.safeParse({
    schema_version: "trace-bundle/v1",
    experiment_id: "exp_abc",
    bundle_id: "bundle_xyz",
    best_trial_version: 2,
    resources: { agent_config: {}, skills: [] },
    provenance: { created_by: "user", created_at: "2026-05-14T00:00:00Z", evidence_traces: [], round_refs: [] },
  });
  assert.equal(result.success, true);
});

test("ManifestSchema: accepts valid manifest", () => {
  const result = ManifestSchema.safeParse({
    schema_version: "trace-manifest/v1",
    experiment_id: "exp_abc",
    trial_version: 2,
    predictions: { fixes: [], risks: [] },
  });
  assert.equal(result.success, true);
});

test("MissionSchema: rejects empty eval_sets array", () => {
  const result = MissionSchema.safeParse({
    schema_version: "trace-mission/v1",
    goal: "test",
    eval_sets: [],
    current_candidate: { path: "candidates/baseline.yaml" },
  });
  assert.equal(result.success, false);
});

test("MissionSchema: rejects invalid schema_version", () => {
  const result = MissionSchema.safeParse({
    schema_version: "wrong-version",
    goal: "test",
    eval_sets: [{ path: "eval-sets/v1", role: "seed" }],
    current_candidate: { path: "candidates/baseline.yaml" },
  });
  assert.equal(result.success, false);
});
