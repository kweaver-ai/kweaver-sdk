import test from "node:test";
import assert from "node:assert/strict";

import {
  createDataflow,
  runDataflow,
  pollDataflowResults,
  deleteDataflow,
  executeDataflow,
} from "../src/api/dataflow.js";

const BASE = "https://dip.aishu.cn";
const TOKEN = "token-abc";
const COMMON_OPTS = { baseUrl: BASE, accessToken: TOKEN };

// ── createDataflow ────────────────────────────────────────────────────────────

test("createDataflow sends POST to /api/automation/v1/data-flow/flow and returns id", async () => {
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = async (input, init) => {
      const url = typeof input === "string" ? input : (input as URL).toString();
      assert.equal(init?.method, "POST");
      assert.equal(url, `${BASE}/api/automation/v1/data-flow/flow`);
      const headers = new Headers(init?.headers);
      assert.equal(headers.get("authorization"), `Bearer ${TOKEN}`);
      assert.equal(headers.get("token"), TOKEN);
      return new Response(JSON.stringify({ id: "dag-001" }), { status: 200 });
    };

    const id = await createDataflow({
      ...COMMON_OPTS,
      body: {
        title: "Test Flow",
        trigger_config: { operator: "manual" },
        steps: [],
      },
    });
    assert.equal(id, "dag-001");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

// ── runDataflow ───────────────────────────────────────────────────────────────

test("runDataflow sends POST with empty JSON body to /api/automation/v1/run-instance/{dagId}", async () => {
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = async (input, init) => {
      const url = typeof input === "string" ? input : (input as URL).toString();
      assert.equal(init?.method, "POST");
      assert.equal(url, `${BASE}/api/automation/v1/run-instance/dag-001`);
      assert.equal(init?.body, "{}");
      return new Response(JSON.stringify({ run_id: "run-123" }), { status: 200 });
    };

    await runDataflow({ ...COMMON_OPTS, dagId: "dag-001" });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

// ── pollDataflowResults ───────────────────────────────────────────────────────

test("pollDataflowResults returns success status", async () => {
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = async (input, init) => {
      const url = typeof input === "string" ? input : (input as URL).toString();
      assert.equal(init?.method, "GET");
      assert.equal(url, `${BASE}/api/automation/v1/dag/dag-001/results`);
      return new Response(
        JSON.stringify({ results: [{ status: "success" }] }),
        { status: 200 }
      );
    };

    const result = await pollDataflowResults({
      ...COMMON_OPTS,
      dagId: "dag-001",
      interval: 0,
      timeout: 10,
    });
    assert.equal(result.status, "success");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("pollDataflowResults returns completed as success", async () => {
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = async () => {
      return new Response(
        JSON.stringify({ results: [{ status: "completed" }] }),
        { status: 200 }
      );
    };

    const result = await pollDataflowResults({
      ...COMMON_OPTS,
      dagId: "dag-002",
      interval: 0,
      timeout: 10,
    });
    assert.equal(result.status, "completed");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("pollDataflowResults throws on failed status with reason in error message", async () => {
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = async () => {
      return new Response(
        JSON.stringify({ results: [{ status: "failed", reason: "Out of memory" }] }),
        { status: 200 }
      );
    };

    await assert.rejects(
      () =>
        pollDataflowResults({
          ...COMMON_OPTS,
          dagId: "dag-003",
          interval: 0,
          timeout: 10,
        }),
      (err: Error) => {
        assert.ok(err instanceof Error);
        assert.ok(err.message.includes("Out of memory"), `Expected "Out of memory" in: ${err.message}`);
        return true;
      }
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("pollDataflowResults throws on timeout", async () => {
  const originalFetch = globalThis.fetch;
  try {
    // Always return a pending/running status so it never completes
    globalThis.fetch = async () => {
      return new Response(
        JSON.stringify({ results: [{ status: "running" }] }),
        { status: 200 }
      );
    };

    await assert.rejects(
      () =>
        pollDataflowResults({
          ...COMMON_OPTS,
          dagId: "dag-004",
          interval: 0,
          timeout: 0, // Immediate timeout
        }),
      /timeout|timed out/i
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

// ── deleteDataflow ────────────────────────────────────────────────────────────

test("deleteDataflow sends DELETE to /api/automation/v1/data-flow/flow/{dagId}", async () => {
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = async (input, init) => {
      const url = typeof input === "string" ? input : (input as URL).toString();
      assert.equal(init?.method, "DELETE");
      assert.equal(url, `${BASE}/api/automation/v1/data-flow/flow/dag-001`);
      return new Response(null, { status: 204 });
    };

    await deleteDataflow({ ...COMMON_OPTS, dagId: "dag-001" });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

// ── executeDataflow ───────────────────────────────────────────────────────────

test("executeDataflow runs full lifecycle (create → run → poll → delete) and cleans up", async () => {
  const originalFetch = globalThis.fetch;
  const calls: string[] = [];
  try {
    globalThis.fetch = async (input, init) => {
      const url = typeof input === "string" ? input : (input as URL).toString();
      const method = (init?.method ?? "GET").toUpperCase();

      if (method === "POST" && url.includes("/data-flow/flow")) {
        calls.push("create");
        return new Response(JSON.stringify({ id: "dag-999" }), { status: 200 });
      }
      if (method === "POST" && url.includes("/run-instance/")) {
        calls.push("run");
        return new Response(JSON.stringify({ run_id: "run-1" }), { status: 200 });
      }
      if (method === "GET" && url.includes("/dag/dag-999/results")) {
        calls.push("poll");
        return new Response(JSON.stringify({ results: [{ status: "success" }] }), { status: 200 });
      }
      if (method === "DELETE" && url.includes("/data-flow/flow/dag-999")) {
        calls.push("delete");
        return new Response(null, { status: 204 });
      }
      throw new Error(`Unexpected fetch: ${method} ${url}`);
    };

    const result = await executeDataflow({
      ...COMMON_OPTS,
      body: {
        title: "Full Pipeline",
        trigger_config: { operator: "manual" },
        steps: [],
      },
      interval: 0,
      timeout: 30,
    });

    assert.equal(result.status, "success");
    assert.deepEqual(calls, ["create", "run", "poll", "delete"]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("pollDataflowResults uses exponential backoff between polls", async () => {
  const originalFetch = globalThis.fetch;
  const sleepDurations: number[] = [];
  let callCount = 0;

  try {
    globalThis.fetch = async () => {
      callCount++;
      if (callCount < 4) {
        return new Response(JSON.stringify({ results: [] }), { status: 200 });
      }
      return new Response(
        JSON.stringify({ results: [{ status: "success" }] }),
        { status: 200 }
      );
    };

    const result = await pollDataflowResults({
      ...COMMON_OPTS,
      dagId: "dag-backoff",
      interval: 3,
      timeout: 900,
      _delayFn: async (ms: number) => { sleepDurations.push(ms); },
    });
    assert.equal(result.status, "success");
    // Backoff: 3000, 6000, 12000 (doubling, capped at 30000)
    assert.deepEqual(sleepDurations, [3000, 6000, 12000]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("executeDataflow cleans up DAG even on failure", async () => {
  const originalFetch = globalThis.fetch;
  const calls: string[] = [];
  try {
    globalThis.fetch = async (input, init) => {
      const url = typeof input === "string" ? input : (input as URL).toString();
      const method = (init?.method ?? "GET").toUpperCase();

      if (method === "POST" && url.includes("/data-flow/flow")) {
        calls.push("create");
        return new Response(JSON.stringify({ id: "dag-888" }), { status: 200 });
      }
      if (method === "POST" && url.includes("/run-instance/")) {
        calls.push("run");
        // Simulate run failure
        return new Response(JSON.stringify({ error: "failed" }), { status: 500, statusText: "Internal Server Error" });
      }
      if (method === "DELETE" && url.includes("/data-flow/flow/dag-888")) {
        calls.push("delete");
        return new Response(null, { status: 204 });
      }
      throw new Error(`Unexpected fetch: ${method} ${url}`);
    };

    await assert.rejects(
      () =>
        executeDataflow({
          ...COMMON_OPTS,
          body: {
            title: "Failing Pipeline",
            trigger_config: { operator: "manual" },
            steps: [],
          },
          interval: 0,
          timeout: 30,
        })
    );

    // Delete must still have been called despite the run failure
    assert.ok(calls.includes("delete"), `Expected delete to be called, got: ${JSON.stringify(calls)}`);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
