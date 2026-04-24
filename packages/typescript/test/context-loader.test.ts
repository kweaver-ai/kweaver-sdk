import test from "node:test";
import assert from "node:assert/strict";

import {
  formatMissingInputParamsHint,
  validateCondition,
  validateInstanceIdentity,
  validateInstanceIdentities,
  callTool,
  searchSchema,
  findSkills,
  listTools,
  listResources,
  readResource,
  listResourceTemplates,
  listPrompts,
  getPrompt,
  type MissingInputParamsError,
} from "../src/api/context-loader.js";

test("validateCondition accepts valid condition with value_from const", () => {
  assert.doesNotThrow(() =>
    validateCondition({
      operation: "and",
      sub_conditions: [{ field: "name", operation: "like", value_from: "const", value: "高血压" }],
    })
  );
});

test("validateCondition accepts empty sub_conditions", () => {
  assert.doesNotThrow(() =>
    validateCondition({ operation: "and", sub_conditions: [] })
  );
});

test("validateCondition rejects value_from other than const", () => {
  assert.throws(
    () =>
      validateCondition({
        operation: "and",
        sub_conditions: [{ field: "x", value_from: "variable", value: "y" }],
      }),
    /value_from only supports "const"/
  );
});

test("validateCondition requires value when value_from is const", () => {
  assert.throws(
    () =>
      validateCondition({
        operation: "and",
        sub_conditions: [{ field: "x", value_from: "const" }],
      }),
    /value must be provided/
  );
});

test("validateInstanceIdentity accepts plain object", () => {
  assert.doesNotThrow(() =>
    validateInstanceIdentity({ drug_id: "DRUG_001" }, "_instance_identity")
  );
});

test("validateInstanceIdentity rejects string", () => {
  assert.throws(
    () => validateInstanceIdentity("DRUG_001", "_instance_identity"),
    /must be a plain object from Layer 2/
  );
});

test("validateInstanceIdentity rejects array", () => {
  assert.throws(
    () => validateInstanceIdentity([{ drug_id: "DRUG_001" }], "_instance_identity"),
    /must be a plain object from Layer 2/
  );
});

test("validateInstanceIdentities accepts array of objects", () => {
  assert.doesNotThrow(() =>
    validateInstanceIdentities([{ drug_id: "DRUG_001" }, { drug_id: "DRUG_002" }])
  );
});

test("validateInstanceIdentities rejects non-array", () => {
  assert.throws(
    () => validateInstanceIdentities({ drug_id: "DRUG_001" }),
    /must be an array/
  );
});

test("formatMissingInputParamsHint builds retry hint", () => {
  const err: MissingInputParamsError = {
    error_code: "MISSING_INPUT_PARAMS",
    message: "dynamic_params 缺少必需的 input 参数",
    missing: [
      {
        property: "monthly_sales",
        params: [{ name: "start", type: "INTEGER", hint: "在 additional_context 中补充时间范围" }],
      },
    ],
  };
  const hint = formatMissingInputParamsHint(err);
  assert.ok(hint.includes("MISSING_INPUT_PARAMS"));
  assert.ok(hint.includes("additional_context"));
  assert.ok(hint.includes("start"));
});

test("callTool sends generic MCP tools/call request", async () => {
  const received: { body: string }[] = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (_input, init) => {
    const body = (init as RequestInit)?.body as string;
    received.push({ body });

    const parsed = body ? (JSON.parse(body) as { method?: string }) : {};
    if (parsed.method === "initialize") {
      return new Response(
        JSON.stringify({ jsonrpc: "2.0", id: 1, result: { protocolVersion: "2024-11-05", capabilities: {} } }),
        { headers: { "Content-Type": "application/json", "MCP-Session-Id": "session-id-generic" } }
      );
    }
    if (parsed.method === "notifications/initialized") {
      return new Response("", { status: 200 });
    }
    return new Response(
      JSON.stringify({
        jsonrpc: "2.0",
        result: { content: [{ type: "text", text: JSON.stringify({ ok: true }) }] },
        id: 1,
      }),
      { headers: { "Content-Type": "application/json" } }
    );
  };

  try {
    const result = await callTool(
      { mcpUrl: "https://mcp.example.com/mcp", knId: "kn-generic", accessToken: "token-abc" },
      "new_tool",
      { query: "test", nested: { enabled: true } }
    ) as { ok?: boolean };
    assert.equal(result.ok, true);
    const parsed = JSON.parse(received[2].body);
    assert.equal(parsed.method, "tools/call");
    assert.equal(parsed.params.name, "new_tool");
    assert.deepEqual(parsed.params.arguments, { query: "test", nested: { enabled: true } });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("searchSchema sends search_schema with json response format by default", async () => {
  const received: { url: string; body: string; headers: Record<string, string> }[] = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const url = typeof input === "string" ? input : (input as URL).href;
    const body = (init as RequestInit)?.body as string;
    const rawHeaders = (init as RequestInit)?.headers;
    const headers: Record<string, string> =
      rawHeaders instanceof Headers
        ? Object.fromEntries(rawHeaders.entries())
        : (rawHeaders as Record<string, string>) ?? {};
    received.push({ url, body, headers });

    const parsed = body ? (JSON.parse(body) as { method?: string }) : {};
    if (parsed.method === "initialize") {
      return new Response(
        JSON.stringify({ jsonrpc: "2.0", id: 1, result: { protocolVersion: "2024-11-05", capabilities: {} } }),
        { headers: { "Content-Type": "application/json", "MCP-Session-Id": "session-id-123" } }
      );
    }
    if (parsed.method === "notifications/initialized") {
      return new Response("", { status: 200 });
    }
    return new Response(
      JSON.stringify({
        jsonrpc: "2.0",
        result: { content: [{ type: "text", text: JSON.stringify({ object_types: [], metric_types: [{ id: "mt-1" }] }) }] },
        id: 1,
      }),
      { headers: { "Content-Type": "application/json" } }
    );
  };

  try {
    const result = await searchSchema(
      { mcpUrl: "https://mcp.example.com/mcp", knId: "kn-123", accessToken: "token-abc" },
      { query: "test query" }
    ) as { metric_types?: unknown[] };
    assert.equal(received.length, 3);
    assert.equal(received[0].url, "https://mcp.example.com/mcp");
    assert.equal(JSON.parse(received[0].body).method, "initialize");
    assert.equal(received[2].headers.Authorization, "Bearer token-abc");
    assert.equal(received[2].headers["X-Kn-ID"], "kn-123");
    assert.equal(received[2].headers["MCP-Session-Id"], "session-id-123");
    const parsed = JSON.parse(received[2].body);
    assert.equal(parsed.method, "tools/call");
    assert.equal(parsed.params.name, "search_schema");
    assert.equal(parsed.params.arguments.query, "test query");
    assert.equal(parsed.params.arguments.response_format, "json");
    assert.equal(result.metric_types?.length, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("searchSchema preserves explicit toon response format", async () => {
  const received: { body: string }[] = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (_input, init) => {
    const body = (init as RequestInit)?.body as string;
    received.push({ body });
    const parsed = body ? (JSON.parse(body) as { method?: string }) : {};
    if (parsed.method === "initialize") {
      return new Response(
        JSON.stringify({ jsonrpc: "2.0", id: 1, result: { protocolVersion: "2024-11-05", capabilities: {} } }),
        { headers: { "Content-Type": "application/json", "MCP-Session-Id": "session-id-toon" } }
      );
    }
    if (parsed.method === "notifications/initialized") {
      return new Response("", { status: 200 });
    }
    return new Response(
      JSON.stringify({
        jsonrpc: "2.0",
        result: { content: [{ type: "text", text: "object_types: []" }] },
        id: 1,
      }),
      { headers: { "Content-Type": "application/json" } }
    );
  };

  try {
    const result = await searchSchema(
      { mcpUrl: "https://mcp.example.com/mcp", knId: "kn-toon", accessToken: "token-abc" },
      { query: "test query", response_format: "toon" }
    ) as { raw?: string };
    const parsed = JSON.parse(received[2].body);
    assert.equal(parsed.params.arguments.response_format, "toon");
    assert.equal(result.raw, "object_types: []");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("findSkills sends find_skills with required object_type_id and optional fields", async () => {
  const received: { body: string }[] = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (_input, init) => {
    const body = (init as RequestInit)?.body as string;
    received.push({ body });
    const parsed = body ? (JSON.parse(body) as { method?: string }) : {};
    if (parsed.method === "initialize") {
      return new Response(
        JSON.stringify({ jsonrpc: "2.0", id: 1, result: { protocolVersion: "2024-11-05", capabilities: {} } }),
        { headers: { "Content-Type": "application/json", "MCP-Session-Id": "session-find" } }
      );
    }
    if (parsed.method === "notifications/initialized") {
      return new Response("", { status: 200 });
    }
    return new Response(
      JSON.stringify({
        jsonrpc: "2.0",
        result: {
          content: [
            { type: "text", text: JSON.stringify({ entries: [{ skill_id: "s1", name: "Skill 1" }] }) },
          ],
        },
        id: 1,
      }),
      { headers: { "Content-Type": "application/json" } }
    );
  };

  try {
    const result = await findSkills(
      { mcpUrl: "https://mcp.example.com/mcp", knId: "kn-1", accessToken: "tok" },
      { object_type_id: "ot_drug", skill_query: "treatment", top_k: 5 }
    );
    assert.equal(result.entries.length, 1);
    assert.equal(result.entries[0].skill_id, "s1");
    const parsed = JSON.parse(received[2].body);
    assert.equal(parsed.params.name, "find_skills");
    assert.equal(parsed.params.arguments.object_type_id, "ot_drug");
    assert.equal(parsed.params.arguments.skill_query, "treatment");
    assert.equal(parsed.params.arguments.top_k, 5);
    assert.equal(parsed.params.arguments.instance_identities, undefined);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("findSkills rejects missing object_type_id and invalid top_k", async () => {
  await assert.rejects(
    () =>
      findSkills(
        { mcpUrl: "https://mcp.example.com/mcp", knId: "kn-1", accessToken: "tok" },
        { object_type_id: "" }
      ),
    /object_type_id is required/
  );
  await assert.rejects(
    () =>
      findSkills(
        { mcpUrl: "https://mcp.example.com/mcp", knId: "kn-1", accessToken: "tok" },
        { object_type_id: "ot", top_k: 0 }
      ),
    /top_k must be between 1 and 20/
  );
});

function installMcpListFetchMock(
  method: string,
  result: unknown
): () => void {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const body = (init as RequestInit)?.body as string;
    const parsed = body ? (JSON.parse(body) as { method?: string }) : {};
    if (parsed.method === "initialize") {
      return new Response(
        JSON.stringify({ jsonrpc: "2.0", id: 1, result: { protocolVersion: "2024-11-05", capabilities: {} } }),
        { headers: { "Content-Type": "application/json", "MCP-Session-Id": "session-id-123" } }
      );
    }
    if (parsed.method === "notifications/initialized") {
      return new Response("", { status: 200 });
    }
    if (parsed.method === method) {
      return new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result }), {
        headers: { "Content-Type": "application/json" },
      });
    }
    return new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result: {} }), {
      headers: { "Content-Type": "application/json" },
    });
  };
  return () => {
    globalThis.fetch = originalFetch;
  };
}

test("listTools sends tools/list and returns result", async () => {
  const restore = installMcpListFetchMock("tools/list", {
    tools: [{ name: "kn_search", description: "Search knowledge network" }],
  });
  try {
    const result = await listTools(
      { mcpUrl: "https://mcp.example.com/mcp", knId: "kn-1", accessToken: "tok" }
    ) as { tools?: unknown[] };
    assert.ok(result.tools);
    assert.equal(result.tools.length, 1);
    assert.equal(result.tools[0].name, "kn_search");
  } finally {
    restore();
  }
});

test("listResources sends resources/list and returns result", async () => {
  const restore = installMcpListFetchMock("resources/list", {
    resources: [{ uri: "file:///doc.txt", name: "doc" }],
  });
  try {
    const result = await listResources(
      { mcpUrl: "https://mcp.example.com/mcp", knId: "kn-1", accessToken: "tok" }
    ) as { resources?: unknown[] };
    assert.ok(result.resources);
    assert.equal(result.resources.length, 1);
    assert.equal(result.resources[0].uri, "file:///doc.txt");
  } finally {
    restore();
  }
});

test("readResource sends resources/read with uri", async () => {
  const restore = installMcpListFetchMock("resources/read", {
    contents: [{ uri: "file:///doc.txt", mimeType: "text/plain", text: "hello" }],
  });
  try {
    const result = await readResource(
      { mcpUrl: "https://mcp.example.com/mcp", knId: "kn-1", accessToken: "tok" },
      "file:///doc.txt"
    ) as { contents?: unknown[] };
    assert.ok(result.contents);
    assert.equal(result.contents.length, 1);
    assert.equal(result.contents[0].text, "hello");
  } finally {
    restore();
  }
});

test("listResourceTemplates sends resources/templates/list", async () => {
  const restore = installMcpListFetchMock("resources/templates/list", {
    resourceTemplates: [{ uriTemplate: "file:///docs/{id}" }],
  });
  try {
    const result = await listResourceTemplates(
      { mcpUrl: "https://mcp.example.com/mcp", knId: "kn-1", accessToken: "tok" }
    ) as { resourceTemplates?: unknown[] };
    assert.ok(result.resourceTemplates);
    assert.equal(result.resourceTemplates.length, 1);
    assert.equal(result.resourceTemplates[0].uriTemplate, "file:///docs/{id}");
  } finally {
    restore();
  }
});

test("listPrompts sends prompts/list and returns result", async () => {
  const restore = installMcpListFetchMock("prompts/list", {
    prompts: [{ name: "code_review", description: "Review code" }],
  });
  try {
    const result = await listPrompts(
      { mcpUrl: "https://mcp.example.com/mcp", knId: "kn-1", accessToken: "tok" }
    ) as { prompts?: unknown[] };
    assert.ok(result.prompts);
    assert.equal(result.prompts.length, 1);
    assert.equal(result.prompts[0].name, "code_review");
  } finally {
    restore();
  }
});

test("getPrompt sends prompts/get with name and optional arguments", async () => {
  const restore = installMcpListFetchMock("prompts/get", {
    description: "Review the given code",
    messages: [{ role: "user", content: { type: "text", text: "Review: def hello(): pass" } }],
  });
  try {
    const result = await getPrompt(
      { mcpUrl: "https://mcp.example.com/mcp", knId: "kn-1", accessToken: "tok" },
      "code_review",
      { code: "def hello(): pass" }
    ) as { description?: string; messages?: unknown[] };
    assert.ok(result.description);
    assert.ok(result.messages);
  } finally {
    restore();
  }
});
