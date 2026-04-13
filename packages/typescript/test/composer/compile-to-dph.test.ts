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
    const result = compileToDph(expected_flow);
    assert.equal(result.dph, expected_dph);
    assert.equal(result.answerVar, "reviewer");
  });

  it("fork-join with merge", () => {
    const { expected_flow, expected_dph } = loadGolden("fork-join-research");
    const result = compileToDph(expected_flow);
    assert.equal(result.dph, expected_dph);
    assert.equal(result.answerVar, "synthesizer");
  });

  it("conditional routing (switch → if/elif/else)", () => {
    const { expected_flow, expected_dph } = loadGolden("conditional-routing");
    const result = compileToDph(expected_flow);
    assert.equal(result.dph, expected_dph);
  });

  it("multi-parameter call", () => {
    const flow: FlowDo = {
      do: [{ call: "analyst", input: { query: "$data", context: "$history" } }],
    };
    const result = compileToDph(flow);
    assert.equal(result.dph, "@analyst(query=$data, context=$history) -> analyst");
    assert.equal(result.answerVar, "analyst");
  });

  it("custom output name", () => {
    const flow: FlowDo = {
      do: [{ call: "architect", input: "$query", output: "design" }],
    };
    const result = compileToDph(flow);
    assert.equal(result.dph, "@architect(query=$query) -> design");
    assert.equal(result.answerVar, "design");
  });

  it("merge expression extracted from input", () => {
    const flow: FlowDo = {
      do: [{ call: "synth", input: "$a + $b" }],
    };
    const result = compileToDph(flow);
    assert.equal(result.dph, "$a + $b -> _merged_1\n@synth(query=$_merged_1) -> synth");
    assert.equal(result.answerVar, "synth");
  });
});
