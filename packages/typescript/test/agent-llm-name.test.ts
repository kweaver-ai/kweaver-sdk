import test from "node:test";
import assert from "node:assert/strict";

import { resolveLlmName, buildLlmConfig } from "../src/commands/agent.js";

const BASE = "https://mock.kweaver.test";
const TOKEN = "test-token-abc";

function mockFetch(response: unknown, statusCode = 200) {
  const orig = globalThis.fetch;
  const calls: Array<{ url: string; method: string }> = [];

  globalThis.fetch = async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    const method = init?.method ?? "GET";
    calls.push({ url, method });
    const text = typeof response === "string" ? response : JSON.stringify(response);
    return new Response(text, { status: statusCode });
  };

  return { calls, restore: () => { globalThis.fetch = orig; } };
}

test("resolveLlmName calls mf-model-manager llm/list and matches by model_id", async () => {
  const mock = mockFetch({
    data: [
      { model_id: "111", model_name: "gpt-4o" },
      { model_id: "2044345493059932160", model_name: "deepseek-v3.2" },
      { model_id: "333", model_name: "claude-3" },
    ],
  });
  try {
    const name = await resolveLlmName({ baseUrl: BASE, accessToken: TOKEN, llmId: "2044345493059932160" });
    assert.equal(name, "deepseek-v3.2");
    assert.equal(mock.calls.length, 1);
    const url = new URL(mock.calls[0].url);
    assert.equal(url.pathname, "/api/mf-model-manager/v1/llm/list");
    assert.equal(mock.calls[0].method, "GET");
  } finally {
    mock.restore();
  }
});

test("resolveLlmName falls back to llmId when model not found in list", async () => {
  const mock = mockFetch({ data: [{ model_id: "other", model_name: "some-model" }] });
  try {
    const name = await resolveLlmName({ baseUrl: BASE, accessToken: TOKEN, llmId: "missing-id" });
    assert.equal(name, "missing-id");
  } finally {
    mock.restore();
  }
});

// ── buildLlmConfig: must include valid defaults for top_p, top_k, temperature ─

test("buildLlmConfig includes top_p, top_k, temperature with valid defaults", () => {
  const cfg = buildLlmConfig("model-1", "deepseek-v3.2", 4096);
  assert.equal(cfg.id, "model-1");
  assert.equal(cfg.name, "deepseek-v3.2");
  assert.equal(cfg.max_tokens, 4096);
  // top_p must be > 0 (mf-model-api Pydantic: confloat(gt=0, le=1))
  assert.ok(typeof cfg.top_p === "number" && cfg.top_p > 0 && cfg.top_p <= 1, `top_p must be in (0,1], got ${cfg.top_p}`);
  assert.ok(typeof cfg.top_k === "number" && cfg.top_k >= 1, `top_k must be >= 1, got ${cfg.top_k}`);
  assert.ok(typeof cfg.temperature === "number" && cfg.temperature >= 0 && cfg.temperature <= 2, `temperature must be in [0,2], got ${cfg.temperature}`);
});

test("resolveLlmName falls back to llmId when API fails", async () => {
  const mock = mockFetch("Server Error", 500);
  try {
    const name = await resolveLlmName({ baseUrl: BASE, accessToken: TOKEN, llmId: "bad-id" });
    assert.equal(name, "bad-id");
  } finally {
    mock.restore();
  }
});
