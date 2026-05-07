import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import { runAgentCommand } from "../src/commands/agent.js";
import { applyAgentModeToConfig } from "../src/commands/agent/mode.js";

const originalFetch = globalThis.fetch;

function createConfigDir(): string {
  return mkdtempSync(join(tmpdir(), "kweaver-agent-mode-"));
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

function baseConfig(extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    input: { fields: [{ name: "query", type: "string" }] },
    output: { default_format: "markdown" },
    ...extra,
  };
}

test("applyAgentModeToConfig fills default when mode is missing", () => {
  const config = baseConfig();
  applyAgentModeToConfig(config);
  assert.equal(config.mode, "default");
});

test("applyAgentModeToConfig preserves valid config mode without explicit mode", () => {
  const config = baseConfig({ mode: "dolphin" });
  applyAgentModeToConfig(config);
  assert.equal(config.mode, "dolphin");
});

test("applyAgentModeToConfig explicit mode overrides config mode", () => {
  const config = baseConfig({ mode: "default" });
  applyAgentModeToConfig(config, "react");
  assert.equal(config.mode, "react");
});

test("applyAgentModeToConfig rejects invalid config mode", () => {
  const config = baseConfig({ mode: "invalid" });
  assert.throws(() => applyAgentModeToConfig(config), /config\.mode must be one of/);
});

test("agent create fills default mode when config has no mode", { concurrency: false }, async () => {
  await primeToken();
  const bodies: string[] = [];
  globalThis.fetch = async (urlInput: string | URL | Request, init?: RequestInit) => {
    const url = typeof urlInput === "string" ? urlInput : urlInput instanceof URL ? urlInput.href : urlInput.url;
    assert.ok(url.endsWith("/api/agent-factory/v3/agent"));
    bodies.push(String(init?.body ?? ""));
    return new Response(JSON.stringify({ id: "agent-1", version: "unpublished" }), { status: 201 });
  };

  try {
    const { code } = await captureConsole(() => runAgentCommand([
      "create",
      "--name", "agent-one",
      "--profile", "agent one",
      "--config", JSON.stringify(baseConfig()),
    ]));

    assert.equal(code, 0);
    assert.equal(bodies.length, 1);
    const body = JSON.parse(bodies[0]!) as { config: { mode?: string } };
    assert.equal(body.config.mode, "default");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("agent create preserves valid config mode without explicit mode", { concurrency: false }, async () => {
  await primeToken();
  const bodies: string[] = [];
  globalThis.fetch = async (_urlInput: string | URL | Request, init?: RequestInit) => {
    bodies.push(String(init?.body ?? ""));
    return new Response(JSON.stringify({ id: "agent-2", version: "unpublished" }), { status: 201 });
  };

  try {
    const { code } = await captureConsole(() => runAgentCommand([
      "create",
      "--name", "agent-two",
      "--profile", "agent two",
      "--config", JSON.stringify(baseConfig({ mode: "dolphin" })),
    ]));

    assert.equal(code, 0);
    const body = JSON.parse(bodies[0]!) as { config: { mode?: string } };
    assert.equal(body.config.mode, "dolphin");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("agent create --mode overrides config mode and uses general create endpoint", { concurrency: false }, async () => {
  await primeToken();
  const calls: Array<{ url: string; body: string }> = [];
  globalThis.fetch = async (urlInput: string | URL | Request, init?: RequestInit) => {
    const url = typeof urlInput === "string" ? urlInput : urlInput instanceof URL ? urlInput.href : urlInput.url;
    calls.push({ url, body: String(init?.body ?? "") });
    return new Response(JSON.stringify({ id: "agent-3", version: "unpublished" }), { status: 201 });
  };

  try {
    const { code } = await captureConsole(() => runAgentCommand([
      "create",
      "--name", "agent-three",
      "--profile", "agent three",
      "--config", JSON.stringify(baseConfig({ mode: "default" })),
      "--mode", "react",
    ]));

    assert.equal(code, 0);
    assert.equal(calls.length, 1);
    assert.ok(calls[0]!.url.endsWith("/api/agent-factory/v3/agent"));
    const body = JSON.parse(calls[0]!.body) as { config: { mode?: string } };
    assert.equal(body.config.mode, "react");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("agent create rejects invalid config mode before fetch", { concurrency: false }, async () => {
  let fetchCalled = false;
  globalThis.fetch = async () => {
    fetchCalled = true;
    return new Response("{}", { status: 200 });
  };

  try {
    const { code, stderr } = await captureConsole(() => runAgentCommand([
      "create",
      "--name", "agent-bad",
      "--profile", "agent bad",
      "--config", JSON.stringify(baseConfig({ mode: "bad-mode" })),
    ]));

    assert.equal(code, 1);
    assert.match(stderr, /config\.mode must be one of/);
    assert.equal(fetchCalled, false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("agent update --mode writes mode to PUT body", { concurrency: false }, async () => {
  await primeToken();
  const putBodies: string[] = [];
  globalThis.fetch = async (urlInput: string | URL | Request, init?: RequestInit) => {
    const url = typeof urlInput === "string" ? urlInput : urlInput instanceof URL ? urlInput.href : urlInput.url;
    const method = (init?.method ?? "GET").toUpperCase();
    if (url.endsWith("/api/agent-factory/v3/agent/ag_1") && method === "GET") {
      return new Response(JSON.stringify({
        id: "ag_1",
        name: "Agent",
        profile: "Profile",
        avatar_type: 1,
        avatar: "1",
        product_key: "dip",
        config: baseConfig({ mode: "default" }),
      }), { status: 200 });
    }
    if (url.endsWith("/api/agent-factory/v3/agent/ag_1") && method === "PUT") {
      putBodies.push(String(init?.body ?? ""));
      return new Response(null, { status: 204 });
    }
    throw new Error(`unexpected fetch ${method} ${url}`);
  };

  try {
    const { code } = await captureConsole(() => runAgentCommand(["update", "ag_1", "--mode", "react"]));
    assert.equal(code, 0);
    assert.equal(putBodies.length, 1);
    const body = JSON.parse(putBodies[0]!) as { config: { mode?: string } };
    assert.equal(body.config.mode, "react");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("agent update preserves valid current mode without explicit mode", { concurrency: false }, async () => {
  await primeToken();
  const putBodies: string[] = [];
  globalThis.fetch = async (urlInput: string | URL | Request, init?: RequestInit) => {
    const url = typeof urlInput === "string" ? urlInput : urlInput instanceof URL ? urlInput.href : urlInput.url;
    const method = (init?.method ?? "GET").toUpperCase();
    if (method === "GET") {
      return new Response(JSON.stringify({
        id: "ag_2",
        name: "Agent",
        profile: "Profile",
        avatar_type: 1,
        avatar: "1",
        product_key: "dip",
        config: baseConfig({ mode: "dolphin" }),
      }), { status: 200 });
    }
    if (method === "PUT") {
      putBodies.push(String(init?.body ?? ""));
      return new Response(null, { status: 204 });
    }
    throw new Error(`unexpected fetch ${method} ${url}`);
  };

  try {
    const { code } = await captureConsole(() => runAgentCommand(["update", "ag_2", "--profile", "new profile"]));
    assert.equal(code, 0);
    const body = JSON.parse(putBodies[0]!) as { config: { mode?: string } };
    assert.equal(body.config.mode, "dolphin");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("agent update rejects invalid explicit mode before fetch", { concurrency: false }, async () => {
  let fetchCalled = false;
  globalThis.fetch = async () => {
    fetchCalled = true;
    return new Response("{}", { status: 200 });
  };

  try {
    const { code, stderr } = await captureConsole(() => runAgentCommand(["update", "ag_bad", "--mode", "bad-mode"]));
    assert.equal(code, 1);
    assert.match(stderr, /--mode must be one of/);
    assert.equal(fetchCalled, false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("agent update rejects invalid config-path mode before fetch", { concurrency: false }, async () => {
  const dir = createConfigDir();
  const configPath = join(dir, "agent-config.json");
  writeFileSync(configPath, JSON.stringify(baseConfig({ mode: "bad-mode" })), "utf-8");
  let fetchCalled = false;
  globalThis.fetch = async () => {
    fetchCalled = true;
    return new Response("{}", { status: 200 });
  };

  try {
    const { code, stderr } = await captureConsole(() => runAgentCommand(["update", "ag_bad", "--config-path", configPath]));
    assert.equal(code, 1);
    assert.match(stderr, /config\.mode must be one of/);
    assert.equal(fetchCalled, false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("agent create help documents mode and react_config", async () => {
  const { code, stdout } = await captureConsole(() => runAgentCommand(["create", "--help"]));
  assert.equal(code, 0);
  assert.match(stdout, /--mode <mode>/);
  assert.match(stdout, /default, dolphin, react/);
  assert.match(stdout, /react_config/);
  assert.match(stdout, /disable_history_in_a_conversation/);
});

test("agent update help documents mode", async () => {
  const { code, stdout } = await captureConsole(() => runAgentCommand(["update", "--help"]));
  assert.equal(code, 0);
  assert.match(stdout, /--mode <mode>/);
  assert.match(stdout, /default, dolphin, react/);
});
