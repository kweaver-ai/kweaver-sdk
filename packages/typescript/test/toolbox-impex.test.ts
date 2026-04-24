import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { exportConfig, importConfig } from "../src/api/toolboxes.js";
import { parseToolboxExportArgs, parseToolboxImportArgs } from "../src/commands/toolbox.js";

const BASE = "https://platform.example";
const TOKEN = "tok-impex";
const IMPEX = "/api/agent-operator-integration/v1/impex";

function mockFetch(handler: (url: RequestInfo | URL, init?: RequestInit) => Promise<Response>) {
  const original = globalThis.fetch;
  globalThis.fetch = handler as typeof fetch;
  return () => { globalThis.fetch = original; };
}

// ── api/toolboxes.ts ─────────────────────────────────────────────────────────

test("exportConfig GETs /impex/export/{type}/{id} and returns raw bytes", async () => {
  let captured: { url: string; init?: RequestInit } | null = null;
  const restore = mockFetch(async (url, init) => {
    captured = { url: String(url), init };
    return new Response('{"box":"b1"}', { status: 200, headers: { "content-type": "application/json" } });
  });
  try {
    const buf = await exportConfig({ baseUrl: BASE, accessToken: TOKEN, id: "b1" });
    assert.ok(buf instanceof Uint8Array, "exportConfig must return Uint8Array");
    assert.equal(new TextDecoder("utf-8").decode(buf), '{"box":"b1"}');
    assert.ok(captured);
    assert.equal(captured!.url, `${BASE}${IMPEX}/export/toolbox/b1`);
    assert.equal(captured!.init?.method, "GET");
  } finally { restore(); }
});

test("exportConfig preserves multi-byte payloads byte-for-byte (no string round-trip loss)", async () => {
  // Chinese name in the .adp content — verifies we don't go through `string`.
  const payload = '{"name":"基础结构化数据分析工具箱2"}';
  const expectedBytes = new TextEncoder().encode(payload);
  const restore = mockFetch(async () =>
    new Response(expectedBytes, { status: 200, headers: { "content-type": "application/json" } })
  );
  try {
    const buf = await exportConfig({ baseUrl: BASE, accessToken: TOKEN, id: "b1" });
    assert.equal(buf.byteLength, expectedBytes.byteLength);
    assert.deepEqual(Array.from(buf), Array.from(expectedBytes));
  } finally { restore(); }
});

test("exportConfig honors --type=mcp", async () => {
  let url = "";
  const restore = mockFetch(async (u) => {
    url = String(u);
    return new Response("{}", { status: 200 });
  });
  try {
    await exportConfig({ baseUrl: BASE, accessToken: TOKEN, id: "m1", type: "mcp" });
    assert.equal(url, `${BASE}${IMPEX}/export/mcp/m1`);
  } finally { restore(); }
});

test("importConfig POSTs multipart with field 'data' to /impex/import/{type}", async () => {
  const dir = mkdtempSync(join(tmpdir(), "kw-impex-"));
  const file = join(dir, "toolbox_b1.adp");
  writeFileSync(file, '{"hello":"world"}', "utf-8");

  let captured: { url: string; init?: RequestInit } | null = null;
  const restore = mockFetch(async (url, init) => {
    captured = { url: String(url), init };
    return new Response('{"ok":true}', { status: 200 });
  });
  try {
    const body = await importConfig({ baseUrl: BASE, accessToken: TOKEN, filePath: file });
    assert.equal(body, '{"ok":true}');
    assert.ok(captured);
    assert.equal(captured!.url, `${BASE}${IMPEX}/import/toolbox`);
    assert.equal(captured!.init?.method, "POST");
    const form = captured!.init?.body as FormData;
    assert.ok(form instanceof FormData, "body must be FormData");
    const part = form.get("data");
    assert.ok(part instanceof Blob, "field 'data' must be a Blob");
    const text = await (part as Blob).text();
    assert.equal(text, '{"hello":"world"}');
  } finally {
    restore();
    rmSync(dir, { recursive: true, force: true });
  }
});

// ── CLI parsing ──────────────────────────────────────────────────────────────

test("parseToolboxExportArgs requires <box-id>", () => {
  assert.throws(() => parseToolboxExportArgs([]), /box-id/);
});

test("parseToolboxExportArgs defaults: type=toolbox, output=''", () => {
  const opts = parseToolboxExportArgs(["b1"]);
  assert.equal(opts.boxId, "b1");
  assert.equal(opts.type, "toolbox");
  assert.equal(opts.output, "");
});

test("parseToolboxExportArgs parses -o, --type, -bd", () => {
  const opts = parseToolboxExportArgs(["b1", "-o", "out.adp", "--type", "operator", "-bd", "bd_x"]);
  assert.equal(opts.output, "out.adp");
  assert.equal(opts.type, "operator");
  assert.equal(opts.businessDomain, "bd_x");
});

test("parseToolboxExportArgs rejects unknown --type", () => {
  assert.throws(() => parseToolboxExportArgs(["b1", "--type", "weird"]), /--type must be/);
});

test("parseToolboxExportArgs supports -o - for stdout", () => {
  const opts = parseToolboxExportArgs(["b1", "-o", "-"]);
  assert.equal(opts.output, "-");
});

test("parseToolboxImportArgs requires <file>", () => {
  assert.throws(() => parseToolboxImportArgs([]), /file/);
});

test("parseToolboxImportArgs defaults type=toolbox, pretty=true", () => {
  const opts = parseToolboxImportArgs(["./x.adp"]);
  assert.equal(opts.filePath, "./x.adp");
  assert.equal(opts.type, "toolbox");
  assert.equal(opts.pretty, true);
});

test("parseToolboxImportArgs parses --type and --compact", () => {
  const opts = parseToolboxImportArgs(["x.adp", "--type", "mcp", "--compact"]);
  assert.equal(opts.type, "mcp");
  assert.equal(opts.pretty, false);
});

test("parseToolboxImportArgs rejects unknown --type", () => {
  assert.throws(() => parseToolboxImportArgs(["x.adp", "--type", "weird"]), /--type must be/);
});
