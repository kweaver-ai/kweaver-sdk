import test from "node:test";
import assert from "node:assert/strict";

import {
  createDataflow,
  runDataflow,
  pollDataflowResults,
  deleteDataflow,
  executeDataflow,
} from "../src/api/dataflow.js";
import {
  getDataflowLogsPage,
  listDataflowRuns,
  listDataflows,
  runDataflowWithFile,
  runDataflowWithRemoteUrl,
} from "../src/api/dataflow2.js";

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
      _sleep: async (ms: number) => { sleepDurations.push(ms); },
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

test("listDataflows sends GET to the v2 dataflow list endpoint and returns dags", async () => {
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = async (input, init) => {
      const url = typeof input === "string" ? input : (input as URL).toString();
      assert.equal(init?.method, "GET");
      assert.equal(url, `${BASE}/api/automation/v2/dags?type=data-flow&page=0&limit=-1`);
      const headers = new Headers(init?.headers);
      assert.equal(headers.get("authorization"), `Bearer ${TOKEN}`);
      assert.equal(headers.get("token"), TOKEN);
      return new Response(JSON.stringify({ dags: [{ id: "dag-001", title: "Demo Flow" }] }), { status: 200 });
    };

    const body = await listDataflows(COMMON_OPTS);
    assert.equal(body.dags[0]?.id, "dag-001");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("runDataflowWithFile posts multipart form data and returns dag_instance_id", async () => {
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = async (input, init) => {
      const url = typeof input === "string" ? input : (input as URL).toString();
      assert.equal(init?.method, "POST");
      assert.equal(url, `${BASE}/api/automation/v2/dataflow-doc/trigger/dag-001`);
      assert.ok(init?.body instanceof FormData);
      return new Response(JSON.stringify({ dag_instance_id: "ins-001" }), { status: 200 });
    };

    const body = await runDataflowWithFile({
      ...COMMON_OPTS,
      dagId: "dag-001",
      fileName: "demo.pdf",
      fileBytes: new Uint8Array([1, 2, 3]),
    });
    assert.equal(body.dag_instance_id, "ins-001");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("runDataflowWithRemoteUrl posts JSON body and returns dag_instance_id", async () => {
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = async (input, init) => {
      const url = typeof input === "string" ? input : (input as URL).toString();
      assert.equal(init?.method, "POST");
      assert.equal(url, `${BASE}/api/automation/v2/dataflow-doc/trigger/dag-001`);
      const headers = new Headers(init?.headers);
      assert.equal(headers.get("content-type"), "application/json");
      assert.equal(
        init?.body,
        JSON.stringify({ source_from: "remote", url: "https://example.com/demo.pdf", name: "demo.pdf" }),
      );
      return new Response(JSON.stringify({ dag_instance_id: "ins-remote-001" }), { status: 200 });
    };

    const body = await runDataflowWithRemoteUrl({
      ...COMMON_OPTS,
      dagId: "dag-001",
      url: "https://example.com/demo.pdf",
      name: "demo.pdf",
    });
    assert.equal(body.dag_instance_id, "ins-remote-001");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("listDataflowRuns sends GET to the v2 runs endpoint with recent-20 query parameters", async () => {
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = async (input, init) => {
      const url = typeof input === "string" ? input : (input as URL).toString();
      assert.equal(init?.method, "GET");
      assert.equal(url, `${BASE}/api/automation/v2/dag/dag-001/results?page=0&limit=20&sortBy=started_at&order=desc`);
      return new Response(JSON.stringify({ results: [{ id: "run-001", status: "success" }] }), { status: 200 });
    };

    const body = await listDataflowRuns({
      ...COMMON_OPTS,
      dagId: "dag-001",
      page: 0,
      limit: 20,
      sortBy: "started_at",
      order: "desc",
    });
    assert.equal(body.results[0]?.id, "run-001");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("listDataflowRuns sends start_time and end_time when date-window parameters are provided", async () => {
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = async (input, init) => {
      const url = typeof input === "string" ? input : (input as URL).toString();
      assert.equal(init?.method, "GET");
      assert.equal(
        url,
        `${BASE}/api/automation/v2/dag/dag-001/results?page=0&limit=20&sortBy=started_at&order=desc&start_time=1775059200&end_time=1775750399`,
      );
      return new Response(JSON.stringify({ results: [{ id: "run-002", status: "success" }] }), { status: 200 });
    };

    const body = await listDataflowRuns({
      ...COMMON_OPTS,
      dagId: "dag-001",
      page: 0,
      limit: 20,
      sortBy: "started_at",
      order: "desc",
      startTime: 1775059200,
      endTime: 1775750399,
    });
    assert.equal(body.results[0]?.id, "run-002");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("getDataflowLogsPage sends GET to the confirmed logs endpoint with paging", async () => {
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = async (input, init) => {
      const url = typeof input === "string" ? input : (input as URL).toString();
      assert.equal(init?.method, "GET");
      assert.equal(url, `${BASE}/api/automation/v2/dag/dag-001/result/ins-001?page=0&limit=10`);
      return new Response(JSON.stringify({ results: [{ id: "0", status: "success" }], total: 1 }), { status: 200 });
    };

    const body = await getDataflowLogsPage({ ...COMMON_OPTS, dagId: "dag-001", instanceId: "ins-001", page: 0, limit: 10 });
    assert.equal(body.results[0]?.id, "0");
  } finally {
    globalThis.fetch = originalFetch;
  }
});
