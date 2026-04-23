import test from "node:test";
import assert from "node:assert/strict";
import {
  createToolbox,
  deleteToolbox,
  setToolboxStatus,
  uploadTool,
  setToolStatuses,
  listToolboxes,
  listTools,
} from "../src/api/toolboxes.js";

const BASE = "https://platform.example";
const TOKEN = "tok-1";

function mockFetch(handler: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>) {
  const original = globalThis.fetch;
  globalThis.fetch = handler as typeof fetch;
  return () => { globalThis.fetch = original; };
}

test("createToolbox POSTs JSON to /tool-box and returns body", async () => {
  let captured: { url: string; init?: RequestInit } | null = null;
  const restore = mockFetch(async (url, init) => {
    captured = { url: String(url), init };
    return new Response(JSON.stringify({ box_id: "b1" }), { status: 200 });
  });
  try {
    const body = await createToolbox({
      baseUrl: BASE,
      accessToken: TOKEN,
      name: "demo",
      description: "d",
      serviceUrl: "http://svc:1234",
    });
    assert.ok(captured);
    assert.equal(captured!.url, `${BASE}/api/agent-operator-integration/v1/tool-box`);
    assert.equal(captured!.init?.method, "POST");
    const sent = JSON.parse(captured!.init?.body as string);
    assert.equal(sent.box_name, "demo");
    assert.equal(sent.box_desc, "d");
    assert.equal(sent.box_svc_url, "http://svc:1234");
    assert.equal(sent.metadata_type, "openapi");
    assert.equal(sent.source, "custom");
    assert.equal(JSON.parse(body).box_id, "b1");
  } finally { restore(); }
});

test("deleteToolbox DELETEs /tool-box/{id}", async () => {
  let captured: { url: string; method?: string; init?: RequestInit } | null = null;
  const restore = mockFetch(async (url, init) => {
    captured = { url: String(url), method: init?.method, init };
    return new Response("", { status: 200 });
  });
  try {
    await deleteToolbox({ baseUrl: BASE, accessToken: TOKEN, boxId: "b1" });
    assert.equal(captured!.url, `${BASE}/api/agent-operator-integration/v1/tool-box/b1`);
    assert.equal(captured!.method, "DELETE");
    const authHeader = new Headers(captured!.init?.headers).get("authorization");
    assert.equal(authHeader, `Bearer ${TOKEN}`);
  } finally { restore(); }
});

test("setToolboxStatus POSTs {status} to /status", async () => {
  let captured: { url: string; body: string } | null = null;
  const restore = mockFetch(async (url, init) => {
    captured = { url: String(url), body: init?.body as string };
    return new Response("", { status: 200 });
  });
  try {
    await setToolboxStatus({ baseUrl: BASE, accessToken: TOKEN, boxId: "b1", status: "published" });
    assert.equal(captured!.url, `${BASE}/api/agent-operator-integration/v1/tool-box/b1/status`);
    assert.deepEqual(JSON.parse(captured!.body), { status: "published" });
  } finally { restore(); }
});

test("uploadTool POSTs multipart with metadata_type=openapi and data file", async () => {
  let captured: { url: string; body: BodyInit | null | undefined; contentType: string | null } | null = null;
  const restore = mockFetch(async (url, init) => {
    captured = {
      url: String(url),
      body: init?.body,
      contentType: new Headers(init?.headers).get("content-type"),
    };
    return new Response(JSON.stringify({ success_ids: ["t1"] }), { status: 200 });
  });
  try {
    const body = await uploadTool({
      baseUrl: BASE,
      accessToken: TOKEN,
      boxId: "b1",
      filePath: new URL("./fixtures/openapi.json", import.meta.url).pathname,
    });
    assert.equal(captured!.url, `${BASE}/api/agent-operator-integration/v1/tool-box/b1/tool`);
    assert.ok(captured!.body instanceof FormData);
    // content-type should not be set explicitly — fetch will set the multipart boundary
    assert.equal(captured!.contentType, null);
    assert.deepEqual(JSON.parse(body).success_ids, ["t1"]);
  } finally { restore(); }
});

test("setToolStatuses POSTs JSON array to /tools/status", async () => {
  let captured: { url: string; body: string } | null = null;
  const restore = mockFetch(async (url, init) => {
    captured = { url: String(url), body: init?.body as string };
    return new Response("", { status: 200 });
  });
  try {
    await setToolStatuses({
      baseUrl: BASE,
      accessToken: TOKEN,
      boxId: "b1",
      updates: [{ toolId: "t1", status: "enabled" }, { toolId: "t2", status: "disabled" }],
    });
    assert.equal(captured!.url, `${BASE}/api/agent-operator-integration/v1/tool-box/b1/tools/status`);
    assert.deepEqual(JSON.parse(captured!.body), [
      { tool_id: "t1", status: "enabled" },
      { tool_id: "t2", status: "disabled" },
    ]);
  } finally { restore(); }
});

test("listToolboxes GETs /tool-box/list with query params", async () => {
  let captured: { url: string } | null = null;
  const restore = mockFetch(async (url) => {
    captured = { url: String(url) };
    return new Response(JSON.stringify({ entries: [] }), { status: 200 });
  });
  try {
    await listToolboxes({ baseUrl: BASE, accessToken: TOKEN, keyword: "demo", limit: 20, offset: 0 });
    assert.match(captured!.url, /\/tool-box\/list\?/);
    assert.match(captured!.url, /keyword=demo/);
    assert.match(captured!.url, /limit=20/);
    assert.match(captured!.url, /offset=0/);
  } finally { restore(); }
});

test("listToolboxes with no params produces no query string", async () => {
  let captured: { url: string } | null = null;
  const restore = mockFetch(async (url) => {
    captured = { url: String(url) };
    return new Response(JSON.stringify({ entries: [] }), { status: 200 });
  });
  try {
    await listToolboxes({ baseUrl: BASE, accessToken: TOKEN });
    assert.ok(captured);
    assert.equal(captured!.url, `${BASE}/api/agent-operator-integration/v1/tool-box/list`);
    assert.ok(!captured!.url.includes("?"), `URL should have no '?' suffix; got ${captured!.url}`);
  } finally { restore(); }
});

test("listTools GETs /tool-box/{id}/tools/list", async () => {
  let captured: { url: string } | null = null;
  const restore = mockFetch(async (url) => {
    captured = { url: String(url) };
    return new Response(JSON.stringify({ entries: [] }), { status: 200 });
  });
  try {
    await listTools({ baseUrl: BASE, accessToken: TOKEN, boxId: "b1" });
    assert.match(captured!.url, /\/tool-box\/b1\/tools\/list($|\?)/);
  } finally { restore(); }
});
