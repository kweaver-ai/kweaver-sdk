import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import {
  parseAgentSessionsArgs,
  parseAgentHistoryArgs,
  parseAgentTraceArgs,
  runAgentCommand,
} from "../src/commands/agent.js";
import { listConversations, listMessages, getTracesByConversation } from "../src/api/conversations.js";

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

test("parseAgentTraceArgs parses agent_id and conversation_id", () => {
  const result = parseAgentTraceArgs(["agent-abc", "conv-123"]);
  assert.equal(result.agentId, "agent-abc");
  assert.equal(result.conversationId, "conv-123");
  assert.equal(result.pretty, true);
});

test("parseAgentTraceArgs supports --compact flag", () => {
  const result = parseAgentTraceArgs(["agent-abc", "conv-123", "--compact"]);
  assert.equal(result.conversationId, "conv-123");
  assert.equal(result.pretty, false);
});

test("parseAgentTraceArgs throws on missing agent_id", () => {
  assert.throws(() => parseAgentTraceArgs([]), /Missing agent_id/);
  assert.throws(() => parseAgentTraceArgs(["--compact"]), /Missing agent_id/);
});

test("parseAgentTraceArgs throws on missing conversation_id", () => {
  assert.throws(() => parseAgentTraceArgs(["agent-abc"]), /Missing conversation_id/);
  assert.throws(() => parseAgentTraceArgs(["agent-abc", "--compact"]), /Missing conversation_id/);
});

test("parseAgentTraceArgs throws on unknown flag", () => {
  assert.throws(() => parseAgentTraceArgs(["agent-abc", "conv-123", "--unknown"]), /Unsupported/);
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

test("getTracesByConversation returns body on 200", { concurrency: false }, async () => {
  const payload = { traces: [{ span_id: "span-1", name: "query" }] };
  globalThis.fetch = async (url: string | URL | Request) => {
    const reqUrl = typeof url === "string" ? url : url instanceof URL ? url.href : url.url;
    assert.ok(reqUrl.includes("/api/agent-factory/v1/observability/agent/agent-abc/conversation/conv-abc/session"), `URL should contain trace path: ${reqUrl}`);
    return new Response(JSON.stringify(payload), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };
  try {
    const result = await getTracesByConversation({
      baseUrl: "https://dip.aishu.cn",
      accessToken: "token-abc",
      agentId: "agent-abc",
      conversationId: "conv-abc",
    });
    assert.deepEqual(JSON.parse(result), payload);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("getTracesByConversation throws on error", { concurrency: false }, async () => {
  globalThis.fetch = async () => new Response("Not Found", { status: 404, statusText: "Not Found" });
  try {
    await assert.rejects(
      () => getTracesByConversation({
        baseUrl: "https://dip.aishu.cn",
        accessToken: "token-abc",
        agentId: "agent-abc",
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
