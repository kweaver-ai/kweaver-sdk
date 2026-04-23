import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import { KWeaverClient } from "../src/client.js";
import { runVegaCommand } from "../src/commands/vega.js";

const BASE = "https://mock.kweaver.test";
const TOKEN = "test-token-abc";

function makeClient(): KWeaverClient {
  return new KWeaverClient({ baseUrl: BASE, accessToken: TOKEN });
}

function mockFetch(response: unknown, statusCode = 200) {
  const orig = globalThis.fetch;
  const calls: Array<{ url: string; method: string; body?: string }> = [];

  globalThis.fetch = async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    const method = init?.method ?? "GET";
    const body = init?.body ? String(init.body) : undefined;
    calls.push({ url, method, body });
    const text = typeof response === "string" ? response : JSON.stringify(response);
    return new Response(text, { status: statusCode });
  };

  return { calls, restore: () => { globalThis.fetch = orig; } };
}

// ── catalog health-status: ids must be in the path, not query ──────────────

test("vega.catalogHealthStatus sends ids in the URL path, not query params", async () => {
  const mock = mockFetch({ entries: [{ id: "c-1", health_status: "healthy" }] });
  try {
    const client = makeClient();
    await client.vega.catalogHealthStatus("c-1");
    const url = new URL(mock.calls[0].url);
    // Correct: /api/vega-backend/v1/catalogs/c-1/health-status
    assert.equal(url.pathname, "/api/vega-backend/v1/catalogs/c-1/health-status");
    // ids should NOT be a query param
    assert.equal(url.searchParams.get("ids"), null, "ids must not be in query params");
  } finally {
    mock.restore();
  }
});

test("vega.catalogHealthStatus handles comma-separated multi-ids in path", async () => {
  const mock = mockFetch({ entries: [] });
  try {
    await makeClient().vega.catalogHealthStatus("c-1,c-2");
    const url = new URL(mock.calls[0].url);
    assert.equal(url.pathname, "/api/vega-backend/v1/catalogs/c-1,c-2/health-status");
  } finally {
    mock.restore();
  }
});

// ── resource preview: endpoint does not exist on backend ───────────────────

test("createVegaCatalog sends POST to /catalogs with JSON body", async () => {
  const mock = mockFetch({ id: "new-cat-1" }, 201);
  try {
    const client = makeClient();
    await client.vega.createCatalog({
      name: "test-cat",
      connector_type: "mysql",
      connector_config: { host: "localhost" },
    });
    assert.equal(mock.calls[0].method, "POST");
    const url = new URL(mock.calls[0].url);
    assert.equal(url.pathname, "/api/vega-backend/v1/catalogs");
    const body = JSON.parse(mock.calls[0].body!);
    assert.equal(body.name, "test-cat");
    assert.equal(body.connector_type, "mysql");
  } finally {
    mock.restore();
  }
});

test("updateVegaCatalog sends PUT to /catalogs/:id", async () => {
  const mock = mockFetch("{}", 200);
  try {
    const client = makeClient();
    await client.vega.updateCatalog("cat-1", JSON.stringify({ name: "updated" }));
    assert.equal(mock.calls[0].method, "PUT");
    const url = new URL(mock.calls[0].url);
    assert.equal(url.pathname, "/api/vega-backend/v1/catalogs/cat-1");
  } finally {
    mock.restore();
  }
});

test("deleteVegaCatalogs sends DELETE to /catalogs/:ids", async () => {
  const mock = mockFetch("{}", 200);
  try {
    const client = makeClient();
    await client.vega.deleteCatalogs("cat-1,cat-2");
    assert.equal(mock.calls[0].method, "DELETE");
    const url = new URL(mock.calls[0].url);
    assert.equal(url.pathname, "/api/vega-backend/v1/catalogs/cat-1,cat-2");
  } finally {
    mock.restore();
  }
});

test("createVegaResource sends POST to /resources with JSON body", async () => {
  const mock = mockFetch({ id: "new-res-1" }, 201);
  try {
    const client = makeClient();
    await client.vega.createResource(JSON.stringify({
      catalog_id: "cat-1",
      name: "test-res",
      category: "table",
    }));
    assert.equal(mock.calls[0].method, "POST");
    const url = new URL(mock.calls[0].url);
    assert.equal(url.pathname, "/api/vega-backend/v1/resources");
  } finally {
    mock.restore();
  }
});

test("updateVegaResource sends PUT to /resources/:id", async () => {
  const mock = mockFetch("{}", 200);
  try {
    const client = makeClient();
    await client.vega.updateResource("res-1", JSON.stringify({ name: "updated" }));
    assert.equal(mock.calls[0].method, "PUT");
    const url = new URL(mock.calls[0].url);
    assert.equal(url.pathname, "/api/vega-backend/v1/resources/res-1");
  } finally {
    mock.restore();
  }
});

test("deleteVegaResources sends DELETE to /resources/:ids", async () => {
  const mock = mockFetch("{}", 200);
  try {
    const client = makeClient();
    await client.vega.deleteResources("res-1,res-2");
    assert.equal(mock.calls[0].method, "DELETE");
    const url = new URL(mock.calls[0].url);
    assert.equal(url.pathname, "/api/vega-backend/v1/resources/res-1,res-2");
  } finally {
    mock.restore();
  }
});

test("listAllResources uses GET /resources (not /resources/list — avoids id=list routing)", async () => {
  const mock = mockFetch({ entries: [{ id: "r1" }] });
  try {
    const client = makeClient();
    await client.vega.listAllResources({ limit: 30, offset: 0 });
    assert.equal(mock.calls[0].method, "GET");
    const url = new URL(mock.calls[0].url);
    assert.equal(url.pathname, "/api/vega-backend/v1/resources");
    assert.equal(url.searchParams.get("limit"), "30");
    assert.equal(url.searchParams.get("offset"), "0");
  } finally {
    mock.restore();
  }
});

test("registerVegaConnectorType sends POST to /connector-types", async () => {
  const mock = mockFetch({ type: "my-type" }, 201);
  try {
    const client = makeClient();
    await client.vega.registerConnectorType(JSON.stringify({ type: "my-type", name: "My Type", mode: "pull", category: "database" }));
    assert.equal(mock.calls[0].method, "POST");
    const url = new URL(mock.calls[0].url);
    assert.equal(url.pathname, "/api/vega-backend/v1/connector-types");
  } finally {
    mock.restore();
  }
});

test("updateVegaConnectorType sends PUT to /connector-types/:type", async () => {
  const mock = mockFetch("{}", 200);
  try {
    const client = makeClient();
    await client.vega.updateConnectorType("my-type", JSON.stringify({ name: "Updated" }));
    assert.equal(mock.calls[0].method, "PUT");
    const url = new URL(mock.calls[0].url);
    assert.equal(url.pathname, "/api/vega-backend/v1/connector-types/my-type");
  } finally {
    mock.restore();
  }
});

test("deleteVegaConnectorType sends DELETE to /connector-types/:type", async () => {
  const mock = mockFetch("{}", 200);
  try {
    const client = makeClient();
    await client.vega.deleteConnectorType("my-type");
    assert.equal(mock.calls[0].method, "DELETE");
    const url = new URL(mock.calls[0].url);
    assert.equal(url.pathname, "/api/vega-backend/v1/connector-types/my-type");
  } finally {
    mock.restore();
  }
});

test("setVegaConnectorTypeEnabled sends POST to /connector-types/:type/enabled", async () => {
  const mock = mockFetch("{}", 200);
  try {
    const client = makeClient();
    await client.vega.setConnectorTypeEnabled("my-type", true);
    assert.equal(mock.calls[0].method, "POST");
    const url = new URL(mock.calls[0].url);
    assert.equal(url.pathname, "/api/vega-backend/v1/connector-types/my-type/enabled");
    const body = JSON.parse(mock.calls[0].body!);
    assert.equal(body.enabled, true);
  } finally {
    mock.restore();
  }
});

test("sqlQuery sends POST to /resources/query with JSON body", async () => {
  const mock = mockFetch({ columns: [{ name: "x", type: "int" }], entries: [{ x: 1 }], total_count: 1 });
  try {
    const client = makeClient();
    const result = await client.vega.sqlQuery(
      JSON.stringify({ query: "SELECT 1 AS x", resource_type: "mysql" }),
    );
    assert.equal(mock.calls[0].method, "POST");
    const url = new URL(mock.calls[0].url);
    assert.equal(url.pathname, "/api/vega-backend/v1/resources/query");
    const body = JSON.parse(mock.calls[0].body!);
    assert.equal(body.query, "SELECT 1 AS x");
    assert.equal(body.resource_type, "mysql");
    assert.deepEqual((result as Record<string, unknown>).entries, [{ x: 1 }]);
  } finally {
    mock.restore();
  }
});

test("vega resource has no previewResource method (backend has no preview endpoint)", () => {
  const client = makeClient();
  assert.equal(
    typeof (client.vega as Record<string, unknown>).previewResource,
    "undefined",
    "previewResource should not exist — backend has no /resources/{id}/preview endpoint",
  );
});

// ── vega sql CLI: flag mode vs -d ───────────────────────────────────────────

function createVegaCliConfigDir(): string {
  return mkdtempSync(join(tmpdir(), "kweaver-vega-sql-cli-"));
}

async function importStoreForVegaCli(configDir: string) {
  process.env.KWEAVERC_CONFIG_DIR = configDir;
  const moduleUrl = pathToFileURL(join(process.cwd(), "src/config/store.ts")).href;
  return import(`${moduleUrl}?t=${Date.now()}-${Math.random()}`);
}

async function setupVegaCliToken(configDir: string, baseUrl = "https://mock.kweaver.test"): Promise<void> {
  const store = await importStoreForVegaCli(configDir);
  store.saveTokenConfig({
    baseUrl,
    accessToken: "token-abc",
    tokenType: "Bearer",
    scope: "openid offline all",
    obtainedAt: new Date().toISOString(),
  });
  store.setCurrentPlatform(baseUrl);
}

async function runVegaSqlCli(
  configDir: string,
  sqlArgs: string[],
): Promise<{ code: number; stdout: string; stderr: string }> {
  process.env.KWEAVERC_CONFIG_DIR = configDir;
  const stdout: string[] = [];
  const stderr: string[] = [];
  const origLog = console.log;
  const origErr = console.error;
  console.log = (...values: unknown[]) => stdout.push(values.map(String).join(" "));
  console.error = (...values: unknown[]) => stderr.push(values.map(String).join(" "));
  try {
    const code = await runVegaCommand(["sql", ...sqlArgs]);
    return { code, stdout: stdout.join("\n"), stderr: stderr.join("\n") };
  } finally {
    console.log = origLog;
    console.error = origErr;
  }
}

test("vega sql flag mode posts query and resource_type JSON", async () => {
  const configDir = createVegaCliConfigDir();
  await setupVegaCliToken(configDir);
  const mock = mockFetch({ columns: [{ name: "x" }], entries: [{ x: 1 }], total_count: 1 });
  try {
    const r = await runVegaSqlCli(configDir, [
      "--resource-type",
      "mysql",
      "--query",
      "SELECT 1 AS x",
    ]);
    assert.equal(r.code, 0);
    assert.equal(mock.calls[0].method, "POST");
    const url = new URL(mock.calls[0].url);
    assert.equal(url.pathname, "/api/vega-backend/v1/resources/query");
    const body = JSON.parse(mock.calls[0].body!);
    assert.equal(body.query, "SELECT 1 AS x");
    assert.equal(body.resource_type, "mysql");
  } finally {
    mock.restore();
  }
});

test("vega sql rejects --type with guidance", async () => {
  const configDir = createVegaCliConfigDir();
  await setupVegaCliToken(configDir);
  const mock = mockFetch({});
  try {
    const r = await runVegaSqlCli(configDir, ["--type", "mysql", "--query", "SELECT 1"]);
    assert.equal(r.code, 1);
    assert.match(r.stderr, /--resource-type/);
    assert.equal(mock.calls.length, 0);
  } finally {
    mock.restore();
  }
});

test("vega sql flag mode requires both --query and --resource-type", async () => {
  const configDir = createVegaCliConfigDir();
  await setupVegaCliToken(configDir);
  const mock = mockFetch({});
  try {
    const r = await runVegaSqlCli(configDir, ["--resource-type", "mysql"]);
    assert.equal(r.code, 1);
    assert.match(r.stderr, /Usage:/);
    assert.equal(mock.calls.length, 0);
  } finally {
    mock.restore();
  }
});

test("vega sql flag mode passes arbitrary --resource-type to backend", async () => {
  const configDir = createVegaCliConfigDir();
  await setupVegaCliToken(configDir);
  const mock = mockFetch({ ok: true });
  try {
    const r = await runVegaSqlCli(configDir, ["--resource-type", "oracle", "--query", "SELECT 1"]);
    assert.equal(r.code, 0);
    const body = JSON.parse(mock.calls[0].body!);
    assert.equal(body.resource_type, "oracle");
  } finally {
    mock.restore();
  }
});

test("vega sql -d mode ignores --query and --resource-type (precedence)", async () => {
  const configDir = createVegaCliConfigDir();
  await setupVegaCliToken(configDir);
  const mock = mockFetch({ ok: true });
  try {
    const r = await runVegaSqlCli(configDir, [
      "-d",
      JSON.stringify({ query: "SELECT 1", resource_type: "mysql" }),
      "--resource-type",
      "postgresql",
      "--query",
      "SELECT 2",
    ]);
    assert.equal(r.code, 0);
    const body = JSON.parse(mock.calls[0].body!);
    assert.equal(body.query, "SELECT 1");
    assert.equal(body.resource_type, "mysql");
  } finally {
    mock.restore();
  }
});
