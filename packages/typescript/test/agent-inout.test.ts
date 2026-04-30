import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { exportAgents, importAgents, parseAttachmentFilename } from "../src/api/agents-inout.js";
import { EndpointUnavailableError, HttpError } from "../src/utils/http.js";

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

test("parseAttachmentFilename parses quoted and RFC5987 forms", () => {
  assert.equal(parseAttachmentFilename('attachment; filename="agents.json"'), "agents.json");
  assert.equal(parseAttachmentFilename("attachment; filename*=UTF-8''my%20file.json"), "my file.json");
});

test("exportAgents POSTs JSON agent_ids and parses Content-Disposition filename", async () => {
  let captured: { url: string; init?: RequestInit } | null = null;
  const payload = new TextEncoder().encode('{"export":true}');
  const restore = mockFetch(async (url, init) => {
    captured = { url: String(url), init };
    return new Response(payload, {
      status: 200,
      headers: {
        "content-disposition": 'attachment; filename="batch_agents.json"',
        "content-type": "application/json",
      },
    });
  });
  try {
    const out = await exportAgents({
      baseUrl: BASE,
      accessToken: TOKEN,
      agentIds: ["id1", "id2"],
    });
    assert.equal(out.filename, "batch_agents.json");
    assert.deepEqual(Array.from(out.bytes), Array.from(payload));
    assert.ok(captured);
    assert.equal(captured!.url, `${BASE}${FACTORY}/agent-inout/export`);
    assert.equal(captured!.init?.method, "POST");
    const hdrs = captured!.init?.headers;
    const ct =
      hdrs instanceof Headers
        ? hdrs.get("content-type")
        : (hdrs as Record<string, string> | undefined)?.["content-type"];
    assert.ok(ct?.includes("application/json"));
    const reqBody = JSON.parse((captured!.init!.body as string) ?? "{}");
    assert.deepEqual(reqBody.agent_ids, ["id1", "id2"]);
  } finally {
    restore();
  }
});

test("importAgents POSTs multipart file + import_type", async () => {
  const dir = mkdtempSync(join(tmpdir(), "kw-agent-inout-"));
  const file = join(dir, "export.json");
  writeFileSync(file, '{"agents":[]}', "utf-8");

  let captured: { url: string; init?: RequestInit } | null = null;
  const restore = mockFetch(async (url, init) => {
    captured = { url: String(url), init };
    return new Response('{"imported":1}', { status: 200 });
  });
  try {
    const body = await importAgents({
      baseUrl: BASE,
      accessToken: TOKEN,
      filePath: file,
      importType: "upsert",
    });
    assert.equal(body, '{"imported":1}');
    assert.ok(captured);
    assert.equal(captured!.url, `${BASE}${FACTORY}/agent-inout/import`);
    const form = captured!.init?.body as FormData;
    assert.ok(form instanceof FormData);
    assert.equal(form.get("import_type"), "upsert");
    const part = form.get("file");
    assert.ok(part instanceof Blob);
    assert.equal(await (part as Blob).text(), '{"agents":[]}');
  } finally {
    restore();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("exportAgents 405 yields EndpointUnavailableError with endpointPath", async () => {
  const restore = mockFetch(async () => new Response("no", { status: 405 }));
  try {
    await assert.rejects(() => exportAgents({ baseUrl: BASE, accessToken: TOKEN, agentIds: ["a"] }), (e: unknown) => {
      if (!(e instanceof EndpointUnavailableError)) return false;
      assert.equal(e.endpointPath, `${FACTORY}/agent-inout/export`);
      return true;
    });
  } finally {
    restore();
  }
});

test("importAgents non-404 4xx stays HttpError path via fetchWithRetry", async () => {
  const dir = mkdtempSync(join(tmpdir(), "kw-agent-inout-"));
  const file = join(dir, "x.json");
  writeFileSync(file, "{}", "utf-8");
  const restore = mockFetch(async () => new Response("bad", { status: 400 }));
  try {
    await assert.rejects(() => importAgents({ baseUrl: BASE, accessToken: TOKEN, filePath: file }), HttpError);
  } finally {
    restore();
    rmSync(dir, { recursive: true, force: true });
  }
});
