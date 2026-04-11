import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { compileToDph } from "../../src/commands/composer-flow.js";
import type { FlowDo } from "../../src/commands/composer-flow.js";

const fixturesDir = path.join(import.meta.dirname, "fixtures/golden");

function loadGolden(name: string): { expected_flow: FlowDo; expected_dph: string } {
  const raw = fs.readFileSync(path.join(fixturesDir, `${name}.json`), "utf-8");
  return JSON.parse(raw);
}

describe("compileToDph", () => {
  it("sequential pipeline", () => {
    const { expected_flow, expected_dph } = loadGolden("sequential-pipeline");
    assert.equal(compileToDph(expected_flow), expected_dph);
  });

  it("fork-join with merge", () => {
    const { expected_flow, expected_dph } = loadGolden("fork-join-research");
    assert.equal(compileToDph(expected_flow), expected_dph);
  });

  it("conditional routing (switch → if/elif/else)", () => {
    const { expected_flow, expected_dph } = loadGolden("conditional-routing");
    assert.equal(compileToDph(expected_flow), expected_dph);
  });

  it("multi-parameter call", () => {
    const flow: FlowDo = {
      do: [{ call: "analyst", input: { query: "$data", context: "$history" } }],
    };
    assert.equal(compileToDph(flow), "@analyst(query=$data, context=$history) -> analyst");
  });

  it("custom output name", () => {
    const flow: FlowDo = {
      do: [{ call: "architect", input: "$query", output: "design" }],
    };
    assert.equal(compileToDph(flow), "@architect(query=$query) -> design");
  });

  it("merge expression extracted from input", () => {
    const flow: FlowDo = {
      do: [{ call: "synth", input: "$a + $b" }],
    };
    assert.equal(compileToDph(flow), "$a + $b -> _merged_1\n@synth(query=$_merged_1) -> synth");
  });
});
