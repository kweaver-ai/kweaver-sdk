import test, { describe, it } from "node:test";
import assert from "node:assert/strict";
import { parseExploreArgs } from "../src/commands/explore.js";
import { buildMeta, isRetryableExploreBootstrapError } from "../src/commands/explore-bkn.js";
import { HttpError } from "../src/utils/http.js";

describe("parseExploreArgs", () => {
  it("defaults: no args", () => {
    const opts = parseExploreArgs([]);
    assert.equal(opts.port, 3721);
    assert.equal(opts.open, true);
    assert.equal(opts.knId, "");
    assert.equal(opts.agentId, "");
  });

  it("--kn flag", () => {
    const opts = parseExploreArgs(["--kn", "kn-123"]);
    assert.equal(opts.knId, "kn-123");
  });

  it("--agent flag", () => {
    const opts = parseExploreArgs(["--agent", "agent-456"]);
    assert.equal(opts.agentId, "agent-456");
  });

  it("--port and --no-open", () => {
    const opts = parseExploreArgs(["--port", "4000", "--no-open"]);
    assert.equal(opts.port, 4000);
    assert.equal(opts.open, false);
  });

  it("-bd flag", () => {
    const opts = parseExploreArgs(["-bd", "my-domain"]);
    assert.equal(opts.businessDomain, "my-domain");
  });

  it("--help throws", () => {
    assert.throws(() => parseExploreArgs(["--help"]), { message: "help" });
  });
});

describe("buildMeta", () => {
  it("assembles schema from raw API responses (legacy keys)", () => {
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

  it("handles entries-wrapped API responses", () => {
    const knRaw = JSON.stringify({
      id: "kn-2", name: "Entries KN",
      statistics: { object_count: 3, relation_count: 1 },
    });
    const otRaw = JSON.stringify({
      entries: [
        { id: "ot-1", name: "Player", display_key: "name", data_properties: [{ name: "name" }, { name: "age", type: "integer" }] },
      ],
    });
    const rtRaw = JSON.stringify({
      entries: [
        { id: "rt-1", name: "plays_for", source_object_type_id: "ot-1", target_object_type_id: "ot-2",
          source_object_type: { name: "Player" }, target_object_type: { name: "Team" } },
      ],
    });
    const atRaw = JSON.stringify({ entries: [] });

    const meta = buildMeta(knRaw, otRaw, rtRaw, atRaw);
    assert.equal(meta.objectTypes.length, 1);
    assert.equal(meta.objectTypes[0].name, "Player");
    assert.equal(meta.objectTypes[0].propertyCount, 2);
    assert.equal(meta.objectTypes[0].properties[1].type, "integer");
    assert.equal(meta.relationTypes.length, 1);
    assert.equal(meta.relationTypes[0].name, "plays_for");
    assert.equal(meta.actionTypes.length, 0);
  });
});

describe("isRetryableExploreBootstrapError", () => {
  it("retries transient fetch failures", () => {
    const error = new Error("fetch failed", {
      cause: new Error("Client network socket disconnected before secure TLS connection was established"),
    });
    assert.equal(isRetryableExploreBootstrapError(error), true);
  });

  it("does not retry http errors", () => {
    const error = new HttpError(404, "Not Found", "{\"message\":\"missing\"}");
    assert.equal(isRetryableExploreBootstrapError(error), false);
  });
});

describe("parseExploreArgs edge cases", () => {
  it("--kn and --agent together", () => {
    const opts = parseExploreArgs(["--kn", "kn-1", "--agent", "ag-2"]);
    assert.equal(opts.knId, "kn-1");
    assert.equal(opts.agentId, "ag-2");
  });

  it("all flags combined", () => {
    const opts = parseExploreArgs(["--kn", "kn-1", "--agent", "ag-2", "--port", "5000", "--no-open", "-bd", "test"]);
    assert.equal(opts.knId, "kn-1");
    assert.equal(opts.agentId, "ag-2");
    assert.equal(opts.port, 5000);
    assert.equal(opts.open, false);
    assert.equal(opts.businessDomain, "test");
  });

  it("-h shorthand throws", () => {
    assert.throws(() => parseExploreArgs(["-h"]), { message: "help" });
  });

  it("--biz-domain longform", () => {
    const opts = parseExploreArgs(["--biz-domain", "prod"]);
    assert.equal(opts.businessDomain, "prod");
  });
});
