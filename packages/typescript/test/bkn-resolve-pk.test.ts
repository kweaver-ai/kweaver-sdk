import test from "node:test";
import assert from "node:assert/strict";

import { resolvePrimaryKey } from "../src/commands/bkn-utils.js";

// `resolvePrimaryKey` is the bug-fix entry point. Precedence:
//   1. caller-provided override (--pk-map)
//   2. schema-declared PK (per-column isPrimaryKey OR single-element table-level primaryKeys)
//   3. sample-based detection
//   4. fail-fast (null result, caller formats error)
// Composite PKs intentionally fall through to sampling/error: BKN object types
// take a single primary_key, so a 2-column SQL PK can't be auto-resolved without
// an explicit pick.

test("resolvePrimaryKey: --pk-map override wins over schema PK", () => {
  const t = {
    name: "skills",
    primaryKeys: ["skill_id"],
    columns: [
      { name: "skill_id", type: "varchar", isPrimaryKey: true },
      { name: "alt_id", type: "varchar" },
    ],
  };
  const r = resolvePrimaryKey(t, undefined, "alt_id");
  assert.equal(r.pk, "alt_id");
  assert.equal(r.source, "override");
});

test("resolvePrimaryKey: schema per-column flag wins over sample heuristic", () => {
  const t = {
    name: "skills",
    columns: [
      { name: "skill_id", type: "varchar", isPrimaryKey: true },
      { name: "label", type: "varchar" },
    ],
  };
  // Sample shows 'label' is fully unique — heuristic alone would pick it.
  const sample = [
    { skill_id: "SK-A", label: "alpha" },
    { skill_id: "SK-B", label: "bravo" },
  ];
  const r = resolvePrimaryKey(t, sample);
  assert.equal(r.pk, "skill_id");
  assert.equal(r.source, "schema");
});

test("resolvePrimaryKey: schema table-level single PK is used directly", () => {
  const t = {
    name: "skills",
    primaryKeys: ["skill_id"],
    columns: [
      { name: "skill_id", type: "varchar" },
      { name: "label", type: "varchar" },
    ],
  };
  const r = resolvePrimaryKey(t, undefined);
  assert.equal(r.pk, "skill_id");
  assert.equal(r.source, "schema");
});

test("resolvePrimaryKey: empty table with schema PK works (no sample needed)", () => {
  // The original failure mode: empty/sparsely-seeded DB tables couldn't be onboarded
  // because sampling returned no rows. Schema PK eliminates that dependency.
  const t = {
    name: "skills",
    columns: [
      { name: "skill_id", type: "varchar", isPrimaryKey: true },
      { name: "label", type: "varchar" },
    ],
  };
  const r = resolvePrimaryKey(t, undefined);
  assert.equal(r.pk, "skill_id");
  assert.equal(r.source, "schema");
});

test("resolvePrimaryKey: composite schema PK falls through (caller decides via --pk-map)", () => {
  // BKN object types are single-PK; for composite SQL PKs the caller must pick
  // explicitly. We surface this by NOT auto-resolving — sample/fail flow takes over.
  const t = {
    name: "mat_skill",
    primaryKeys: ["sku", "skill_id"],
    columns: [
      { name: "sku", type: "varchar", isPrimaryKey: true },
      { name: "skill_id", type: "varchar", isPrimaryKey: true },
    ],
  };
  const r = resolvePrimaryKey(t, undefined);
  assert.equal(r.pk, null);
  assert.equal(r.source, "ambiguous");
  assert.deepEqual(r.ambiguous, ["sku", "skill_id"]);
});

test("resolvePrimaryKey: falls back to sample-based detection when schema lacks PK", () => {
  const t = {
    name: "csv_table",
    columns: [
      { name: "id", type: "varchar" },
      { name: "label", type: "varchar" },
    ],
  };
  const sample = [
    { id: "1", label: "a" },
    { id: "2", label: "a" },
  ];
  const r = resolvePrimaryKey(t, sample);
  assert.equal(r.pk, "id");
  assert.equal(r.source, "sample");
});

test("resolvePrimaryKey: ignores schema PK that doesn't exist in columns (defensive)", () => {
  // Backend metadata occasionally drifts (stale catalog, cross-table mix-up).
  // A schema-declared PK that isn't in the columns list is unusable — fall through
  // to sample/fail so the user sees a clear error instead of a downstream
  // "column not found" from BKN object-type creation.
  const t = {
    name: "skills",
    primaryKeys: ["ghost_column"],
    columns: [
      { name: "skill_id", type: "varchar" },
      { name: "label", type: "varchar" },
    ],
  };
  const r = resolvePrimaryKey(t, undefined);
  // No usable schema PK, no sample → null with sample source.
  assert.equal(r.pk, null);
  assert.equal(r.source, "sample");
});

test("resolvePrimaryKey: drops schema PK whose column was renamed/removed, keeps the rest", () => {
  // Composite case where one PK column is missing — surviving ones still flow.
  const t = {
    name: "mat_skill",
    primaryKeys: ["sku", "ghost_col", "skill_id"],
    columns: [
      { name: "sku", type: "varchar" },
      { name: "skill_id", type: "varchar" },
    ],
  };
  const r = resolvePrimaryKey(t, undefined);
  assert.equal(r.pk, null);
  assert.equal(r.source, "ambiguous");
  assert.deepEqual(r.ambiguous, ["sku", "skill_id"]);
});

test("resolvePrimaryKey: returns null when neither schema nor sample yields a PK", () => {
  const t = {
    name: "csv_table",
    columns: [
      { name: "a", type: "string" },
      { name: "b", type: "string" },
    ],
  };
  const r = resolvePrimaryKey(t, undefined);
  assert.equal(r.pk, null);
  // Empty table, no schema → sample source so the existing "no sample data"
  // error message still applies (preserves CSV path UX).
  assert.equal(r.source, "sample");
});
