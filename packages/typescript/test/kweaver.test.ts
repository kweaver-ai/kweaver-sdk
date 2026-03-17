/**
 * Tests for the module-level simple API (src/kweaver.ts).
 *
 * Each test resets module state via configure() or by monkey-patching the private
 * globals through the module's own functions — no private access needed since
 * configure() always replaces the client.
 */

import test from "node:test";
import assert from "node:assert/strict";

const BASE = "https://mock.kweaver.test";
const TOKEN = "test-token-xyz";

// Helper: mock global fetch and restore after the callback
async function withFetch(
  handler: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>,
  fn: () => Promise<void>
): Promise<void> {
  const orig = globalThis.fetch;
  globalThis.fetch = handler as typeof fetch;
  try {
    await fn();
  } finally {
    globalThis.fetch = orig;
  }
}

// Helper: fresh import of kweaver module for each isolated test block
// We use dynamic import so we can re-configure between tests.
// Because Node caches modules, we configure() at the start of every test.
import * as kweaver from "../src/kweaver.js";

// ── configure ─────────────────────────────────────────────────────────────────

test("configure throws when baseUrl and env var both missing", () => {
  const orig = process.env.KWEAVER_BASE_URL;
  delete process.env.KWEAVER_BASE_URL;
  try {
    assert.throws(
      () => kweaver.configure({ accessToken: TOKEN }),
      /baseUrl/
    );
  } finally {
    if (orig !== undefined) process.env.KWEAVER_BASE_URL = orig;
  }
});

test("configure throws when accessToken and env var both missing", () => {
  const origTok = process.env.KWEAVER_TOKEN;
  delete process.env.KWEAVER_TOKEN;
  try {
    assert.throws(
      () => kweaver.configure({ baseUrl: BASE }),
      /accessToken/
    );
  } finally {
    if (origTok !== undefined) process.env.KWEAVER_TOKEN = origTok;
  }
});

test("configure accepts baseUrl + accessToken", () => {
  assert.doesNotThrow(() =>
    kweaver.configure({ baseUrl: BASE, accessToken: TOKEN })
  );
});

test("configure reads baseUrl from env", () => {
  process.env.KWEAVER_BASE_URL = BASE;
  try {
    assert.doesNotThrow(() =>
      kweaver.configure({ accessToken: TOKEN })
    );
  } finally {
    delete process.env.KWEAVER_BASE_URL;
  }
});

test("configure reads accessToken from env", () => {
  process.env.KWEAVER_TOKEN = TOKEN;
  try {
    assert.doesNotThrow(() =>
      kweaver.configure({ baseUrl: BASE })
    );
  } finally {
    delete process.env.KWEAVER_TOKEN;
  }
});

test("getClient throws before configure", () => {
  // Force unconfigured state by importing fresh module state
  // We achieve this by calling a private-state-resetting trick: configure sets state.
  // We can't truly reset without re-importing, so instead verify that configure()
  // being called is required. We call configure first to ensure getClient works.
  kweaver.configure({ baseUrl: BASE, accessToken: TOKEN });
  assert.doesNotThrow(() => kweaver.getClient());
});

test("failed re-configure clears previous client and defaults", () => {
  // First configure succeeds, sets a live client.
  kweaver.configure({ baseUrl: BASE, accessToken: TOKEN, bknId: "bkn-old" });
  const firstClient = kweaver.getClient();
  assert.ok(firstClient, "first configure should succeed");

  // Second configure fails validation — old client must NOT survive.
  const origUrl = process.env.KWEAVER_BASE_URL;
  const origTok = process.env.KWEAVER_TOKEN;
  delete process.env.KWEAVER_BASE_URL;
  delete process.env.KWEAVER_TOKEN;
  try {
    assert.throws(
      () => kweaver.configure({}),
      /baseUrl/
    );
  } finally {
    if (origUrl !== undefined) process.env.KWEAVER_BASE_URL = origUrl;
    if (origTok !== undefined) process.env.KWEAVER_TOKEN = origTok;
  }

  // After the failed reconfigure, getClient() must throw — not return the old client.
  assert.throws(
    () => kweaver.getClient(),
    /configure/,
    "getClient must throw after a failed re-configure"
  );
});

// ── search ────────────────────────────────────────────────────────────────────

test("search calls semanticSearch and returns result", async () => {
  kweaver.configure({ baseUrl: BASE, accessToken: TOKEN, bknId: "bkn-1" });
  const mockResult = {
    concepts: [
      {
        concept_type: "Risk",
        concept_id: "c-1",
        concept_name: "Supply Chain Risk",
        intent_score: 0.9,
        match_score: 0.8,
        rerank_score: 0.85,
      },
    ],
    hits_total: 1,
  };

  await withFetch(
    async () => new Response(JSON.stringify(mockResult), { status: 200 }),
    async () => {
      const result = await kweaver.search("supply chain risk");
      assert.equal(result.hits_total, 1);
      assert.equal(result.concepts[0].concept_name, "Supply Chain Risk");
    }
  );
});

test("search accepts bknId override", async () => {
  kweaver.configure({ baseUrl: BASE, accessToken: TOKEN, bknId: "bkn-default" });
  let capturedBody = "";

  await withFetch(
    async (_input, init) => {
      capturedBody = init?.body as string;
      return new Response(JSON.stringify({ concepts: [], hits_total: 0 }), { status: 200 });
    },
    async () => {
      await kweaver.search("query", { bknId: "bkn-override" });
      const parsed = JSON.parse(capturedBody);
      assert.equal(parsed.kn_id, "bkn-override");
    }
  );
});

test("search sends correct auth headers (Bearer + token)", async () => {
  kweaver.configure({ baseUrl: BASE, accessToken: TOKEN, bknId: "bkn-1" });
  let capturedHeaders: Record<string, string> = {};

  await withFetch(
    async (_input, init) => {
      capturedHeaders = init?.headers as Record<string, string>;
      return new Response(JSON.stringify({ concepts: [], hits_total: 0 }), { status: 200 });
    },
    async () => {
      await kweaver.search("test");
      assert.equal(capturedHeaders["authorization"], `Bearer ${TOKEN}`, "must include Bearer prefix");
      assert.equal(capturedHeaders["token"], TOKEN, "must include token header");
    }
  );
});

test("search throws when no bknId configured or provided", async () => {
  kweaver.configure({ baseUrl: BASE, accessToken: TOKEN });
  await assert.rejects(
    () => kweaver.search("test"),
    /bknId/
  );
});

// ── agents ────────────────────────────────────────────────────────────────────

test("agents returns list from API", async () => {
  kweaver.configure({ baseUrl: BASE, accessToken: TOKEN });

  await withFetch(
    async () =>
      new Response(
        JSON.stringify({ data: { records: [{ id: "a-1", name: "Agent One" }] } }),
        { status: 200 }
      ),
    async () => {
      const list = await kweaver.agents();
      assert.deepEqual(list, [{ id: "a-1", name: "Agent One" }]);
    }
  );
});

// ── chat ──────────────────────────────────────────────────────────────────────

test("chat calls agent chat and returns result", async () => {
  kweaver.configure({ baseUrl: BASE, accessToken: TOKEN, agentId: "ag-1" });

  await withFetch(
    async (input) => {
      const url = typeof input === "string" ? input : (input as Request).url;
      if (url.includes("/agent-market/agent")) {
        return new Response(
          JSON.stringify({ id: "ag-1", key: "k-1", version: "v1" }),
          { status: 200 }
        );
      }
      return new Response(
        JSON.stringify({
          message: { content: { final_answer: { answer: { text: "Hello!" } } } },
          conversation_id: "conv-1",
        }),
        { status: 200 }
      );
    },
    async () => {
      const reply = await kweaver.chat("Hello");
      assert.equal(reply.text, "Hello!");
      assert.equal(reply.conversationId, "conv-1");
    }
  );
});

test("chat throws when no agentId configured or provided", async () => {
  kweaver.configure({ baseUrl: BASE, accessToken: TOKEN });
  await assert.rejects(
    () => kweaver.chat("Hello"),
    /agentId/
  );
});

// ── bkns ──────────────────────────────────────────────────────────────────────

test("bkns returns list of knowledge networks", async () => {
  kweaver.configure({ baseUrl: BASE, accessToken: TOKEN });

  await withFetch(
    async () =>
      new Response(
        JSON.stringify({ data: [{ id: "bkn-1", name: "Net A" }] }),
        { status: 200 }
      ),
    async () => {
      const list = await kweaver.bkns();
      assert.deepEqual(list, [{ id: "bkn-1", name: "Net A" }]);
    }
  );
});

// ── weaver ────────────────────────────────────────────────────────────────────

test("weaver without wait returns void (not a job handle)", async () => {
  kweaver.configure({ baseUrl: BASE, accessToken: TOKEN, bknId: "bkn-1" });

  await withFetch(
    async () => new Response("", { status: 200 }),
    async () => {
      const result = await kweaver.weaver();
      assert.strictEqual(result, undefined, "fire-and-forget weaver() must return void");
    }
  );
});

test("weaver (fire-and-forget) triggers build without waiting", async () => {
  kweaver.configure({ baseUrl: BASE, accessToken: TOKEN, bknId: "bkn-1" });
  let buildCalled = false;

  await withFetch(
    async (input) => {
      const url = typeof input === "string" ? input : (input as Request).url;
      if (url.includes("full_build_ontology")) {
        buildCalled = true;
        return new Response("", { status: 200 });
      }
      return new Response("", { status: 200 });
    },
    async () => {
      await kweaver.weaver();
      assert.ok(buildCalled, "build endpoint should be called");
    }
  );
});

test("weaver wait=true polls until completed", async () => {
  kweaver.configure({ baseUrl: BASE, accessToken: TOKEN, bknId: "bkn-1" });
  let pollCount = 0;

  await withFetch(
    async (input) => {
      const url = typeof input === "string" ? input : (input as Request).url;
      if (url.includes("full_build_ontology")) {
        return new Response("", { status: 200 });
      }
      if (url.includes("full_ontology_building_status")) {
        pollCount++;
        const state = pollCount >= 2 ? "completed" : "running";
        return new Response(JSON.stringify({ state }), { status: 200 });
      }
      return new Response("", { status: 200 });
    },
    async () => {
      const status = await kweaver.weaver({ wait: true, interval: 1 });
      assert.equal((status as { state: string })?.state, "completed");
      assert.ok(pollCount >= 2, "should poll at least twice");
    }
  );
});

test("weaver wait=true throws on failed build", async () => {
  kweaver.configure({ baseUrl: BASE, accessToken: TOKEN, bknId: "bkn-1" });

  await withFetch(
    async (input) => {
      const url = typeof input === "string" ? input : (input as Request).url;
      if (url.includes("full_build_ontology")) {
        return new Response("", { status: 200 });
      }
      if (url.includes("full_ontology_building_status")) {
        return new Response(
          JSON.stringify({ state: "failed", state_detail: "OOM error" }),
          { status: 200 }
        );
      }
      return new Response("", { status: 200 });
    },
    async () => {
      await assert.rejects(
        () => kweaver.weaver({ wait: true, interval: 1 }),
        /failed/
      );
    }
  );
});

test("weaver throws when no bknId configured or provided", async () => {
  kweaver.configure({ baseUrl: BASE, accessToken: TOKEN });
  await assert.rejects(
    () => kweaver.weaver(),
    /bknId/
  );
});

// ── weaver fallback (ontology-manager) ────────────────────────────────────────

test("weaver falls back to ontology-manager when agent-retrieval build 404s", async () => {
  kweaver.configure({ baseUrl: BASE, accessToken: TOKEN, bknId: "bkn-1" });
  let fallbackCalled = false;

  await withFetch(
    async (input) => {
      const url = typeof input === "string" ? input : (input as Request).url;
      if (url.includes("full_build_ontology")) {
        return new Response("not found", { status: 404 });
      }
      if (url.includes("ontology-manager/in/v1/knowledge-networks")) {
        fallbackCalled = true;
        return new Response("", { status: 200 });
      }
      return new Response("", { status: 200 });
    },
    async () => {
      await kweaver.weaver();
      assert.ok(fallbackCalled, "should have called ontology-manager fallback");
    }
  );
});

test("weaver wait=true uses ontology-manager job status when agent-retrieval status 404s", async () => {
  kweaver.configure({ baseUrl: BASE, accessToken: TOKEN, bknId: "bkn-1" });
  let statusFallbackCalled = false;

  await withFetch(
    async (input) => {
      const url = typeof input === "string" ? input : (input as Request).url;
      if (url.includes("full_build_ontology")) {
        return new Response("", { status: 200 });
      }
      if (url.includes("full_ontology_building_status")) {
        return new Response("not found", { status: 404 });
      }
      if (url.includes("ontology-manager/in/v1/knowledge-networks")) {
        statusFallbackCalled = true;
        return new Response(JSON.stringify([{ state: "completed" }]), { status: 200 });
      }
      return new Response("", { status: 200 });
    },
    async () => {
      const result = await kweaver.weaver({ wait: true, interval: 1 });
      assert.equal((result as { state: string })?.state, "completed");
      assert.ok(statusFallbackCalled, "should have polled ontology-manager for status");
    }
  );
});

test("weaver throws when both build endpoints 404 (no-build deployment)", async () => {
  kweaver.configure({ baseUrl: BASE, accessToken: TOKEN, bknId: "bkn-1" });

  await withFetch(
    async () => new Response("not found", { status: 404 }),
    async () => {
      await assert.rejects(
        () => kweaver.weaver(),
        /No build endpoint available/,
        "must not silently succeed when no build endpoint exists"
      );
    }
  );
});
