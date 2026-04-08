import { describe, it, expect } from "vitest";
import { parseExploreArgs } from "../src/commands/explore.js";
import { buildMeta, isRetryableExploreBootstrapError } from "../src/commands/explore-bkn.js";
import { HttpError } from "../src/utils/http.js";

describe("parseExploreArgs", () => {
  it("defaults: no args", () => {
    const opts = parseExploreArgs([]);
    expect(opts.port).toBe(3721);
    expect(opts.open).toBe(true);
    expect(opts.knId).toBe("");
    expect(opts.agentId).toBe("");
  });

  it("--kn flag", () => {
    const opts = parseExploreArgs(["--kn", "kn-123"]);
    expect(opts.knId).toBe("kn-123");
  });

  it("--agent flag", () => {
    const opts = parseExploreArgs(["--agent", "agent-456"]);
    expect(opts.agentId).toBe("agent-456");
  });

  it("--port and --no-open", () => {
    const opts = parseExploreArgs(["--port", "4000", "--no-open"]);
    expect(opts.port).toBe(4000);
    expect(opts.open).toBe(false);
  });

  it("-bd flag", () => {
    const opts = parseExploreArgs(["-bd", "my-domain"]);
    expect(opts.businessDomain).toBe("my-domain");
  });

  it("--help throws", () => {
    expect(() => parseExploreArgs(["--help"])).toThrow("help");
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
    expect(meta.bkn.id).toBe("kn-1");
    expect(meta.bkn.name).toBe("Test KN");
    expect(meta.objectTypes.length).toBe(1);
    expect(meta.objectTypes[0].name).toBe("Person");
    expect(meta.objectTypes[0].propertyCount).toBe(2);
    expect(meta.relationTypes.length).toBe(1);
    expect(meta.relationTypes[0].sourceOtName).toBe("Person");
    expect(meta.actionTypes.length).toBe(1);
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
    expect(meta.objectTypes.length).toBe(1);
    expect(meta.objectTypes[0].name).toBe("Player");
    expect(meta.objectTypes[0].propertyCount).toBe(2);
    expect(meta.objectTypes[0].properties[1].type).toBe("integer");
    expect(meta.relationTypes.length).toBe(1);
    expect(meta.relationTypes[0].name).toBe("plays_for");
    expect(meta.actionTypes.length).toBe(0);
  });
});

describe("isRetryableExploreBootstrapError", () => {
  it("retries transient fetch failures", () => {
    const error = new Error("fetch failed", {
      cause: new Error("Client network socket disconnected before secure TLS connection was established"),
    });
    expect(isRetryableExploreBootstrapError(error)).toBe(true);
  });

  it("does not retry http errors", () => {
    const error = new HttpError(404, "Not Found", "{\"message\":\"missing\"}");
    expect(isRetryableExploreBootstrapError(error)).toBe(false);
  });
});

describe("parseExploreArgs edge cases", () => {
  it("--kn and --agent together", () => {
    const opts = parseExploreArgs(["--kn", "kn-1", "--agent", "ag-2"]);
    expect(opts.knId).toBe("kn-1");
    expect(opts.agentId).toBe("ag-2");
  });

  it("all flags combined", () => {
    const opts = parseExploreArgs(["--kn", "kn-1", "--agent", "ag-2", "--port", "5000", "--no-open", "-bd", "test"]);
    expect(opts.knId).toBe("kn-1");
    expect(opts.agentId).toBe("ag-2");
    expect(opts.port).toBe(5000);
    expect(opts.open).toBe(false);
    expect(opts.businessDomain).toBe("test");
  });

  it("-h shorthand throws", () => {
    expect(() => parseExploreArgs(["-h"])).toThrow("help");
  });

  it("--biz-domain longform", () => {
    const opts = parseExploreArgs(["--biz-domain", "prod"]);
    expect(opts.businessDomain).toBe("prod");
  });
});
