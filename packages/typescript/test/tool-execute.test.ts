import test from "node:test";
import assert from "node:assert/strict";
import { executeTool, debugTool } from "../src/api/toolboxes.js";
import { parseToolInvokeArgs } from "../src/commands/tool.js";

const BASE = "https://platform.example";
const TOKEN = "tok-exec";
const PREFIX = "/api/agent-operator-integration/v1/tool-box";

function mockFetch(handler: (url: RequestInfo | URL, init?: RequestInit) => Promise<Response>) {
  const original = globalThis.fetch;
  globalThis.fetch = handler as typeof fetch;
  return () => { globalThis.fetch = original; };
}

test("executeTool POSTs envelope JSON to /tool-box/{box}/proxy/{tool}", async () => {
  let captured: { url: string; init?: RequestInit } | null = null;
  const restore = mockFetch(async (url, init) => {
    captured = { url: String(url), init };
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  });
  try {
    await executeTool({
      baseUrl: BASE,
      accessToken: TOKEN,
      boxId: "b1",
      toolId: "t1",
      header: { Authorization: "Bearer abc" },
      query: { dry: "true" },
      body: { task_id: "x" },
      timeout: 42,
    });
    assert.ok(captured);
    assert.equal(captured!.url, `${BASE}${PREFIX}/b1/proxy/t1`);
    assert.equal(captured!.init?.method, "POST");
    const sent = JSON.parse(captured!.init?.body as string);
    assert.deepEqual(sent, {
      timeout: 42,
      header: { Authorization: "Bearer abc" },
      query: { dry: "true" },
      path: {},
      body: { task_id: "x" },
    });
  } finally { restore(); }
});

test("debugTool POSTs envelope JSON to /tool-box/{box}/tool/{tool}/debug", async () => {
  let capturedUrl = "";
  const restore = mockFetch(async (url) => {
    capturedUrl = String(url);
    return new Response("{}", { status: 200 });
  });
  try {
    await debugTool({ baseUrl: BASE, accessToken: TOKEN, boxId: "b1", toolId: "t1" });
    assert.equal(capturedUrl, `${BASE}${PREFIX}/b1/tool/t1/debug`);
  } finally { restore(); }
});

test("envelope defaults: omitted timeout absent, header/query/path/body coerced to {}", async () => {
  let captured: any = null;
  const restore = mockFetch(async (_url, init) => {
    captured = JSON.parse(init?.body as string);
    return new Response("{}", { status: 200 });
  });
  try {
    await executeTool({ baseUrl: BASE, accessToken: TOKEN, boxId: "b1", toolId: "t1" });
    assert.deepEqual(captured, { header: {}, query: {}, path: {}, body: {} });
    assert.ok(!("timeout" in captured));
  } finally { restore(); }
});

test("executeTool and debugTool forward path in envelope (data view tools)", async () => {
  const bodies: string[] = [];
  const restore = mockFetch(async (_url, init) => {
    bodies.push(init?.body as string);
    return new Response("{}", { status: 200 });
  });
  try {
    const id = "7028f2fa-0f7c-4249-b6f4-b08f87588d16";
    await executeTool({
      baseUrl: BASE,
      accessToken: TOKEN,
      boxId: "bg",
      toolId: "get_dataview_detail",
      path: { id },
    });
    await debugTool({
      baseUrl: BASE,
      accessToken: TOKEN,
      boxId: "bq",
      toolId: "query_dataview_sql",
      path: { id },
      body: { limit: 3, offset: 0 },
    });
    assert.deepEqual(JSON.parse(bodies[0]).path, { id });
    assert.deepEqual(JSON.parse(bodies[1]).path, { id });
  } finally { restore(); }
});

// ── CLI parsing ──────────────────────────────────────────────────────────────

test("parseToolInvokeArgs requires --toolbox and a tool id", () => {
  assert.throws(() => parseToolInvokeArgs([]), /--toolbox/);
  assert.throws(() => parseToolInvokeArgs(["--toolbox", "b1"]), /tool-id/i);
});

test("parseToolInvokeArgs parses headers/query/path/body/timeout", () => {
  const opts = parseToolInvokeArgs([
    "--toolbox", "b1", "t1",
    "--body", '{"k":1}',
    "--header", '{"X-Foo":"bar"}',
    "--query", '{"q":"v"}',
    "--path", '{"id":"7028f2fa-0f7c-4249-b6f4-b08f87588d16"}',
    "--timeout", "30",
  ]);
  assert.equal(opts.boxId, "b1");
  assert.equal(opts.toolId, "t1");
  assert.deepEqual(opts.body, { k: 1 });
  assert.deepEqual(opts.header, { "X-Foo": "bar" });
  assert.deepEqual(opts.query, { q: "v" });
  assert.deepEqual(opts.path, { id: "7028f2fa-0f7c-4249-b6f4-b08f87588d16" });
  assert.equal(opts.timeout, 30);
});

test("parseToolInvokeArgs rejects --body and --body-file together", () => {
  assert.throws(
    () => parseToolInvokeArgs(["--toolbox", "b1", "t1", "--body", "{}", "--body-file", "x.json"]),
    /mutually exclusive/i,
  );
});

test("parseToolInvokeArgs rejects malformed JSON in --header", () => {
  assert.throws(
    () => parseToolInvokeArgs(["--toolbox", "b1", "t1", "--header", "not-json"]),
    /--header/,
  );
});

test("parseToolInvokeArgs rejects array for --query (must be object)", () => {
  assert.throws(
    () => parseToolInvokeArgs(["--toolbox", "b1", "t1", "--query", "[1,2]"]),
    /--query.*object/i,
  );
});

test("parseToolInvokeArgs rejects non-positive --timeout", () => {
  assert.throws(
    () => parseToolInvokeArgs(["--toolbox", "b1", "t1", "--timeout", "0"]),
    /timeout/i,
  );
});
