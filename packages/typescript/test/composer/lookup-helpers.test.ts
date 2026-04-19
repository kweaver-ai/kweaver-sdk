/**
 * Unit tests for the CLI-support helpers added to composer-engine:
 *   - fetchOrchestratorConfig: GET /agent-market/agent/{id}/version/v0
 *   - listSubAgentIds: reads skills.agents[].agent_key → resolves each via /agent/by-key
 *
 * Both are pure HTTP wrappers — mock `fetch` to assert URLs/methods and the
 * parsing of the response body into ids.
 */
import test from "node:test";
import assert from "node:assert/strict";

import {
  fetchOrchestratorConfig,
  listSubAgentIds,
  type TokenProvider,
} from "../../src/commands/composer-engine.js";

const BASE = "https://platform.example";
const TOKEN = "tok-1";

function mockFetch(handler: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>) {
  const original = globalThis.fetch;
  globalThis.fetch = handler as typeof fetch;
  return () => { globalThis.fetch = original; };
}

const getToken: TokenProvider = async () => ({ baseUrl: BASE, accessToken: TOKEN });

test("fetchOrchestratorConfig GETs /agent-market/agent/{id}/version/v0 and returns config", async () => {
  let capturedUrl = "";
  let capturedMethod = "";
  const restore = mockFetch(async (url, init) => {
    capturedUrl = String(url);
    capturedMethod = init?.method ?? "";
    return new Response(
      JSON.stringify({ id: "orch-1", config: { is_dolphin_mode: 1, dolphin: "foo", skills: {} } }),
      { status: 200 },
    );
  });
  try {
    const config = await fetchOrchestratorConfig("orch-1", getToken, "bd_x");
    assert.match(capturedUrl, /\/agent-market\/agent\/orch-1\/version\/v0\?is_visit=true$/);
    assert.equal(capturedMethod, "GET");
    assert.equal(config.is_dolphin_mode, 1);
    assert.equal(config.dolphin, "foo");
  } finally { restore(); }
});

test("fetchOrchestratorConfig returns empty object when response has no config field", async () => {
  const restore = mockFetch(async () =>
    new Response(JSON.stringify({ id: "x" }), { status: 200 }),
  );
  try {
    const config = await fetchOrchestratorConfig("x", getToken, "bd_public");
    assert.deepEqual(config, {});
  } finally { restore(); }
});

test("listSubAgentIds resolves each agent_key in skills.agents to an agent id", async () => {
  const calls: string[] = [];
  const restore = mockFetch(async (url) => {
    const u = String(url);
    calls.push(u);
    if (u.includes("/agent-market/agent/orch-1/version/v0")) {
      return new Response(JSON.stringify({
        config: {
          skills: {
            agents: [
              { agent_key: "key-A" },
              { agent_key: "key-B" },
            ],
          },
        },
      }), { status: 200 });
    }
    if (u.includes("/agent/by-key/key-A")) {
      return new Response(JSON.stringify({ id: "id-A", key: "key-A" }), { status: 200 });
    }
    if (u.includes("/agent/by-key/key-B")) {
      return new Response(JSON.stringify({ id: "id-B", key: "key-B" }), { status: 200 });
    }
    return new Response("not found", { status: 404 });
  });
  try {
    const ids = await listSubAgentIds("orch-1", getToken, "bd_public");
    assert.deepEqual(ids, ["id-A", "id-B"]);
    assert.ok(calls.some((u) => u.includes("/agent-market/agent/orch-1/version/v0")));
    assert.ok(calls.some((u) => u.includes("/agent/by-key/key-A")));
    assert.ok(calls.some((u) => u.includes("/agent/by-key/key-B")));
  } finally { restore(); }
});

test("listSubAgentIds returns [] when skills.agents is missing", async () => {
  const restore = mockFetch(async () =>
    new Response(JSON.stringify({ config: {} }), { status: 200 }),
  );
  try {
    const ids = await listSubAgentIds("orch-1", getToken, "bd_public");
    assert.deepEqual(ids, []);
  } finally { restore(); }
});

test("listSubAgentIds silently skips keys that fail to resolve", async () => {
  const restore = mockFetch(async (url) => {
    const u = String(url);
    if (u.includes("/agent-market/agent/orch-1/version/v0")) {
      return new Response(JSON.stringify({
        config: { skills: { agents: [{ agent_key: "good" }, { agent_key: "bad" }] } },
      }), { status: 200 });
    }
    if (u.includes("/by-key/good")) {
      return new Response(JSON.stringify({ id: "id-good" }), { status: 200 });
    }
    // bad key returns error
    return new Response("not found", { status: 404 });
  });
  try {
    const ids = await listSubAgentIds("orch-1", getToken, "bd_public");
    assert.deepEqual(ids, ["id-good"]);
  } finally { restore(); }
});
