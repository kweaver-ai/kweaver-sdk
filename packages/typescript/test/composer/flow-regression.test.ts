import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { compileToDph, validateFlow, validateDphSyntax } from "../../src/commands/composer-flow.js";
import type { FlowDo, FlowStep } from "../../src/commands/composer-flow.js";

const goldenDir = path.join(import.meta.dirname, "fixtures/golden");
const badcaseDir = path.join(import.meta.dirname, "fixtures/badcases");

interface GoldenCase {
  id: string;
  agents: string[];
  expected_flow: FlowDo;
  expected_dph: string;
}

interface BadCase {
  id: string;
  error_gate: string;
  llm_output: { flow?: FlowDo };
}

function loadAllJson<T>(dir: string): T[] {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .map((f) => JSON.parse(fs.readFileSync(path.join(dir, f), "utf-8")) as T);
}

describe("Golden case regression", () => {
  const cases = loadAllJson<GoldenCase>(goldenDir);

  for (const c of cases) {
    it(`${c.id}: flow validates`, () => {
      const errors = validateFlow(c.expected_flow, c.agents);
      assert.deepEqual(errors, [], `Validation errors: ${errors.join(", ")}`);
    });

    it(`${c.id}: compiles to expected DPH`, () => {
      const dph = compileToDph(c.expected_flow);
      assert.equal(dph, c.expected_dph);
    });

    it(`${c.id}: compiled DPH passes Dolphin syntax check`, async () => {
      const dph = compileToDph(c.expected_flow);
      const result = await validateDphSyntax(dph);
      if (result.skipped) return; // Dolphin not installed
      assert.ok(result.is_valid, `DPH syntax error: ${result.error_message} at line ${result.line_number}`);
    });
  }
});

describe("Bad case regression", () => {
  const cases = loadAllJson<BadCase>(badcaseDir);

  for (const c of cases) {
    if (c.error_gate !== "gate1" || !c.llm_output?.flow) continue;

    it(`${c.id}: validateFlow catches error`, () => {
      const errors = validateFlow(c.llm_output.flow!, []);
      assert.ok(errors.length > 0, "Expected validation errors but got none");
    });
  }
});
