import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import { runAgentCommand } from "../src/commands/agent.js";

const originalFetch = globalThis.fetch;

function createConfigDir(): string {
  return mkdtempSync(join(tmpdir(), "kweaver-agent-members-"));
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

test("agent help lists skill subcommand", async () => {
  const lines: string[] = [];
  const originalLog = console.log;
  console.log = (...args: unknown[]) => { lines.push(args.map(String).join(" ")); };
  try {
    await runAgentCommand([]);
    assert.ok(lines.join("\n").includes("skill"), "help should mention skill");
  } finally {
    console.log = originalLog;
  }
});

test("agent skill help lists add/remove/list", async () => {
  const lines: string[] = [];
  const originalLog = console.log;
  console.log = (...args: unknown[]) => { lines.push(args.map(String).join(" ")); };
  try {
    await runAgentCommand(["skill", "--help"]);
    const help = lines.join("\n");
    assert.ok(help.includes("add"), "help should list add");
    assert.ok(help.includes("remove"), "help should list remove");
    assert.ok(help.includes("list"), "help should list list");
  } finally {
    console.log = originalLog;
  }
});

test("agent skill rejects unknown subverb", { concurrency: false }, async () => {
  await primeToken();
  const errors: string[] = [];
  const originalErr = console.error;
  const originalStderr = process.stderr.write.bind(process.stderr);
  console.error = (...args: unknown[]) => { errors.push(args.map(String).join(" ")); };
  (process.stderr as any).write = (chunk: any) => { errors.push(String(chunk)); return true; };
  try {
    const code = await runAgentCommand(["skill", "foobar", "ag_1"]);
    assert.equal(code, 1);
    assert.ok(errors.join("\n").toLowerCase().includes("unknown"), `expected 'unknown' in stderr, got: ${errors.join("\n")}`);
  } finally {
    console.error = originalErr;
    (process.stderr as any).write = originalStderr;
  }
});

test("agent skill add — rejects missing id", { concurrency: false }, async () => {
  await primeToken();

  globalThis.fetch = async (urlInput: string | URL | Request) => {
    const urlStr = typeof urlInput === "string" ? urlInput : urlInput instanceof URL ? urlInput.href : urlInput.url;
    if (urlStr.includes("/skills/sk_missing")) {
      return new Response("not found", { status: 404 });
    }
    if (urlStr.includes("/agent-factory/v3/agent/")) {
      throw new Error("agent get called despite missing skill id");
    }
    return new Response("{}", { status: 200 });
  };

  const errors: string[] = [];
  const originalErr = console.error;
  const originalStderr = process.stderr.write.bind(process.stderr);
  console.error = (...args: unknown[]) => { errors.push(args.map(String).join(" ")); };
  (process.stderr as any).write = (chunk: any) => { errors.push(String(chunk)); return true; };
  try {
    const code = await runAgentCommand(["skill", "add", "ag_1", "sk_missing"]);
    assert.equal(code, 1);
    assert.match(errors.join("\n"), /sk_missing/);
  } finally {
    console.error = originalErr;
    (process.stderr as any).write = originalStderr;
    globalThis.fetch = originalFetch;
  }
});

test("agent skill add — happy path writes and reports", { concurrency: false }, async () => {
  await primeToken();

  const updateBodies: string[] = [];
  globalThis.fetch = async (urlInput: string | URL | Request, init?: RequestInit) => {
    const urlStr = typeof urlInput === "string" ? urlInput : urlInput instanceof URL ? urlInput.href : urlInput.url;
    const method = (init?.method ?? "GET").toUpperCase();

    if (urlStr.includes("/skills/sk_a") && method === "GET") {
      return new Response(JSON.stringify({ data: { id: "sk_a", name: "alpha", status: "published" } }), {
        status: 200, headers: { "content-type": "application/json" },
      });
    }
    if (urlStr.includes("/agent-factory/v3/agent/ag_1") && method === "GET") {
      return new Response(JSON.stringify({ id: "ag_1", name: "A", profile: "P", config: {} }), {
        status: 200, headers: { "content-type": "application/json" },
      });
    }
    if (urlStr.includes("/agent-factory/v3/agent/ag_1") && method === "PUT") {
      updateBodies.push(String(init?.body ?? ""));
      return new Response("ok", { status: 200 });
    }
    throw new Error(`unexpected fetch ${method} ${urlStr}`);
  };

  const logs: string[] = [];
  const originalLog = console.log;
  console.log = (...args: unknown[]) => { logs.push(args.map(String).join(" ")); };
  try {
    const code = await runAgentCommand(["skill", "add", "ag_1", "sk_a"]);
    assert.equal(code, 0);
    assert.equal(updateBodies.length, 1);
    const body = JSON.parse(updateBodies[0]!) as { config: { skills: { skills: { skill_id: string }[] } } };
    assert.deepEqual(body.config.skills.skills, [{ skill_id: "sk_a" }]);
    assert.ok(logs.join("\n").includes("sk_a"));
  } finally {
    console.log = originalLog;
    globalThis.fetch = originalFetch;
  }
});
