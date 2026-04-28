import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { buildContinueCommand, parseChatArgs } from "../src/commands/agent-chat.js";
import {
  buildAgentInfoUrl,
  buildChatUrl,
  extractText,
  fetchAgentInfo,
  sendChatRequest,
  sendChatRequestStream,
} from "../src/api/agent-chat.js";

const originalFetch = globalThis.fetch;
const originalStdoutWrite = process.stdout.write.bind(process.stdout);

let savedConfigDir: string | undefined;
before(() => {
  savedConfigDir = process.env.KWEAVERC_CONFIG_DIR;
  process.env.KWEAVERC_CONFIG_DIR = mkdtempSync(join(tmpdir(), "kweaver-agent-chat-test-"));
});
after(() => {
  if (savedConfigDir !== undefined) {
    process.env.KWEAVERC_CONFIG_DIR = savedConfigDir;
  } else {
    delete process.env.KWEAVERC_CONFIG_DIR;
  }
});

test("parseChatArgs requires agent_id", () => {
  assert.throws(
    () => parseChatArgs([]),
    /Missing agent_id/
  );
  assert.throws(
    () => parseChatArgs(["-m", "hello"]),
    /Missing agent_id/
  );
});

test("parseChatArgs extracts agent_id as first positional", () => {
  const args = parseChatArgs(["01KFT0E68A1RES94ZV6DA131X4"]);
  assert.equal(args.agentId, "01KFT0E68A1RES94ZV6DA131X4");
  assert.equal(args.version, "v0");
  assert.equal(args.message, undefined);
  assert.equal(args.verbose, false);
  assert.equal(args.businessDomain, "bd_public");
});

test("parseChatArgs -m sets message for non-interactive mode", () => {
  const args = parseChatArgs(["agent-123", "-m", "hello world"]);
  assert.equal(args.agentId, "agent-123");
  assert.equal(args.version, "v0");
  assert.equal(args.message, "hello world");
});

test("parseChatArgs supports explicit version", () => {
  const args = parseChatArgs(["agent-123", "--version", "v2"]);
  assert.equal(args.version, "v2");
});

test("parseChatArgs --conversation-id and --session-id are equivalent", () => {
  const a = parseChatArgs(["agent-123", "--conversation-id", "conv_abc"]);
  const b = parseChatArgs(["agent-123", "--session-id", "conv_abc"]);
  assert.equal(a.conversationId, "conv_abc");
  assert.equal(b.conversationId, "conv_abc");
});

test("parseChatArgs accepts reference-style -conversation_id alias", () => {
  const args = parseChatArgs(["agent-123", "-conversation_id", "conv_abc"]);
  assert.equal(args.conversationId, "conv_abc");
});

test("parseChatArgs accepts -cid alias", () => {
  const args = parseChatArgs(["agent-123", "-cid", "conv_short"]);
  assert.equal(args.conversationId, "conv_short");
});

test("parseChatArgs --stream and --no-stream set stream flag", () => {
  const withStream = parseChatArgs(["agent-123", "--stream"]);
  const noStream = parseChatArgs(["agent-123", "--no-stream"]);
  assert.equal(withStream.stream, true);
  assert.equal(noStream.stream, false);
});

test("parseChatArgs --verbose sets verbose", () => {
  const args = parseChatArgs(["agent-123", "--verbose"]);
  assert.equal(args.verbose, true);
  assert.equal(args.businessDomain, "bd_public");
});

test("parseChatArgs -bd overrides business domain", () => {
  const args = parseChatArgs(["agent-123", "-bd", "bd_enterprise"]);
  assert.equal(args.businessDomain, "bd_enterprise");
});

test("parseChatArgs parses combined flags", () => {
  const args = parseChatArgs([
    "agent-xyz",
    "-m",
    "query text",
    "--conversation-id",
    "conv_123",
    "--no-stream",
    "--verbose",
  ]);
  assert.equal(args.agentId, "agent-xyz");
  assert.equal(args.message, "query text");
  assert.equal(args.conversationId, "conv_123");
  assert.equal(args.stream, false);
  assert.equal(args.verbose, true);
  assert.equal(args.businessDomain, "bd_public");
});

test("parseChatArgs rejects missing flag values", () => {
  assert.throws(() => parseChatArgs(["agent-123", "-m"]), /Missing value for message flag/);
  assert.throws(
    () => parseChatArgs(["agent-123", "--conversation-id"]),
    /Missing value for conversation-id flag/
  );
});

test("buildContinueCommand preserves original flags and adds conversation id", () => {
  const command = buildContinueCommand(
    ["agent-123", "-m", "hello world", "--no-stream", "-bd", "bd_enterprise"],
    "conv_123"
  );

  assert.equal(
    command,
    'kweaver agent chat agent-123 -m "{你的下一轮问题}" --no-stream -bd bd_enterprise -cid conv_123'
  );
});

test("buildContinueCommand replaces an existing conversation flag", () => {
  const command = buildContinueCommand(
    ["agent-123", "-m", "hello", "--conversation-id", "old_conv", "--verbose"],
    "new_conv"
  );

  assert.equal(
    command,
    'kweaver agent chat agent-123 -m "{你的下一轮问题}" --verbose -cid new_conv'
  );
});

test("buildChatUrl constructs correct endpoint", () => {
  const url = buildChatUrl("https://dip.aishu.cn", "01KFT0E68A1RES94ZV6DA131X4");
  assert.equal(
    url,
    "https://dip.aishu.cn/api/agent-factory/v1/app/01KFT0E68A1RES94ZV6DA131X4/chat/completion"
  );
});

test("buildChatUrl strips trailing slashes from baseUrl", () => {
  const url = buildChatUrl("https://dip.aishu.cn/", "agent-id");
  assert.equal(url, "https://dip.aishu.cn/api/agent-factory/v1/app/agent-id/chat/completion");
});

test("buildAgentInfoUrl constructs correct endpoint", () => {
  const url = buildAgentInfoUrl("https://dip.aishu.cn", "agent-id", "v2");
  assert.equal(
    url,
    "https://dip.aishu.cn/api/agent-factory/v3/agent-market/agent/agent-id/version/v2?is_visit=true"
  );
});

test("extractText prefers final_answer.answer.text", () => {
  const data = {
    final_answer: {
      answer: { text: "Final answer text" },
    },
  };
  assert.equal(extractText(data), "Final answer text");
});

test("extractText falls back to message.content.text", () => {
  const data = {
    message: {
      content: { text: "Message text" },
    },
  };
  assert.equal(extractText(data), "Message text");
});

test("extractText reads message.content.final_answer.answer.text", () => {
  const data = {
    message: {
      content: {
        final_answer: {
          answer: { text: "Nested final answer text" },
        },
      },
    },
  };
  assert.equal(extractText(data), "Nested final answer text");
});

test("extractText returns empty for empty or invalid input", () => {
  assert.equal(extractText(null), "");
  assert.equal(extractText(undefined), "");
  assert.equal(extractText({}), "");
});

test("sendChatRequest returns text and conversation_id from JSON response", { concurrency: false }, async () => {
  globalThis.fetch = async (_url: string | URL | Request, init?: RequestInit) => {
    const body = init?.body ? JSON.parse(init.body as string) : {};
    const headers = new Headers(init?.headers);
    assert.equal(body.agent_id, "agent-xyz");
    assert.equal(body.agent_key, "agent-key-xyz");
    assert.equal(body.agent_version, "v2");
    assert.equal(body.query, "hello");
    assert.equal(body.stream, false);
    assert.equal(headers.get("x-business-domain"), "bd_public");
    return new Response(
      JSON.stringify({
        conversation_id: "conv_123",
        final_answer: { answer: { text: "Hello back!" } },
      }),
      { headers: { "content-type": "application/json" } }
    );
  };
  try {
    const result = await sendChatRequest({
      baseUrl: "https://dip.aishu.cn",
      accessToken: "token-abc",
      agentId: "agent-xyz",
      agentKey: "agent-key-xyz",
      agentVersion: "v2",
      query: "hello",
      stream: false,
    });
    assert.equal(result.text, "Hello back!");
    assert.equal(result.conversationId, "conv_123");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("sendChatRequest normalizes escaped quotes in JSON responses", { concurrency: false }, async () => {
  globalThis.fetch = async () =>
    new Response(
      JSON.stringify({
        conversation_id: "conv_quotes",
        final_answer: { answer: { text: "品牌家族：多个&amp;quot;恬露&amp;quot;系列品牌" } },
      }),
      { headers: { "content-type": "application/json" } }
    );

  try {
    const result = await sendChatRequest({
      baseUrl: "https://dip.aishu.cn",
      accessToken: "token-abc",
      agentId: "agent-xyz",
      agentKey: "agent-key-xyz",
      agentVersion: "v2",
      query: "hello",
      stream: false,
    });
    assert.equal(result.text, '品牌家族：多个"恬露"系列品牌');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("sendChatRequest includes conversation_id in body when provided", { concurrency: false }, async () => {
  globalThis.fetch = async (_url: string | URL | Request, init?: RequestInit) => {
    const body = JSON.parse((init?.body as string) ?? "{}");
    assert.equal(body.conversation_id, "conv_existing");
    assert.equal(body.agent_key, "agent-key-xyz");
    return new Response(
      JSON.stringify({
        conversation_id: "conv_existing",
        final_answer: { answer: { text: "Continued." } },
      }),
      { headers: { "content-type": "application/json" } }
    );
  };
  try {
    const result = await sendChatRequest({
      baseUrl: "https://dip.aishu.cn",
      accessToken: "token-abc",
      agentId: "agent-xyz",
      agentKey: "agent-key-xyz",
      agentVersion: "v2",
      query: "continue",
      conversationId: "conv_existing",
      stream: false,
    });
    assert.equal(result.text, "Continued.");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("sendChatRequest throws on HTTP error", { concurrency: false }, async () => {
  globalThis.fetch = async () =>
    new Response("Unauthorized", { status: 401, statusText: "Unauthorized" });
  try {
    await assert.rejects(
      async () =>
        sendChatRequest({
          baseUrl: "https://dip.aishu.cn",
          accessToken: "bad",
          agentId: "agent-xyz",
          agentKey: "agent-key-xyz",
          agentVersion: "v2",
          query: "hi",
          stream: false,
        }),
      /HTTP 401/
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("sendChatRequestStream invokes onTextDelta with full text and returns ChatResult", {
  concurrency: false,
}, async () => {
  const fullTexts: string[] = [];
  const encoder = new TextEncoder();
  const chunks = [
    'data: {"key":["conversation_id"],"content":"conv_tui","action":"upsert"}\n',
    'data: {"key":["message","text"],"content":"Hi","action":"append"}\n',
    'data: {"key":["message","text"],"content":" there","action":"append"}\n',
    'data: {"key":["message","text"],"content":"!","action":"append"}\n',
  ];

  globalThis.fetch = async () =>
    new Response(
      new ReadableStream({
        start(controller) {
          for (const chunk of chunks) {
            controller.enqueue(encoder.encode(chunk));
          }
          controller.close();
        },
      }),
      { headers: { "content-type": "text/event-stream" } }
    );

  try {
    const result = await sendChatRequestStream(
      {
        baseUrl: "https://dip.aishu.cn",
        accessToken: "token-abc",
        agentId: "agent-xyz",
        agentKey: "agent-key-xyz",
        agentVersion: "v2",
        query: "hello",
        stream: true,
      },
      {
        onTextDelta: (fullText) => fullTexts.push(fullText),
      }
    );

    assert.equal(result.conversationId, "conv_tui");
    assert.equal(result.text, "Hi there!");
    assert.deepEqual(fullTexts, ["Hi", "Hi there", "Hi there!"]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("sendChatRequestStream suppresses leading html comments and decodes quotes", {
  concurrency: false,
}, async () => {
  const fullTexts: string[] = [];
  const encoder = new TextEncoder();
  const chunks = [
    'data: {"key":["conversation_id"],"content":"conv_clean","action":"upsert"}\n',
    'data: {"key":["message","text"],"content":"&lt;!-- hidden","action":"append"}\n',
    'data: {"key":["message","text"],"content":" --&gt;品牌家族：多个&amp;quot;恬露&amp;quot;系列品牌","action":"append"}\n',
  ];

  globalThis.fetch = async () =>
    new Response(
      new ReadableStream({
        start(controller) {
          for (const chunk of chunks) {
            controller.enqueue(encoder.encode(chunk));
          }
          controller.close();
        },
      }),
      { headers: { "content-type": "text/event-stream" } }
    );

  try {
    const result = await sendChatRequestStream(
      {
        baseUrl: "https://dip.aishu.cn",
        accessToken: "token-abc",
        agentId: "agent-xyz",
        agentKey: "agent-key-xyz",
        agentVersion: "v2",
        query: "hello",
        stream: true,
      },
      {
        onTextDelta: (fullText) => fullTexts.push(fullText),
      }
    );

    assert.equal(result.conversationId, "conv_clean");
    assert.equal(result.text, '品牌家族：多个"恬露"系列品牌');
    assert.deepEqual(fullTexts, ['品牌家族：多个"恬露"系列品牌']);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("sendChatRequest handles streaming message.text chunks and malformed events", { concurrency: false }, async () => {
  const writes: string[] = [];
  process.stdout.write = ((chunk: string | Uint8Array) => {
    writes.push(typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8"));
    return true;
  }) as typeof process.stdout.write;

  const encoder = new TextEncoder();
  const chunks = [
    'data: {"key":["conversation_id"],"content":"conv_stream","action":"upsert"}\n',
    'data: {"key":["message","text"],"content":"Hel',
    'lo","action":"append"}\n',
    'data: {"key":["message","text"],"content":" wor',
    'ld","action":"append"}\n',
    'data: {"key":["message","text"],"content":"!","action":"append"}',
    "\n",
    "data: {bad json}\n",
    "data: [DONE]\n",
  ];

  globalThis.fetch = async () =>
    new Response(
      new ReadableStream({
        start(controller) {
          for (const chunk of chunks) {
            controller.enqueue(encoder.encode(chunk));
          }
          controller.close();
        },
      }),
      { headers: { "content-type": "text/event-stream" } }
    );

  try {
    const result = await sendChatRequest({
      baseUrl: "https://dip.aishu.cn",
      accessToken: "token-abc",
      agentId: "agent-xyz",
      agentKey: "agent-key-xyz",
      agentVersion: "v2",
      query: "hello",
      stream: true,
      verbose: true,
    });

    assert.equal(result.conversationId, "conv_stream");
    assert.equal(result.text, "Hello world!");
    assert.equal(writes.join(""), "Hello world!\n");
  } finally {
    globalThis.fetch = originalFetch;
    process.stdout.write = originalStdoutWrite as typeof process.stdout.write;
  }
});

test("sendChatRequest reports invalid JSON clearly", { concurrency: false }, async () => {
  globalThis.fetch = async () =>
    new Response("not-json", { headers: { "content-type": "application/json" } });

  try {
    await assert.rejects(
      () =>
        sendChatRequest({
          baseUrl: "https://dip.aishu.cn",
          accessToken: "token-abc",
          agentId: "agent-xyz",
          agentKey: "agent-key-xyz",
          agentVersion: "v2",
          query: "hello",
          stream: false,
        }),
      /Agent chat returned invalid JSON/
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("sendChatRequest uses custom business domain when provided", { concurrency: false }, async () => {
  globalThis.fetch = async (_url: string | URL | Request, init?: RequestInit) => {
    const headers = new Headers(init?.headers);
    assert.equal(headers.get("x-business-domain"), "bd_enterprise");
    return new Response(
      JSON.stringify({
        conversation_id: "conv_123",
        final_answer: { answer: { text: "Hello back!" } },
      }),
      { headers: { "content-type": "application/json" } }
    );
  };
  try {
    const result = await sendChatRequest({
      baseUrl: "https://dip.aishu.cn",
      accessToken: "token-abc",
      agentId: "agent-xyz",
      agentKey: "agent-key-xyz",
      agentVersion: "v2",
      query: "hello",
      stream: false,
      businessDomain: "bd_enterprise",
    });
    assert.equal(result.text, "Hello back!");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("fetchAgentInfo resolves id key and version", { concurrency: false }, async () => {
  globalThis.fetch = async (url: string | URL | Request, init?: RequestInit) => {
    assert.equal(
      String(url),
      "https://dip.aishu.cn/api/agent-factory/v3/agent-market/agent/agent-id/version/v0?is_visit=true"
    );
    const headers = new Headers(init?.headers);
    assert.equal(headers.get("x-business-domain"), "bd_public");
    assert.equal(headers.get("token"), "token-abc");
    return new Response(JSON.stringify({ id: "agent-id", key: "agent-key", version: "v0" }), {
      headers: { "content-type": "application/json" },
    });
  };

  try {
    const result = await fetchAgentInfo({
      baseUrl: "https://dip.aishu.cn",
      accessToken: "token-abc",
      agentId: "agent-id",
      version: "v0",
    });
    assert.equal(result.id, "agent-id");
    assert.equal(result.key, "agent-key");
    assert.equal(result.version, "v0");
  } finally {
    globalThis.fetch = originalFetch;
  }
});
