import test from "node:test";
import assert from "node:assert/strict";

import { scanDatasourceMetadata, scanMetadata } from "../src/api/datasources.js";

const originalFetch = globalThis.fetch;

interface CallRecord {
  method: string;
  url: string;
  body?: string;
}

function stubFetch(handler: (call: CallRecord) => Response | Promise<Response>) {
  const calls: CallRecord[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const call: CallRecord = {
      method: (init?.method ?? "GET").toUpperCase(),
      url: typeof input === "string" ? input : input.toString(),
      body: typeof init?.body === "string" ? init.body : undefined,
    };
    calls.push(call);
    return handler(call);
  }) as typeof fetch;
  return calls;
}

test("scanMetadata: POSTs vega discover with wait=true", async () => {
  const calls = stubFetch((c) => {
    if (
      c.method === "POST" &&
      c.url.includes("/vega-backend/v1/catalogs/cat-1/discover")
    ) {
      return new Response(JSON.stringify({ task_id: "vega-task-9" }), { status: 200 });
    }
    throw new Error(`unexpected ${c.method} ${c.url}`);
  });

  try {
    const body = await scanMetadata({
      baseUrl: "https://h.example",
      accessToken: "tok",
      id: "cat-1",
      businessDomain: "bd_public",
    });
    assert.ok(body.includes("vega-task-9"), "should return discover response body");
    const discoverCall = calls.find((c) => c.url.includes("/discover"));
    assert.ok(discoverCall, "must call vega discover");
    const u = new URL(discoverCall!.url);
    assert.equal(u.searchParams.get("wait"), "true", "wait must be true");
    assert.equal(
      calls.filter((c) => c.url.includes("/data-connection/")).length,
      0,
      "must not touch data-connection",
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("scanDatasourceMetadata: delegates to vega discover (no GET-then-scan dance)", async () => {
  const calls = stubFetch((c) => {
    if (c.method === "POST" && c.url.includes("/vega-backend/v1/catalogs/cat-1/discover")) {
      return new Response(JSON.stringify({ task_id: "vega-task-1" }), { status: 200 });
    }
    throw new Error(`unexpected ${c.method} ${c.url}`);
  });

  try {
    const body = await scanDatasourceMetadata({
      baseUrl: "https://h.example",
      accessToken: "tok",
      id: "cat-1",
      businessDomain: "bd_public",
    });
    assert.ok(body.includes("vega-task-1"));
    assert.equal(
      calls.filter((c) => c.url.includes("/data-connection/")).length,
      0,
      "must not touch data-connection",
    );
    assert.equal(
      calls.filter((c) => c.method === "GET" && c.url.includes("/datasource/")).length,
      0,
      "must not look up legacy ds_type",
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("scanMetadata: surfaces vega 404 with HttpError", async () => {
  stubFetch(() => new Response("not found", { status: 404, statusText: "Not Found" }));

  try {
    await assert.rejects(
      () =>
        scanMetadata({
          baseUrl: "https://h.example",
          accessToken: "tok",
          id: "missing",
          businessDomain: "bd_public",
        }),
      /404/,
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});
