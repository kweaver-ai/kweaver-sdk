// test/exp-preflight.test.ts
import test from "node:test";
import assert from "node:assert/strict";
import {
  fingerprintFromAgentConfig,
  preflightCheck,
  PreflightMismatchError,
  type AgentFingerprint,
} from "../src/trace-ai/exp/preflight.js";

// ── fingerprintFromAgentConfig (T1) ───────────────────────────────────────

test("fingerprintFromAgentConfig: extracts system_prompt, model, temperature", () => {
  const raw = {
    system_prompt: "you are a helpful agent",
    llms: [{ is_default: true, llm_config: { name: "deepseek-chat", temperature: 0.7 } }],
    skills: { tools: [] },
  };
  const fp = fingerprintFromAgentConfig("agent-1", "v7", raw);
  assert.equal(fp.agent_id, "agent-1");
  assert.equal(fp.version, "v7");
  assert.equal(fp.system_prompt, "you are a helpful agent");
  assert.equal(fp.model, "deepseek-chat");
  assert.equal(fp.temperature, 0.7);
});

test("fingerprintFromAgentConfig: picks the default llm when multiple are present", () => {
  const raw = {
    system_prompt: "x",
    llms: [
      { is_default: false, llm_config: { name: "small-model", temperature: 1 } },
      { is_default: true, llm_config: { name: "deepseek-chat", temperature: 0.3 } },
    ],
    skills: { tools: [] },
  };
  const fp = fingerprintFromAgentConfig("a", "v1", raw);
  assert.equal(fp.model, "deepseek-chat");
  assert.equal(fp.temperature, 0.3);
});

test("fingerprintFromAgentConfig: extracts tools sorted by tool_id", () => {
  const raw = {
    system_prompt: "x",
    llms: [{ is_default: true, llm_config: { name: "m", temperature: 0 } }],
    skills: {
      tools: [
        { tool_id: "t-b", tool_box_id: "box-2", tool_input: [] },
        { tool_id: "t-a", tool_box_id: "box-1", tool_input: [] },
      ],
    },
  };
  const fp = fingerprintFromAgentConfig("a", "v1", raw);
  assert.deepEqual(fp.tools, [
    { tool_id: "t-a", tool_box_id: "box-1" },
    { tool_id: "t-b", tool_box_id: "box-2" },
  ]);
});

test("fingerprintFromAgentConfig: extracts kn_ids from tool kn_id bindings, deduped and sorted", () => {
  const raw = {
    system_prompt: "x",
    llms: [{ is_default: true, llm_config: { name: "m", temperature: 0 } }],
    skills: {
      tools: [
        { tool_id: "t1", tool_box_id: "b", tool_input: [{ input_name: "kn_id", map_value: "kn-z" }, { input_name: "query", map_value: "" }] },
        { tool_id: "t2", tool_box_id: "b", tool_input: [{ input_name: "kn_id", map_value: "kn-a" }] },
        { tool_id: "t3", tool_box_id: "b", tool_input: [{ input_name: "kn_id", map_value: "kn-a" }] },
      ],
    },
  };
  const fp = fingerprintFromAgentConfig("a", "v1", raw);
  assert.deepEqual(fp.kn_ids, ["kn-a", "kn-z"]);
});

test("fingerprintFromAgentConfig: extracts knId (camelCase) bindings as well as kn_id", () => {
  const raw = {
    system_prompt: "x",
    llms: [{ is_default: true, llm_config: { name: "m", temperature: 0 } }],
    skills: {
      tools: [
        { tool_id: "t1", tool_box_id: "b", tool_input: [{ input_name: "kn_id", map_type: "fixedValue", map_value: "kn-snake" }] },
        { tool_id: "t2", tool_box_id: "b", tool_input: [{ input_name: "knId", map_type: "fixedValue", map_value: "kn-camel" }] },
      ],
    },
  };
  const fp = fingerprintFromAgentConfig("a", "v1", raw);
  assert.deepEqual(fp.kn_ids, ["kn-camel", "kn-snake"]);
  assert.deepEqual(fp.non_fixed_kn_bindings, []);
});

test("fingerprintFromAgentConfig: a kn input with map_type!=fixedValue is recorded as non-fixed, not a kn_id", () => {
  const raw = {
    system_prompt: "x",
    llms: [{ is_default: true, llm_config: { name: "m", temperature: 0 } }],
    skills: {
      tools: [
        { tool_id: "t1", tool_box_id: "b", tool_input: [{ input_name: "kn_id", map_type: "auto", map_value: "kn-ignored" }] },
      ],
    },
  };
  const fp = fingerprintFromAgentConfig("a", "v1", raw);
  // map_type "auto" = model-generated: the runtime ignores map_value, so it is not a real binding
  assert.deepEqual(fp.kn_ids, []);
  assert.deepEqual(fp.non_fixed_kn_bindings, [
    { input_name: "kn_id", map_type: "auto", map_value: "kn-ignored" },
  ]);
});

test("fingerprintFromAgentConfig: a kn input with no map_type is treated as a fixed binding (backward compat)", () => {
  const raw = {
    system_prompt: "x",
    llms: [{ is_default: true, llm_config: { name: "m", temperature: 0 } }],
    skills: {
      tools: [
        { tool_id: "t1", tool_box_id: "b", tool_input: [{ input_name: "kn_id", map_value: "kn-legacy" }] },
      ],
    },
  };
  const fp = fingerprintFromAgentConfig("a", "v1", raw);
  assert.deepEqual(fp.kn_ids, ["kn-legacy"]);
  assert.deepEqual(fp.non_fixed_kn_bindings, []);
});

test("fingerprintFromAgentConfig: dedupes identical non-fixed kn bindings across tools", () => {
  const raw = {
    system_prompt: "x",
    llms: [{ is_default: true, llm_config: { name: "m", temperature: 0 } }],
    skills: {
      tools: [
        { tool_id: "t1", tool_box_id: "b", tool_input: [{ input_name: "knId", map_type: "auto", map_value: "kn-x" }] },
        { tool_id: "t2", tool_box_id: "b", tool_input: [{ input_name: "knId", map_type: "auto", map_value: "kn-x" }] },
      ],
    },
  };
  const fp = fingerprintFromAgentConfig("a", "v1", raw);
  assert.deepEqual(fp.non_fixed_kn_bindings, [{ input_name: "knId", map_type: "auto", map_value: "kn-x" }]);
});

// ── preflightCheck (T4) ───────────────────────────────────────────────────

function fp(overrides: Partial<AgentFingerprint> = {}): AgentFingerprint {
  return {
    agent_id: "agent-1",
    version: "v7",
    system_prompt: "sp",
    model: "deepseek-chat",
    temperature: 0,
    tools: [{ tool_id: "t1", tool_box_id: "b1" }],
    kn_ids: ["kn-correct"],
    non_fixed_kn_bindings: [],
    ...overrides,
  };
}

test("preflightCheck: passes when expected and actual match", () => {
  assert.doesNotThrow(() => preflightCheck(fp(), fp(), "kn-correct"));
});

test("preflightCheck: throws on agent_id mismatch (identity invariant)", () => {
  assert.throws(
    () => preflightCheck(fp(), fp({ agent_id: "other" }), "kn-correct"),
    (err: unknown) => err instanceof PreflightMismatchError && err.mismatches.some(m => m.field === "agent_id"),
  );
});

test("preflightCheck: throws on version mismatch (version invariant)", () => {
  assert.throws(
    () => preflightCheck(fp(), fp({ version: "v8" }), "kn-correct"),
    (err: unknown) => err instanceof PreflightMismatchError && err.mismatches.some(m => m.field === "version"),
  );
});

test("preflightCheck: throws on system_prompt mismatch (config invariant)", () => {
  assert.throws(
    () => preflightCheck(fp(), fp({ system_prompt: "different prompt" }), "kn-correct"),
    (err: unknown) => err instanceof PreflightMismatchError && err.mismatches.some(m => m.field === "system_prompt"),
  );
});

test("preflightCheck: throws on model mismatch (config invariant)", () => {
  assert.throws(
    () => preflightCheck(fp(), fp({ model: "claude-opus-4-7" }), "kn-correct"),
    (err: unknown) => err instanceof PreflightMismatchError && err.mismatches.some(m => m.field === "model"),
  );
});

test("preflightCheck: throws on temperature mismatch (config invariant)", () => {
  assert.throws(
    () => preflightCheck(fp(), fp({ temperature: 0.7 }), "kn-correct"),
    (err: unknown) => err instanceof PreflightMismatchError && err.mismatches.some(m => m.field === "temperature"),
  );
});

test("preflightCheck: treats NaN temperature on both sides as equal (no spurious mismatch)", () => {
  assert.doesNotThrow(() => preflightCheck(fp({ temperature: NaN }), fp({ temperature: NaN }), "kn-correct"));
});

test("preflightCheck: throws on tools mismatch (config invariant)", () => {
  assert.throws(
    () => preflightCheck(fp(), fp({ tools: [{ tool_id: "t9", tool_box_id: "b9" }] }), "kn-correct"),
    (err: unknown) => err instanceof PreflightMismatchError && err.mismatches.some(m => m.field === "tools"),
  );
});

test("preflightCheck: throws when agent KN binding != eval target_kn (question-patient invariant)", () => {
  // expected and actual agree with each other, but the agent is bound to the wrong KN for this eval set
  assert.throws(
    () => preflightCheck(fp({ kn_ids: ["kn-sample"] }), fp({ kn_ids: ["kn-sample"] }), "kn-correct"),
    (err: unknown) => err instanceof PreflightMismatchError && err.mismatches.some(m => m.field === "kn_binding"),
  );
});

test("preflightCheck: skips KN check when evalTargetKn not provided", () => {
  assert.doesNotThrow(() => preflightCheck(fp({ kn_ids: ["kn-anything"] }), fp({ kn_ids: ["kn-anything"] })));
});

test("preflightCheck: throws when the agent's KN binding is model-generated (map_type=auto)", () => {
  // config's map_value says kn-correct, but map_type=auto means the runtime ignores it
  // and the LLM guesses the kn id at runtime — a false-positive trap for a map_value-only check
  const actual = fp({
    kn_ids: [],
    non_fixed_kn_bindings: [{ input_name: "kn_id", map_type: "auto", map_value: "kn-correct" }],
  });
  assert.throws(
    () => preflightCheck(fp(), actual, "kn-correct"),
    (err: unknown) => err instanceof PreflightMismatchError && err.mismatches.some(m => m.field === "kn_binding"),
  );
});

test("preflightCheck: model-generated KN binding error message names the input, map_type and the fix", () => {
  const actual = fp({
    kn_ids: [],
    non_fixed_kn_bindings: [{ input_name: "knId", map_type: "auto", map_value: "kn-correct" }],
  });
  try {
    preflightCheck(fp(), actual, "kn-correct");
    assert.fail("expected PreflightMismatchError");
  } catch (err) {
    assert.ok(err instanceof PreflightMismatchError);
    const m = err.mismatches.find(x => x.field === "kn_binding");
    assert.ok(m, "expected a kn_binding mismatch");
    assert.match(m.actual, /knId/);
    assert.match(m.actual, /auto/);
    assert.match(m.actual, /fixedValue/);
  }
});

test("preflightCheck: non-fixed KN binding is not checked when evalTargetKn is absent", () => {
  const actual = fp({
    kn_ids: [],
    non_fixed_kn_bindings: [{ input_name: "kn_id", map_type: "auto", map_value: "kn-x" }],
  });
  assert.doesNotThrow(() => preflightCheck(fp(), actual));
});

test("preflightCheck: reports all mismatches at once with a readable message", () => {
  try {
    preflightCheck(fp(), fp({ model: "claude-opus-4-7", temperature: 0.7 }), "kn-correct");
    assert.fail("expected PreflightMismatchError");
  } catch (err) {
    assert.ok(err instanceof PreflightMismatchError);
    const fields = err.mismatches.map(m => m.field).sort();
    assert.deepEqual(fields, ["model", "temperature"]);
    assert.match(err.message, /model/);
    assert.match(err.message, /temperature/);
  }
});

test("preflightCheck: truncates long system_prompt in the diff message", () => {
  const longA = "A".repeat(3000);
  const longB = "B".repeat(3000);
  try {
    preflightCheck(fp({ system_prompt: longA }), fp({ system_prompt: longB }), "kn-correct");
    assert.fail("expected PreflightMismatchError");
  } catch (err) {
    assert.ok(err instanceof PreflightMismatchError);
    assert.ok(err.message.length < 2000, `diff message should be readable, got ${err.message.length} chars`);
    assert.match(err.message, /system_prompt/);
  }
});
