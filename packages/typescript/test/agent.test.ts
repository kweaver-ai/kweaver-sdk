import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import {
  parseAgentSessionsArgs,
  parseAgentHistoryArgs,
  runAgentCommand,
} from "../src/commands/agent.js";
import { listConversations, listMessages } from "../src/api/conversations.js";

const originalFetch = globalThis.fetch;

function createConfigDir(): string {
  return mkdtempSync(join(tmpdir(), "kweaver-agent-"));
}

async function importCliModule(configDir: string) {
  process.env.KWEAVERC_CONFIG_DIR = configDir;
  const moduleUrl = pathToFileURL(join(process.cwd(), "src/cli.ts")).href;
  return import(`${moduleUrl}?t=${Date.now()}-${Math.random()}`);
}

async function importStoreModule(configDir: string) {
  process.env.KWEAVERC_CONFIG_DIR = configDir;
  const moduleUrl = pathToFileURL(join(process.cwd(), "src/config/store.ts")).href;
  return import(`${moduleUrl}?t=${Date.now()}-${Math.random()}`);
}

test("parseAgentSessionsArgs throws on unknown flag", () => {
  assert.throws(() => parseAgentSessionsArgs(["agent-123", "--unknown"]), /Unsupported/);
});

test("parseAgentHistoryArgs throws on unknown flag", () => {
  assert.throws(() => parseAgentHistoryArgs(["conv-abc", "--unknown"]), /Unsupported/);
});

test("listConversations returns body on 200", { concurrency: false }, async () => {
  const payload = [{ id: "conv-1", agent_id: "agent-123" }];
  globalThis.fetch = async () =>
    new Response(JSON.stringify(payload), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  try {
    const result = await listConversations({
      baseUrl: "https://dip.aishu.cn",
      accessToken: "token-abc",
      agentKey: "agent-123",
    });
    assert.deepEqual(JSON.parse(result), payload);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("listConversations throws on 404", { concurrency: false }, async () => {
  globalThis.fetch = async () => new Response("Not Found", { status: 404 });
  try {
    await assert.rejects(
      () => listConversations({
        baseUrl: "https://dip.aishu.cn",
        accessToken: "token-abc",
        agentKey: "agent-123",
      }),
      (err: Error) => {
        assert.ok(err.message.includes("404"));
        return true;
      }
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("listMessages returns body on 200", { concurrency: false }, async () => {
  const payload = [{ id: "msg-1", role: "user", content: "hello" }];
  globalThis.fetch = async () =>
    new Response(JSON.stringify(payload), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  try {
    const result = await listMessages({
      baseUrl: "https://dip.aishu.cn",
      accessToken: "token-abc",
      agentKey: "agent-123",
      conversationId: "conv-abc",
    });
    assert.deepEqual(JSON.parse(result), payload);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("listMessages throws on 404", { concurrency: false }, async () => {
  globalThis.fetch = async () => new Response("Not Found", { status: 404 });
  try {
    await assert.rejects(
      () => listMessages({
        baseUrl: "https://dip.aishu.cn",
        accessToken: "token-abc",
        agentKey: "agent-123",
        conversationId: "conv-abc",
      }),
      (err: Error) => {
        assert.ok(err.message.includes("404"));
        return true;
      }
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("listConversations throws on non-404 error", { concurrency: false }, async () => {
  globalThis.fetch = async () => new Response("Internal Server Error", { status: 500, statusText: "Internal Server Error" });
  try {
    await assert.rejects(
      () => listConversations({
        baseUrl: "https://dip.aishu.cn",
        accessToken: "token-abc",
        agentKey: "agent-123",
      }),
      (err: Error) => {
        assert.ok(err.message.includes("500"));
        return true;
      }
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("listMessages throws on non-404 error", { concurrency: false }, async () => {
  globalThis.fetch = async () => new Response("Forbidden", { status: 403, statusText: "Forbidden" });
  try {
    await assert.rejects(
      () => listMessages({
        baseUrl: "https://dip.aishu.cn",
        accessToken: "token-abc",
        agentKey: "agent-123",
        conversationId: "conv-abc",
      }),
      (err: Error) => {
        assert.ok(err.message.includes("403"));
        return true;
      }
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("run agent sessions prints conversations for agent", { concurrency: false }, async () => {
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

  globalThis.fetch = async () =>
    new Response(JSON.stringify([{ id: "conv-1", agent_id: "agent-abc" }]), {
      status: 200,
      headers: { "content-type": "application/json" },
    });

  try {
    const code = await runAgentCommand(["sessions", "agent-abc"]);
    assert.equal(code, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("run agent history prints messages for conversation", { concurrency: false }, async () => {
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

  globalThis.fetch = async () =>
    new Response(JSON.stringify([{ id: "msg-1", role: "user", content: "hi" }]), {
      status: 200,
      headers: { "content-type": "application/json" },
    });

  try {
    const code = await runAgentCommand(["history", "conv-abc"]);
    assert.equal(code, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("run agent shows sessions and history in help text", async () => {
  const lines: string[] = [];
  const originalLog = console.log;
  console.log = (...args: unknown[]) => {
    lines.push(args.map(String).join(" "));
  };
  try {
    await runAgentCommand([]);
    const help = lines.join("\n");
    assert.ok(help.includes("sessions"), "help should list sessions subcommand");
    assert.ok(help.includes("history"), "help should list history subcommand");
    assert.ok(help.includes("trace"), "help should list trace subcommand");
  } finally {
    console.log = originalLog;
  }
});

test("run agent trace prints trace data for conversation", { concurrency: false }, async () => {
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

  globalThis.fetch = async () =>
    new Response(JSON.stringify({ traces: [{ span_id: "span-1" }] }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });

  try {
    const code = await runAgentCommand(["trace", "agent-abc", "conv-abc"]);
    assert.equal(code, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
