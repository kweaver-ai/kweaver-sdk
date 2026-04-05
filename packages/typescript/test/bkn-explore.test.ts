import test from "node:test";
import assert from "node:assert/strict";
import { parseKnExploreArgs, buildMeta } from "../src/commands/bkn-explore.js";

test("parseKnExploreArgs: kn-id only", () => {
  const opts = parseKnExploreArgs(["kn-abc123"]);
  assert.equal(opts.knId, "kn-abc123");
  assert.equal(opts.port, 3721);
  assert.equal(opts.open, true);
});

test("parseKnExploreArgs: --port and --no-open", () => {
  const opts = parseKnExploreArgs(["kn-abc123", "--port", "8080", "--no-open"]);
  assert.equal(opts.knId, "kn-abc123");
  assert.equal(opts.port, 8080);
  assert.equal(opts.open, false);
});

test("parseKnExploreArgs: no args returns empty knId", () => {
  const opts = parseKnExploreArgs([]);
  assert.equal(opts.knId, "");
  assert.equal(opts.port, 3721);
});

test("parseKnExploreArgs: --help throws", () => {
  assert.throws(() => parseKnExploreArgs(["--help"]), { message: "help" });
});

test("parseKnExploreArgs: -bd flag", () => {
  const opts = parseKnExploreArgs(["kn-abc123", "-bd", "my_domain"]);
  assert.equal(opts.businessDomain, "my_domain");
});

test("buildMeta: assembles schema from raw API responses", () => {
  const knRaw = JSON.stringify({
    id: "kn-1", name: "Test KN",
    statistics: { object_count: 10, relation_count: 5 },
  });
  const otRaw = JSON.stringify({
    object_types: [
      { id: "ot-1", name: "Person", display_key: "name", properties: [{ name: "a" }, { name: "b" }] },
    ],
  });
  const rtRaw = JSON.stringify({
    relation_types: [
      { id: "rt-1", name: "knows", source_object_type_id: "ot-1", target_object_type_id: "ot-1",
        source_object_type: { name: "Person" }, target_object_type: { name: "Person" } },
    ],
  });
  const atRaw = JSON.stringify({
    action_types: [{ id: "at-1", name: "Analyze" }],
  });

  const meta = buildMeta(knRaw, otRaw, rtRaw, atRaw);
  assert.equal(meta.bkn.id, "kn-1");
  assert.equal(meta.bkn.name, "Test KN");
  assert.equal(meta.objectTypes.length, 1);
  assert.equal(meta.objectTypes[0].name, "Person");
  assert.equal(meta.objectTypes[0].propertyCount, 2);
  assert.equal(meta.relationTypes.length, 1);
  assert.equal(meta.relationTypes[0].sourceOtName, "Person");
  assert.equal(meta.actionTypes.length, 1);
});
