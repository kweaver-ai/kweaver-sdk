import test from "node:test";
import assert from "node:assert/strict";

import { scanDatasourceMetadata } from "../src/api/datasources.js";

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

test("scanDatasourceMetadata: fetches ds type then triggers scan and polls", async () => {
  const calls = stubFetch((c) => {
    if (c.method === "GET" && c.url.includes("/data-connection/v1/datasource/")) {
      return new Response(JSON.stringify({ type: "postgres" }), { status: 200 });
    }
    if (c.method === "POST" && c.url.endsWith("/data-connection/v1/metadata/scan")) {
      return new Response(JSON.stringify({ id: "task-xyz" }), { status: 200 });
    }
    if (c.method === "GET" && c.url.includes("/data-connection/v1/metadata/scan/")) {
      return new Response(JSON.stringify({ status: "success" }), { status: 200 });
    }
    throw new Error(`unexpected ${c.method} ${c.url}`);
  });

  try {
    const taskId = await scanDatasourceMetadata({
      baseUrl: "https://h.example",
      accessToken: "tok",
      id: "ds-1",
      businessDomain: "bd_public",
    });

    assert.equal(taskId, "task-xyz");

    const lookup = calls.find((c) => c.method === "GET" && c.url.includes("/datasource/ds-1"));
    assert.ok(lookup, "expected datasource lookup call");

    const scanPost = calls.find((c) => c.method === "POST" && c.url.endsWith("/metadata/scan"));
    assert.ok(scanPost, "expected scan POST call");
    assert.ok(scanPost!.body, "scan body should be present");
    const scanBody = JSON.parse(scanPost!.body!);
    assert.equal(scanBody.ds_info.ds_id, "ds-1");
    assert.equal(scanBody.ds_info.ds_type, "postgres", "ds_type should come from datasource lookup");

    const status = calls.find((c) => c.method === "GET" && c.url.includes("/metadata/scan/task-xyz"));
    assert.ok(status, "expected status poll call");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("scanDatasourceMetadata: defaults ds_type to mysql when datasource has no type", async () => {
  stubFetch((c) => {
    if (c.method === "GET" && c.url.includes("/data-connection/v1/datasource/")) {
      return new Response(JSON.stringify({}), { status: 200 });
    }
    if (c.method === "POST" && c.url.endsWith("/data-connection/v1/metadata/scan")) {
      const body = JSON.parse(c.body ?? "{}");
      assert.equal(body.ds_info.ds_type, "mysql");
      return new Response(JSON.stringify({ id: "task-default" }), { status: 200 });
    }
    if (c.method === "GET" && c.url.includes("/data-connection/v1/metadata/scan/")) {
      return new Response(JSON.stringify({ status: "success" }), { status: 200 });
    }
    throw new Error(`unexpected ${c.method} ${c.url}`);
  });

  try {
    const taskId = await scanDatasourceMetadata({
      baseUrl: "https://h.example",
      accessToken: "tok",
      id: "ds-2",
    });
    assert.equal(taskId, "task-default");
  } finally {
    globalThis.fetch = originalFetch;
  }
});
