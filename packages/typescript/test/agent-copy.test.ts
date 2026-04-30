import test from "node:test";
import assert from "node:assert/strict";
import {
  copyAgent,
  copyAgentToTemplate,
  copyAgentToTemplateAndPublish,
} from "../src/api/agents-inout.js";
import { EndpointUnavailableError } from "../src/utils/http.js";

const BASE = "https://platform.example";
const TOKEN = "tok-test";
const FACTORY = "/api/agent-factory/v3";

function mockFetch(handler: (url: RequestInfo | URL, init?: RequestInit) => Promise<Response>) {
  const original = globalThis.fetch;
  globalThis.fetch = handler as typeof fetch;
  return () => {
    globalThis.fetch = original;
  };
}

test("copyAgent POSTs /agent/{id}/copy", async () => {
  let captured: { url: string; init?: RequestInit } | null = null;
  const restore = mockFetch(async (url, init) => {
    captured = { url: String(url), init };
    return new Response('{"id":"new"}', { status: 200 });
  });
  try {
    const body = await copyAgent({ baseUrl: BASE, accessToken: TOKEN, agentId: "a1" });
    assert.equal(body, '{"id":"new"}');
    assert.ok(captured);
    assert.equal(captured!.url, `${BASE}${FACTORY}/agent/a1/copy`);
    assert.equal(captured!.init?.method, "POST");
  } finally {
    restore();
  }
});

test("copyAgentToTemplate POSTs /agent/{id}/copy2tpl", async () => {
  let url = "";
  const restore = mockFetch(async (u) => {
    url = String(u);
    return new Response("{}", { status: 200 });
  });
  try {
    await copyAgentToTemplate({ baseUrl: BASE, accessToken: TOKEN, agentId: "x/y" });
    assert.equal(url, `${BASE}${FACTORY}/agent/x%2Fy/copy2tpl`);
  } finally {
    restore();
  }
});

test("copyAgentToTemplateAndPublish POSTs copy2tpl-and-publish", async () => {
  let url = "";
  const restore = mockFetch(async (u) => {
    url = String(u);
    return new Response("{}", { status: 200 });
  });
  try {
    await copyAgentToTemplateAndPublish({ baseUrl: BASE, accessToken: TOKEN, agentId: "b2" });
    assert.equal(url, `${BASE}${FACTORY}/agent/b2/copy2tpl-and-publish`);
  } finally {
    restore();
  }
});

test("copyAgent maps 404 to EndpointUnavailableError", async () => {
  const restore = mockFetch(async () => new Response("not found", { status: 404, statusText: "Not Found" }));
  try {
    await assert.rejects(
      () => copyAgent({ baseUrl: BASE, accessToken: TOKEN, agentId: "nope" }),
      (err: unknown) => {
        assert.ok(err instanceof EndpointUnavailableError);
        const e = err as EndpointUnavailableError;
        assert.equal(e.endpointPath, `${FACTORY}/agent/nope/copy`);
        assert.equal(e.endpoint, e.endpointPath);
        assert.ok(e.hint.includes("not available"));
        return true;
      },
    );
  } finally {
    restore();
  }
});
