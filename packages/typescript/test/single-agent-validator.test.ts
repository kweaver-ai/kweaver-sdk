import test from "node:test";
import assert from "node:assert/strict";

import { validateSingleAgent, SingleAgentValidationError } from "../src/trace-ai/scan/single-agent-validator.js";

test("validateSingleAgent: all conv_ids share one agent → returns that agent_id", async () => {
  const fetchSpansById = async (conv: string) => {
    return { spans: [{ attributes: { "gen_ai.agent.id": "agent_A" } }], conversation_id: conv };
  };
  const r = await validateSingleAgent(["conv1", "conv2", "conv3"], fetchSpansById);
  assert.equal(r.agentId, "agent_A");
  assert.equal(r.checkedConvIds, 3);
});

test("validateSingleAgent: mixed agents → throws SingleAgentValidationError with discrepancy map", async () => {
  const fetchSpansById = async (conv: string) => {
    const agentId = conv === "conv1" ? "agent_A" : "agent_B";
    return { spans: [{ attributes: { "gen_ai.agent.id": agentId } }], conversation_id: conv };
  };
  await assert.rejects(
    () => validateSingleAgent(["conv1", "conv2"], fetchSpansById),
    (e: unknown) => {
      assert.ok(e instanceof SingleAgentValidationError);
      const err = e as SingleAgentValidationError;
      assert.deepEqual(err.byConvId.get("conv1"), "agent_A");
      assert.deepEqual(err.byConvId.get("conv2"), "agent_B");
      return true;
    },
  );
});

test("validateSingleAgent: one conv_id returns zero spans → throws SingleAgentValidationError code=no-spans", async () => {
  const fetchSpansById = async (conv: string) => ({ spans: [], conversation_id: conv });
  await assert.rejects(
    () => validateSingleAgent(["conv_x"], fetchSpansById),
    (e: unknown) => e instanceof SingleAgentValidationError && (e as SingleAgentValidationError).code === "no-spans",
  );
});

test("validateSingleAgent: empty input list → throws SingleAgentValidationError code=empty", async () => {
  const fetchSpansById = async () => ({ spans: [], conversation_id: "" });
  await assert.rejects(
    () => validateSingleAgent([], fetchSpansById),
    (e: unknown) => e instanceof SingleAgentValidationError && (e as SingleAgentValidationError).code === "empty",
  );
});

test("validateSingleAgent: span lacks agent.id attribute → falls back to undefined; mismatch detection still works", async () => {
  const fetchSpansById = async (conv: string) => {
    if (conv === "conv1") return { spans: [{ attributes: { "gen_ai.agent.id": "agent_A" } }], conversation_id: conv };
    return { spans: [{ attributes: {} }], conversation_id: conv };
  };
  await assert.rejects(
    () => validateSingleAgent(["conv1", "conv2"], fetchSpansById),
    (e: unknown) => e instanceof SingleAgentValidationError && (e as SingleAgentValidationError).code === "mixed",
  );
});
