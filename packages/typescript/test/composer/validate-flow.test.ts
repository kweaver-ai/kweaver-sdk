import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { validateFlow } from "../../src/commands/composer-flow.js";
import type { FlowDo, FlowStep } from "../../src/commands/composer-flow.js";

describe("validateFlow", () => {
  const refs = ["architect", "developer", "reviewer"];

  it("valid sequential pipeline → no errors", () => {
    const flow: FlowDo = {
      do: [
        { call: "architect", input: "$query" },
        { call: "developer", input: "$architect" },
        { call: "reviewer", input: "$developer" },
      ],
    };
    assert.deepEqual(validateFlow(flow, refs), []);
  });

  it("empty do array → error", () => {
    const flow: FlowDo = { do: [] };
    const errors = validateFlow(flow, refs);
    assert.ok(errors.length > 0);
    assert.ok(errors[0].includes("empty"));
  });

  it("unknown agent ref → error", () => {
    const flow: FlowDo = {
      do: [{ call: "unknown_agent", input: "$query" }],
    };
    const errors = validateFlow(flow, refs);
    assert.ok(errors.some((e) => e.includes("unknown_agent")));
  });

  it("input references undefined variable → error", () => {
    const flow: FlowDo = {
      do: [{ call: "architect", input: "$nonexistent" }],
    };
    const errors = validateFlow(flow, refs);
    assert.ok(errors.some((e) => e.includes("nonexistent")));
  });

  it("input without $ prefix → error", () => {
    const flow: FlowDo = {
      do: [{ call: "architect", input: "raw_string" }],
    };
    const errors = validateFlow(flow, refs);
    assert.ok(errors.some((e) => e.includes("$")));
  });

  it("switch with no if cases → error", () => {
    const flow: FlowDo = {
      do: [{ switch: [{ default: true as const, do: [{ call: "architect", input: "$query" }] }] }],
    };
    const errors = validateFlow(flow, refs);
    assert.ok(errors.some((e) => e.includes("at least one")));
  });

  it("switch default not last → error", () => {
    const flow: FlowDo = {
      do: [{
        switch: [
          { default: true as const, do: [{ call: "architect", input: "$query" }] },
          { if: "$x > 0", do: [{ call: "developer", input: "$query" }] },
        ],
      }],
    };
    const errors = validateFlow(flow, refs);
    assert.ok(errors.some((e) => e.includes("last")));
  });

  it("parallel with < 2 steps → error", () => {
    const flow: FlowDo = {
      do: [{ parallel: [{ call: "architect", input: "$query" }] }],
    };
    const errors = validateFlow(flow, refs);
    assert.ok(errors.some((e) => e.includes("at least 2")));
  });

  it("step with no recognized key → error", () => {
    const flow: FlowDo = {
      do: [{ unknown: true } as unknown as FlowStep],
    };
    const errors = validateFlow(flow, refs);
    assert.ok(errors.some((e) => e.includes("call") || e.includes("switch") || e.includes("parallel")));
  });

  it("merge expression ($a + $b) in input is valid", () => {
    const flow: FlowDo = {
      do: [
        { parallel: [
            { call: "architect", input: "$query" },
            { call: "developer", input: "$query" },
        ]},
        { call: "reviewer", input: "$architect + $developer" },
      ],
    };
    assert.deepEqual(validateFlow(flow, ["architect", "developer", "reviewer"]), []);
  });
});
