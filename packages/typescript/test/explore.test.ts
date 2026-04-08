import { describe, it, expect } from "vitest";
import { parseExploreArgs } from "../src/commands/explore.js";

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
