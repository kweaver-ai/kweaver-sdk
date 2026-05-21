import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import { runAgentCommand } from "../src/commands/agent.js";

const originalFetch = globalThis.fetch;

function createConfigDir(): string {
  return mkdtempSync(join(tmpdir(), "kweaver-agent-update-"));
}

async function importStoreModule(configDir: string) {
  process.env.KWEAVERC_CONFIG_DIR = configDir;
  const moduleUrl = pathToFileURL(join(process.cwd(), "src/config/store.ts")).href;
  return import(`${moduleUrl}?t=${Date.now()}-${Math.random()}`);
}

async function primeToken() {
  const configDir = createConfigDir();
  process.env.KWEAVERC_CONFIG_DIR = configDir;
  const store = await importStoreModule(configDir);
  store.saveTokenConfig({
    baseUrl: "https://dip.aishu.cn",
    accessToken: "token-test",
    tokenType: "bearer",
    scope: "openid",
    obtainedAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 3600_000).toISOString(),
  });
  store.setCurrentPlatform("https://dip.aishu.cn");
}

async function captureConsole(run: () => Promise<number>): Promise<{ code: number; stdout: string; stderr: string }> {
  const stdout: string[] = [];
  const stderr: string[] = [];
  const originalLog = console.log;
  const originalError = console.error;
  console.log = (...args: unknown[]) => { stdout.push(args.map(String).join(" ")); };
  console.error = (...args: unknown[]) => { stderr.push(args.map(String).join(" ")); };
  try {
    const code = await run();
    return { code, stdout: stdout.join("\n"), stderr: stderr.join("\n") };
  } finally {
    console.log = originalLog;
    console.error = originalError;
  }
}

test("agent update --knowledge-network-id writes only the knowledge network id", { concurrency: false }, async () => {
  await primeToken();
  const putBodies: string[] = [];
  globalThis.fetch = async (urlInput: string | URL | Request, init?: RequestInit) => {
    const url = typeof urlInput === "string" ? urlInput : urlInput instanceof URL ? urlInput.href : urlInput.url;
    const method = (init?.method ?? "GET").toUpperCase();
    if (url.endsWith("/api/agent-factory/v3/agent/ag_kn") && method === "GET") {
      return new Response(JSON.stringify({
        id: "ag_kn",
        name: "Agent",
        profile: "Profile",
        avatar_type: 1,
        avatar: "1",
        product_key: "dip",
        config: {
          input: { fields: [{ name: "query", type: "string" }] },
          output: { default_format: "markdown" },
          data_source: { doc: [{ doc_id: "doc_1" }] },
        },
      }), { status: 200 });
    }
    if (url.endsWith("/api/agent-factory/v3/agent/ag_kn") && method === "PUT") {
      putBodies.push(String(init?.body ?? ""));
      return new Response(null, { status: 204 });
    }
    throw new Error(`unexpected fetch ${method} ${url}`);
  };

  try {
    const { code } = await captureConsole(() => runAgentCommand(["update", "ag_kn", "--knowledge-network-id", "kn_x"]));
    assert.equal(code, 0);
    assert.equal(putBodies.length, 1);
    const body = JSON.parse(putBodies[0]!) as { config: { data_source?: Record<string, unknown> } };
    const dataSource = body.config.data_source ?? {};
    assert.deepEqual(dataSource.knowledge_network, [{ knowledge_network_id: "kn_x" }]);
    assert.deepEqual(dataSource.doc, [{ doc_id: "doc_1" }]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
