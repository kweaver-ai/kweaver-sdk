import test from "node:test";
import assert from "node:assert/strict";
import { runExecCommand } from "../src/commands/exec.js";

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

function mockAuth() {
  const origEnsureValidToken = process.env.KWEAVER_TOKEN;
  const origBaseUrl = process.env.KWEAVER_BASE_URL;

  process.env.KWEAVER_TOKEN = "test-token";
  process.env.KWEAVER_BASE_URL = "https://mock.kweaver.test";

  return {
    restore: () => {
      if (origEnsureValidToken === undefined) {
        delete process.env.KWEAVER_TOKEN;
      } else {
        process.env.KWEAVER_TOKEN = origEnsureValidToken;
      }
      if (origBaseUrl === undefined) {
        delete process.env.KWEAVER_BASE_URL;
      } else {
        process.env.KWEAVER_BASE_URL = origBaseUrl;
      }
    },
  };
}

// ── Help Tests ───────────────────────────────────────────────────────────────

test("runExecCommand --help shows all subcommands", async () => {
  const origConsoleLog = console.log;
  const logs: string[] = [];
  console.log = (msg: string) => { logs.push(msg); };

  try {
    const code = await runExecCommand(["--help"]);
    assert.equal(code, 0);
    assert.ok(logs[0].includes("operator"));
    assert.ok(logs[0].includes("toolbox"));
    assert.ok(logs[0].includes("mcp"));
    assert.ok(logs[0].includes("impex"));
  } finally {
    console.log = origConsoleLog;
  }
});

test("runExecCommand operator --help shows operator subcommands", async () => {
  const origConsoleLog = console.log;
  const logs: string[] = [];
  console.log = (msg: string) => { logs.push(msg); };

  try {
    const code = await runExecCommand(["operator", "--help"]);
    assert.equal(code, 0);
    assert.ok(logs[0].includes("list"));
    assert.ok(logs[0].includes("get"));
    assert.ok(logs[0].includes("register"));
    assert.ok(logs[0].includes("debug"));
  } finally {
    console.log = origConsoleLog;
  }
});

test("runExecCommand toolbox --help shows toolbox subcommands", async () => {
  const origConsoleLog = console.log;
  const logs: string[] = [];
  console.log = (msg: string) => { logs.push(msg); };

  try {
    const code = await runExecCommand(["toolbox", "--help"]);
    assert.equal(code, 0);
    assert.ok(logs[0].includes("list"));
    assert.ok(logs[0].includes("tool-list"));
    assert.ok(logs[0].includes("tool-create"));
  } finally {
    console.log = origConsoleLog;
  }
});

test("runExecCommand mcp --help shows mcp subcommands", async () => {
  const origConsoleLog = console.log;
  const logs: string[] = [];
  console.log = (msg: string) => { logs.push(msg); };

  try {
    const code = await runExecCommand(["mcp", "--help"]);
    assert.equal(code, 0);
    assert.ok(logs[0].includes("list"));
    assert.ok(logs[0].includes("parse-sse"));
    assert.ok(logs[0].includes("proxy-call"));
  } finally {
    console.log = origConsoleLog;
  }
});

test("runExecCommand impex --help shows impex subcommands", async () => {
  const origConsoleLog = console.log;
  const logs: string[] = [];
  console.log = (msg: string) => { logs.push(msg); };

  try {
    const code = await runExecCommand(["impex", "--help"]);
    assert.equal(code, 0);
    assert.ok(logs[0].includes("export"));
    assert.ok(logs[0].includes("import"));
  } finally {
    console.log = origConsoleLog;
  }
});

// ── Operator Command Tests ───────────────────────────────────────────────────

test("runExecCommand operator list calls API correctly", async () => {
  const auth = mockAuth();
  const mock = mockFetch({ data: [], total: 0 });
  const origConsoleLog = console.log;
  const logs: string[] = [];
  console.log = (msg: string) => { logs.push(msg); };

  try {
    const code = await runExecCommand(["operator", "list", "-bd", "bd_test"]);
    assert.equal(code, 0);
    assert.equal(mock.calls.length, 1);
    const url = new URL(mock.calls[0].url);
    assert.equal(url.pathname, "/api/agent-operator-integration/v1/operator/info/list");
  } finally {
    mock.restore();
    auth.restore();
    console.log = origConsoleLog;
  }
});

test("runExecCommand operator get calls API correctly", async () => {
  const auth = mockAuth();
  const mock = mockFetch({ operator_id: "op-1", version: "v1" });
  const origConsoleLog = console.log;
  const logs: string[] = [];
  console.log = (msg: string) => { logs.push(msg); };

  try {
    const code = await runExecCommand(["operator", "get", "op-1"]);
    assert.equal(code, 0);
    assert.equal(mock.calls.length, 1);
    const url = new URL(mock.calls[0].url);
    assert.equal(url.pathname, "/api/agent-operator-integration/v1/operator/op-1");
  } finally {
    mock.restore();
    auth.restore();
    console.log = origConsoleLog;
  }
});

test("runExecCommand operator get with version calls API correctly", async () => {
  const auth = mockAuth();
  const mock = mockFetch({ operator_id: "op-1", version: "v2" });
  const origConsoleLog = console.log;
  const logs: string[] = [];
  console.log = (msg: string) => { logs.push(msg); };

  try {
    const code = await runExecCommand(["operator", "get", "op-1", "v2"]);
    assert.equal(code, 0);
    assert.equal(mock.calls.length, 1);
    const url = new URL(mock.calls[0].url);
    assert.equal(url.pathname, "/api/agent-operator-integration/v1/operator/op-1");
    assert.equal(url.searchParams.get("version"), "v2");
  } finally {
    mock.restore();
    auth.restore();
    console.log = origConsoleLog;
  }
});

test("runExecCommand operator categories calls API correctly", async () => {
  const auth = mockAuth();
  const mock = mockFetch([{ category: "data_process", name: "Data Process" }]);
  const origConsoleLog = console.log;
  const logs: string[] = [];
  console.log = (msg: string) => { logs.push(msg); };

  try {
    const code = await runExecCommand(["operator", "categories"]);
    assert.equal(code, 0);
    assert.equal(mock.calls.length, 1);
    const url = new URL(mock.calls[0].url);
    assert.equal(url.pathname, "/api/agent-operator-integration/v1/operator/categories");
  } finally {
    mock.restore();
    auth.restore();
    console.log = origConsoleLog;
  }
});

test("runExecCommand operator market calls API correctly", async () => {
  const auth = mockAuth();
  const mock = mockFetch({ data: [], total: 0 });
  const origConsoleLog = console.log;
  const logs: string[] = [];
  console.log = (msg: string) => { logs.push(msg); };

  try {
    const code = await runExecCommand(["operator", "market"]);
    assert.equal(code, 0);
    assert.equal(mock.calls.length, 1);
    const url = new URL(mock.calls[0].url);
    assert.equal(url.pathname, "/api/agent-operator-integration/v1/operator/market");
  } finally {
    mock.restore();
    auth.restore();
    console.log = origConsoleLog;
  }
});

test("runExecCommand operator market-get calls API correctly", async () => {
  const auth = mockAuth();
  const mock = mockFetch({ operator_id: "op-1" });
  const origConsoleLog = console.log;
  const logs: string[] = [];
  console.log = (msg: string) => { logs.push(msg); };

  try {
    const code = await runExecCommand(["operator", "market-get", "op-1"]);
    assert.equal(code, 0);
    assert.equal(mock.calls.length, 1);
    const url = new URL(mock.calls[0].url);
    assert.equal(url.pathname, "/api/agent-operator-integration/v1/operator/market/op-1");
  } finally {
    mock.restore();
    auth.restore();
    console.log = origConsoleLog;
  }
});

test("runExecCommand operator history calls API correctly", async () => {
  const auth = mockAuth();
  const mock = mockFetch({ data: [], total: 0 });
  const origConsoleLog = console.log;
  const logs: string[] = [];
  console.log = (msg: string) => { logs.push(msg); };

  try {
    const code = await runExecCommand(["operator", "history", "op-1"]);
    assert.equal(code, 0);
    assert.equal(mock.calls.length, 1);
    const url = new URL(mock.calls[0].url);
    assert.equal(url.pathname, "/api/agent-operator-integration/v1/operator/op-1/history");
  } finally {
    mock.restore();
    auth.restore();
    console.log = origConsoleLog;
  }
});

// ── Toolbox Command Tests ─────────────────────────────────────────────────────

test("runExecCommand toolbox list calls API correctly", async () => {
  const auth = mockAuth();
  const mock = mockFetch({ data: [], total: 0 });
  const origConsoleLog = console.log;
  const logs: string[] = [];
  console.log = (msg: string) => { logs.push(msg); };

  try {
    const code = await runExecCommand(["toolbox", "list"]);
    assert.equal(code, 0);
    assert.equal(mock.calls.length, 1);
    const url = new URL(mock.calls[0].url);
    assert.equal(url.pathname, "/api/agent-operator-integration/v1/tool-box/list");
  } finally {
    mock.restore();
    auth.restore();
    console.log = origConsoleLog;
  }
});

test("runExecCommand toolbox get calls API correctly", async () => {
  const auth = mockAuth();
  const mock = mockFetch({ box_id: "box-1" });
  const origConsoleLog = console.log;
  const logs: string[] = [];
  console.log = (msg: string) => { logs.push(msg); };

  try {
    const code = await runExecCommand(["toolbox", "get", "box-1"]);
    assert.equal(code, 0);
    assert.equal(mock.calls.length, 1);
    const url = new URL(mock.calls[0].url);
    assert.equal(url.pathname, "/api/agent-operator-integration/v1/tool-box/box-1");
  } finally {
    mock.restore();
    auth.restore();
    console.log = origConsoleLog;
  }
});

test("runExecCommand toolbox delete calls API correctly", async () => {
  const auth = mockAuth();
  const mock = mockFetch({ box_id: "box-1" });
  const origConsoleLog = console.log;
  const logs: string[] = [];
  console.log = (msg: string) => { logs.push(msg); };

  try {
    const code = await runExecCommand(["toolbox", "delete", "box-1"]);
    assert.equal(code, 0);
    assert.equal(mock.calls.length, 1);
    const url = new URL(mock.calls[0].url);
    assert.equal(url.pathname, "/api/agent-operator-integration/v1/tool-box/box-1");
    assert.equal(mock.calls[0].method, "DELETE");
  } finally {
    mock.restore();
    auth.restore();
    console.log = origConsoleLog;
  }
});

test("runExecCommand toolbox tool-list calls API correctly", async () => {
  const auth = mockAuth();
  const mock = mockFetch({ tools: [], total: 0 });
  const origConsoleLog = console.log;
  const logs: string[] = [];
  console.log = (msg: string) => { logs.push(msg); };

  try {
    const code = await runExecCommand(["toolbox", "tool-list", "box-1"]);
    assert.equal(code, 0);
    assert.equal(mock.calls.length, 1);
    const url = new URL(mock.calls[0].url);
    assert.equal(url.pathname, "/api/agent-operator-integration/v1/tool-box/box-1/tools");
  } finally {
    mock.restore();
    auth.restore();
    console.log = origConsoleLog;
  }
});

test("runExecCommand toolbox tool-get calls API correctly", async () => {
  const auth = mockAuth();
  const orig = globalThis.fetch;
  const calls: Array<{ url: string; method: string; body?: string }> = [];
  let callIndex = 0;
  const responses = [
    { box_svc_url: "http://agent-operator-integration:9000" },
    { tool_id: "tool-1" },
  ];

  globalThis.fetch = async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    const method = init?.method ?? "GET";
    const body = init?.body ? String(init.body) : undefined;
    calls.push({ url, method, body });
    const resp = responses[callIndex++] ?? {};
    return new Response(JSON.stringify(resp), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };

  try {
    const code = await runExecCommand(["toolbox", "tool-get", "box-1", "tool-1"]);
    assert.equal(code, 0, `Expected code 0 but got ${code}. Errors: ${calls.map(c => c.url).join(", ")}`);
    assert.equal(calls.length, 2);
    assert.equal(calls[0].url, "https://mock.kweaver.test/api/agent-operator-integration/v1/tool-box/box-1");
    assert.equal(calls[1].url, "http://agent-operator-integration:9000/api/agent-operator-integration/v1/tool-box/box-1/tools/tool-1");
  } finally {
    globalThis.fetch = orig;
    auth.restore();
  }
});

test("runExecCommand toolbox categories calls API correctly", async () => {
  const auth = mockAuth();
  const mock = mockFetch([{ category_type: "cat-1", category_name: "Category 1" }]);
  const origConsoleLog = console.log;
  const logs: string[] = [];
  console.log = (msg: string) => { logs.push(msg); };

  try {
    const code = await runExecCommand(["toolbox", "categories"]);
    assert.equal(code, 0);
    assert.equal(mock.calls.length, 1);
    const url = new URL(mock.calls[0].url);
    assert.equal(url.pathname, "/api/agent-operator-integration/v1/tool-box/categories");
  } finally {
    mock.restore();
    auth.restore();
    console.log = origConsoleLog;
  }
});

test("runExecCommand toolbox prompt-templates calls API correctly", async () => {
  const auth = mockAuth();
  const mock = mockFetch([{ prompt_id: "p-1", name: "Template 1" }]);
  const origConsoleLog = console.log;
  const logs: string[] = [];
  console.log = (msg: string) => { logs.push(msg); };

  try {
    const code = await runExecCommand(["toolbox", "prompt-templates"]);
    assert.equal(code, 0);
    assert.equal(mock.calls.length, 1);
    const url = new URL(mock.calls[0].url);
    assert.equal(url.pathname, "/api/agent-operator-integration/v1/function/prompt-templates");
  } finally {
    mock.restore();
    auth.restore();
    console.log = origConsoleLog;
  }
});

test("runExecCommand toolbox dependencies-versions calls API correctly", async () => {
  const auth = mockAuth();
  const mock = mockFetch({ package_name: "requests", versions: ["2.28.0"] });
  const origConsoleLog = console.log;
  const logs: string[] = [];
  console.log = (msg: string) => { logs.push(msg); };

  try {
    const code = await runExecCommand(["toolbox", "dependencies-versions", "requests"]);
    assert.equal(code, 0);
    assert.equal(mock.calls.length, 1);
    const url = new URL(mock.calls[0].url);
    assert.equal(url.pathname, "/api/agent-operator-integration/v1/function/dependencies/requests/versions");
  } finally {
    mock.restore();
    auth.restore();
    console.log = origConsoleLog;
  }
});

// ── MCP Command Tests ─────────────────────────────────────────────────────────

test("runExecCommand mcp list calls API correctly", async () => {
  const auth = mockAuth();
  const mock = mockFetch({ data: [], total: 0 });
  const origConsoleLog = console.log;
  const logs: string[] = [];
  console.log = (msg: string) => { logs.push(msg); };

  try {
    const code = await runExecCommand(["mcp", "list"]);
    assert.equal(code, 0);
    assert.equal(mock.calls.length, 1);
    const url = new URL(mock.calls[0].url);
    assert.equal(url.pathname, "/api/agent-operator-integration/v1/mcp/list");
  } finally {
    mock.restore();
    auth.restore();
    console.log = origConsoleLog;
  }
});

test("runExecCommand mcp get calls API correctly", async () => {
  const auth = mockAuth();
  const mock = mockFetch({ mcp_id: "mcp-1" });
  const origConsoleLog = console.log;
  const logs: string[] = [];
  console.log = (msg: string) => { logs.push(msg); };

  try {
    const code = await runExecCommand(["mcp", "get", "mcp-1"]);
    assert.equal(code, 0);
    assert.equal(mock.calls.length, 1);
    const url = new URL(mock.calls[0].url);
    assert.equal(url.pathname, "/api/agent-operator-integration/v1/mcp/mcp-1");
  } finally {
    mock.restore();
    auth.restore();
    console.log = origConsoleLog;
  }
});

test("runExecCommand mcp delete calls API correctly", async () => {
  const auth = mockAuth();
  const mock = mockFetch({});
  const origConsoleLog = console.log;
  const logs: string[] = [];
  console.log = (msg: string) => { logs.push(msg); };

  try {
    const code = await runExecCommand(["mcp", "delete", "mcp-1"]);
    assert.equal(code, 0);
    assert.equal(mock.calls.length, 1);
    const url = new URL(mock.calls[0].url);
    assert.equal(url.pathname, "/api/agent-operator-integration/v1/mcp/mcp-1");
    assert.equal(mock.calls[0].method, "DELETE");
  } finally {
    mock.restore();
    auth.restore();
    console.log = origConsoleLog;
  }
});

test("runExecCommand mcp categories calls API correctly", async () => {
  const auth = mockAuth();
  const mock = mockFetch([{ category: "cat-1", name: "Category 1" }]);
  const origConsoleLog = console.log;
  const logs: string[] = [];
  console.log = (msg: string) => { logs.push(msg); };

  try {
    const code = await runExecCommand(["mcp", "categories"]);
    assert.equal(code, 0);
    assert.equal(mock.calls.length, 1);
    const url = new URL(mock.calls[0].url);
    assert.equal(url.pathname, "/api/agent-operator-integration/v1/mcp/categories");
  } finally {
    mock.restore();
    auth.restore();
    console.log = origConsoleLog;
  }
});

test("runExecCommand mcp market calls API correctly", async () => {
  const auth = mockAuth();
  const mock = mockFetch({ data: [], total: 0 });
  const origConsoleLog = console.log;
  const logs: string[] = [];
  console.log = (msg: string) => { logs.push(msg); };

  try {
    const code = await runExecCommand(["mcp", "market"]);
    assert.equal(code, 0);
    assert.equal(mock.calls.length, 1);
    const url = new URL(mock.calls[0].url);
    assert.equal(url.pathname, "/api/agent-operator-integration/v1/mcp/market/list");
  } finally {
    mock.restore();
    auth.restore();
    console.log = origConsoleLog;
  }
});

test("runExecCommand mcp market-get calls API correctly", async () => {
  const auth = mockAuth();
  const mock = mockFetch({ mcp_id: "mcp-1" });
  const origConsoleLog = console.log;
  const logs: string[] = [];
  console.log = (msg: string) => { logs.push(msg); };

  try {
    const code = await runExecCommand(["mcp", "market-get", "mcp-1"]);
    assert.equal(code, 0);
    assert.equal(mock.calls.length, 1);
    const url = new URL(mock.calls[0].url);
    assert.equal(url.pathname, "/api/agent-operator-integration/v1/mcp/market/mcp-1");
  } finally {
    mock.restore();
    auth.restore();
    console.log = origConsoleLog;
  }
});

test("runExecCommand mcp proxy-list calls API correctly", async () => {
  const auth = mockAuth();
  const mock = mockFetch({ tools: [{ name: "tool-1" }] });
  const origConsoleLog = console.log;
  const logs: string[] = [];
  console.log = (msg: string) => { logs.push(msg); };

  try {
    const code = await runExecCommand(["mcp", "proxy-list", "mcp-1"]);
    assert.equal(code, 0);
    assert.equal(mock.calls.length, 1);
    const url = new URL(mock.calls[0].url);
    assert.equal(url.pathname, "/api/agent-operator-integration/v1/mcp/mcp-1/proxy/list-tools");
  } finally {
    mock.restore();
    auth.restore();
    console.log = origConsoleLog;
  }
});

// ── Impex Command Tests ───────────────────────────────────────────────────────

test("runExecCommand impex export calls API correctly", async () => {
  const auth = mockAuth();
  const mock = mockFetch({ operator: [], toolbox: [], mcp: [] });
  const origConsoleLog = console.log;
  const logs: string[] = [];
  console.log = (msg: string) => { logs.push(msg); };

  try {
    const code = await runExecCommand(["impex", "export", "operator", "op-1"]);
    assert.equal(code, 0);
    assert.equal(mock.calls.length, 1);
    const url = new URL(mock.calls[0].url);
    assert.equal(url.pathname, "/api/agent-operator-integration/v1/impex/export/operator/op-1");
  } finally {
    mock.restore();
    auth.restore();
    console.log = origConsoleLog;
  }
});

test("runExecCommand impex export with multiple ids calls API correctly", async () => {
  const auth = mockAuth();
  const mock = mockFetch({ operator: [], toolbox: [], mcp: [] });
  const origConsoleLog = console.log;
  const logs: string[] = [];
  console.log = (msg: string) => { logs.push(msg); };

  try {
    const code = await runExecCommand(["impex", "export", "toolbox", "box-1"]);
    assert.equal(code, 0);
    assert.equal(mock.calls.length, 1);
    const url = new URL(mock.calls[0].url);
    assert.equal(url.pathname, "/api/agent-operator-integration/v1/impex/export/toolbox/box-1");
  } finally {
    mock.restore();
    auth.restore();
    console.log = origConsoleLog;
  }
});

// ── Error Handling Tests ──────────────────────────────────────────────────────

test("runExecCommand unknown subcommand returns error", async () => {
  const origConsoleError = console.error;
  const errors: string[] = [];
  console.error = (msg: string) => { errors.push(msg); };

  try {
    const code = await runExecCommand(["unknown"]);
    assert.equal(code, 1);
    assert.ok(errors[0].includes("Unknown"));
  } finally {
    console.error = origConsoleError;
  }
});

test("runExecCommand operator unknown subcommand returns error", async () => {
  const auth = mockAuth();
  const origConsoleError = console.error;
  const errors: string[] = [];
  console.error = (msg: string) => { errors.push(msg); };

  try {
    const code = await runExecCommand(["operator", "unknown"]);
    assert.equal(code, 1);
    assert.ok(errors[0].includes("Unknown"), `Expected "Unknown" in error but got: ${errors[0]}`);
  } finally {
    console.error = origConsoleError;
    auth.restore();
  }
});

test("runExecCommand operator get without id returns error", async () => {
  const auth = mockAuth();
  const origConsoleError = console.error;
  const errors: string[] = [];
  console.error = (msg: string) => { errors.push(msg); };

  try {
    const code = await runExecCommand(["operator", "get"]);
    assert.equal(code, 1);
    assert.ok(errors.some((e) => e.includes("Missing")));
  } finally {
    auth.restore();
    console.error = origConsoleError;
  }
});

test("runExecCommand toolbox get without id returns error", async () => {
  const auth = mockAuth();
  const origConsoleError = console.error;
  const errors: string[] = [];
  console.error = (msg: string) => { errors.push(msg); };

  try {
    const code = await runExecCommand(["toolbox", "get"]);
    assert.equal(code, 1);
    assert.ok(errors.some((e) => e.includes("Missing")));
  } finally {
    auth.restore();
    console.error = origConsoleError;
  }
});

test("runExecCommand mcp get without id returns error", async () => {
  const auth = mockAuth();
  const origConsoleError = console.error;
  const errors: string[] = [];
  console.error = (msg: string) => { errors.push(msg); };

  try {
    const code = await runExecCommand(["mcp", "get"]);
    assert.equal(code, 1);
    assert.ok(errors.some((e) => e.includes("Missing")));
  } finally {
    auth.restore();
    console.error = origConsoleError;
  }
});

// ── Pagination Tests ──────────────────────────────────────────────────────────

test("runExecCommand operator list with pagination params", async () => {
  const auth = mockAuth();
  const mock = mockFetch({ data: [], total: 0 });
  const origConsoleLog = console.log;
  const logs: string[] = [];
  console.log = (msg: string) => { logs.push(msg); };

  try {
    const code = await runExecCommand(["operator", "list", "--page", "2", "--page-size", "50"]);
    assert.equal(code, 0);
    const url = new URL(mock.calls[0].url);
    assert.equal(url.searchParams.get("page"), "2");
    assert.equal(url.searchParams.get("page_size"), "50");
  } finally {
    mock.restore();
    auth.restore();
    console.log = origConsoleLog;
  }
});

test("runExecCommand toolbox list with pagination params", async () => {
  const auth = mockAuth();
  const mock = mockFetch({ data: [], total: 0 });
  const origConsoleLog = console.log;
  const logs: string[] = [];
  console.log = (msg: string) => { logs.push(msg); };

  try {
    const code = await runExecCommand(["toolbox", "list", "--page", "3", "--limit", "20"]);
    assert.equal(code, 0);
    const url = new URL(mock.calls[0].url);
    assert.equal(url.searchParams.get("page"), "3");
    assert.equal(url.searchParams.get("page_size"), "20");
  } finally {
    mock.restore();
    auth.restore();
    console.log = origConsoleLog;
  }
});

// ── Business Domain Tests ─────────────────────────────────────────────────────

test("runExecCommand operator list with custom business domain", async () => {
  const auth = mockAuth();
  const mock = mockFetch({ data: [], total: 0 });
  const origConsoleLog = console.log;
  const logs: string[] = [];
  console.log = (msg: string) => { logs.push(msg); };

  try {
    const code = await runExecCommand(["operator", "list", "-bd", "bd_custom"]);
    assert.equal(code, 0);
    assert.equal(mock.calls.length, 1);
  } finally {
    mock.restore();
    auth.restore();
    console.log = origConsoleLog;
  }
});

test("runExecCommand toolbox list with custom business domain", async () => {
  const auth = mockAuth();
  const mock = mockFetch({ data: [], total: 0 });
  const origConsoleLog = console.log;
  const logs: string[] = [];
  console.log = (msg: string) => { logs.push(msg); };

  try {
    const code = await runExecCommand(["toolbox", "list", "--biz-domain", "bd_custom"]);
    assert.equal(code, 0);
    assert.equal(mock.calls.length, 1);
  } finally {
    mock.restore();
    auth.restore();
    console.log = origConsoleLog;
  }
});

// ── Output Format Tests ───────────────────────────────────────────────────────

test("runExecCommand operator list with compact output", async () => {
  const auth = mockAuth();
  const mock = mockFetch({ data: [], total: 0 });
  const origConsoleLog = console.log;
  const logs: string[] = [];
  console.log = (msg: string) => { logs.push(msg); };

  try {
    const code = await runExecCommand(["operator", "list", "--compact"]);
    assert.equal(code, 0);
    assert.equal(mock.calls.length, 1);
  } finally {
    mock.restore();
    auth.restore();
    console.log = origConsoleLog;
  }
});

test("runExecCommand toolbox list with pretty output", async () => {
  const auth = mockAuth();
  const mock = mockFetch({ data: [], total: 0 });
  const origConsoleLog = console.log;
  const logs: string[] = [];
  console.log = (msg: string) => { logs.push(msg); };

  try {
    const code = await runExecCommand(["toolbox", "list", "--pretty"]);
    assert.equal(code, 0);
    assert.equal(mock.calls.length, 1);
  } finally {
    mock.restore();
    auth.restore();
    console.log = origConsoleLog;
  }
});
