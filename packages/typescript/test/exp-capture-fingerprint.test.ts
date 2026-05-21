// test/exp-capture-fingerprint.test.ts
import test from "node:test";
import assert from "node:assert/strict";
import { captureAgentFingerprint } from "../src/trace-ai/exp/capture-fingerprint.js";

test("captureAgentFingerprint reads config via the injected fetcher and normalizes it", async () => {
  const fakeConfig = {
    id: "agent-1",
    key: "k",
    version: "v7",
    system_prompt: "sp",
    llms: [{ is_default: true, llm_config: { name: "deepseek-chat", temperature: 0.7 } }],
    skills: {
      tools: [
        { tool_id: "t1", tool_box_id: "b1", tool_input: [{ input_name: "kn_id", map_value: "kn-x" }] },
      ],
    },
  };
  const fp = await captureAgentFingerprint(async () => fakeConfig, "agent-1", "latest");
  assert.equal(fp.agent_id, "agent-1");
  assert.equal(fp.version, "v7"); // resolved from the config body, not the "latest" request
  assert.equal(fp.model, "deepseek-chat");
  assert.equal(fp.temperature, 0.7);
  assert.deepEqual(fp.kn_ids, ["kn-x"]);
});

test("captureAgentFingerprint falls back to the requested version when the body omits it", async () => {
  const fp = await captureAgentFingerprint(
    async () => ({
      system_prompt: "sp",
      llms: [{ is_default: true, llm_config: { name: "m", temperature: 0 } }],
      skills: { tools: [] },
    }),
    "agent-1",
    "v3",
  );
  assert.equal(fp.version, "v3");
});
