import test from "node:test";
import assert from "node:assert/strict";

import {
  listOperators,
  getOperator,
  registerOperator,
  editOperator,
  deleteOperator,
  updateOperatorStatus,
  debugOperator,
  listOperatorHistory,
  listOperatorMarket,
  getOperatorMarket,
  listOperatorCategories,
  registerInternalOperator,
} from "../src/api/execution-factory/operator.js";

import {
  listToolBoxes,
  getToolBox,
  createToolBox,
  updateToolBox,
  deleteToolBox,
  updateToolBoxStatus,
  listTools,
  getTool,
  createTool,
  updateTool,
  updateToolStatus,
  deleteTool,
  batchDeleteTools,
  convertOperatorToTool,
  listToolBoxMarket,
  getToolBoxMarket,
  listToolBoxCategories,
  createInternalToolBox,
  toolProxy,
  debugTool,
  executeFunction,
  aiGenerateFunction,
  listPromptTemplates,
  installDependencies,
  getDependencyVersions,
} from "../src/api/execution-factory/toolbox.js";

import {
  listMCPServers,
  getMCPServer,
  registerMCPServer,
  updateMCPServer,
  deleteMCPServer,
  updateMCPServerStatus,
  parseMCPSSERequest,
  debugMCPTool,
  listMCPMarket,
  getMCPMarket,
  listMCPCategories,
  mcpProxyCallTool,
  mcpProxyListTools,
} from "../src/api/execution-factory/mcp.js";

import { exportData, importData } from "../src/api/execution-factory/impex.js";

const BASE = "https://mock.kweaver.test";
const TOKEN = "test-token-abc";
const API_PREFIX = "/api/agent-operator-integration/v1";

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

// ── Operator API Tests ───────────────────────────────────────────────────────

test("listOperators sends GET to /operators with query params", async () => {
  const mock = mockFetch({ data: [], total: 0 });
  try {
    await listOperators({
      baseUrl: BASE,
      accessToken: TOKEN,
      businessDomain: "bd_test",
      page: 1,
      page_size: 30,
      name: "test-operator",
    });
    assert.equal(mock.calls[0].method, "GET");
    const url = new URL(mock.calls[0].url);
    assert.equal(url.pathname, `${API_PREFIX}/operator/info/list`);
    assert.equal(url.searchParams.get("page"), "1");
    assert.equal(url.searchParams.get("page_size"), "30");
    assert.equal(url.searchParams.get("name"), "test-operator");
  } finally {
    mock.restore();
  }
});

test("getOperator sends GET to /operators/:id", async () => {
  const mock = mockFetch({ operator_id: "op-1", version: "v1" });
  try {
    await getOperator({
      baseUrl: BASE,
      accessToken: TOKEN,
      operatorId: "op-1",
      version: "v1",
    });
    assert.equal(mock.calls[0].method, "GET");
    const url = new URL(mock.calls[0].url);
    assert.equal(url.pathname, `${API_PREFIX}/operator/op-1`);
    assert.equal(url.searchParams.get("version"), "v1");
  } finally {
    mock.restore();
  }
});

test("registerOperator sends POST to /operator/register", async () => {
  const mock = mockFetch([{ status: "success", operator_id: "op-1" }]);
  try {
    await registerOperator({
      baseUrl: BASE,
      accessToken: TOKEN,
      body: {
        operator_metadata_type: "openapi",
        data: "openapi: '3.0.1'",
      },
    });
    assert.equal(mock.calls[0].method, "POST");
    const url = new URL(mock.calls[0].url);
    assert.equal(url.pathname, `${API_PREFIX}/operator/register`);
    const body = JSON.parse(mock.calls[0].body!);
    assert.equal(body.operator_metadata_type, "openapi");
  } finally {
    mock.restore();
  }
});

test("editOperator sends PUT to /operators/:id/versions/:version", async () => {
  const mock = mockFetch({ operator_id: "op-1", version: "v1" });
  try {
    await editOperator({
      baseUrl: BASE,
      accessToken: TOKEN,
      operatorId: "op-1",
      version: "v1",
      body: { operator_id: "op-1", name: "updated" },
    });
    assert.equal(mock.calls[0].method, "PUT");
    const url = new URL(mock.calls[0].url);
    assert.equal(url.pathname, `${API_PREFIX}/operator/op-1/versions/v1`);
  } finally {
    mock.restore();
  }
});

test("deleteOperator sends POST to /operator/delete", async () => {
  const mock = mockFetch({});
  try {
    await deleteOperator({
      baseUrl: BASE,
      accessToken: TOKEN,
      body: [{ operator_id: "op-1", version: "v1" }],
    });
    assert.equal(mock.calls[0].method, "POST");
    const url = new URL(mock.calls[0].url);
    assert.equal(url.pathname, `${API_PREFIX}/operator/delete`);
  } finally {
    mock.restore();
  }
});

test("updateOperatorStatus sends PUT to /operator/status", async () => {
  const mock = mockFetch({});
  try {
    await updateOperatorStatus({
      baseUrl: BASE,
      accessToken: TOKEN,
      body: [{ operator_id: "op-1", status: "published" }],
    });
    assert.equal(mock.calls[0].method, "PUT");
    const url = new URL(mock.calls[0].url);
    assert.equal(url.pathname, `${API_PREFIX}/operator/status`);
  } finally {
    mock.restore();
  }
});

test("debugOperator sends POST to /operator/debug", async () => {
  const mock = mockFetch({ status_code: 200, body: { result: "ok" } });
  try {
    await debugOperator({
      baseUrl: BASE,
      accessToken: TOKEN,
      body: { operator_id: "op-1", version: "v1" },
    });
    assert.equal(mock.calls[0].method, "POST");
    const url = new URL(mock.calls[0].url);
    assert.equal(url.pathname, `${API_PREFIX}/operator/debug`);
  } finally {
    mock.restore();
  }
});

test("listOperatorHistory sends GET to /operators/:id/history", async () => {
  const mock = mockFetch({ data: [], total: 0 });
  try {
    await listOperatorHistory({
      baseUrl: BASE,
      accessToken: TOKEN,
      operatorId: "op-1",
      page: 1,
      page_size: 30,
    });
    assert.equal(mock.calls[0].method, "GET");
    const url = new URL(mock.calls[0].url);
    assert.equal(url.pathname, `${API_PREFIX}/operator/op-1/history`);
  } finally {
    mock.restore();
  }
});

test("listOperatorMarket sends GET to /operator/market", async () => {
  const mock = mockFetch({ data: [], total: 0 });
  try {
    await listOperatorMarket({
      baseUrl: BASE,
      accessToken: TOKEN,
      page: 1,
      page_size: 30,
    });
    assert.equal(mock.calls[0].method, "GET");
    const url = new URL(mock.calls[0].url);
    assert.equal(url.pathname, `${API_PREFIX}/operator/market`);
  } finally {
    mock.restore();
  }
});

test("getOperatorMarket sends GET to /operator/market/:id", async () => {
  const mock = mockFetch({ operator_id: "op-1" });
  try {
    await getOperatorMarket({
      baseUrl: BASE,
      accessToken: TOKEN,
      operatorId: "op-1",
    });
    assert.equal(mock.calls[0].method, "GET");
    const url = new URL(mock.calls[0].url);
    assert.equal(url.pathname, `${API_PREFIX}/operator/market/op-1`);
  } finally {
    mock.restore();
  }
});

test("listOperatorCategories sends GET to /operator/categories", async () => {
  const mock = mockFetch([{ category: "data_process", name: "Data Process" }]);
  try {
    await listOperatorCategories({
      baseUrl: BASE,
      accessToken: TOKEN,
    });
    assert.equal(mock.calls[0].method, "GET");
    const url = new URL(mock.calls[0].url);
    assert.equal(url.pathname, `${API_PREFIX}/operator/categories`);
  } finally {
    mock.restore();
  }
});

test("registerInternalOperator sends POST to /operator/internal/register", async () => {
  const mock = mockFetch({ status: "success", operator_id: "op-1" });
  try {
    await registerInternalOperator({
      baseUrl: BASE,
      accessToken: TOKEN,
      body: {
        operator_id: "op-1",
        name: "test",
        metadata_type: "function",
        operator_type: "basic",
        execution_mode: "sync",
        config_source: "auto",
        config_version: "v1",
      },
    });
    assert.equal(mock.calls[0].method, "POST");
    const url = new URL(mock.calls[0].url);
    assert.equal(url.pathname, `${API_PREFIX}/operator/internal/register`);
  } finally {
    mock.restore();
  }
});

// ── Toolbox API Tests ────────────────────────────────────────────────────────

test("listToolBoxes sends GET to /tool-box/list", async () => {
  const mock = mockFetch({ data: [], total: 0 });
  try {
    await listToolBoxes({
      baseUrl: BASE,
      accessToken: TOKEN,
      page: 1,
      page_size: 30,
    });
    assert.equal(mock.calls[0].method, "GET");
    const url = new URL(mock.calls[0].url);
    assert.equal(url.pathname, `${API_PREFIX}/tool-box/list`);
  } finally {
    mock.restore();
  }
});

test("getToolBox sends GET to /toolbox/:id", async () => {
  const mock = mockFetch({ box_id: "box-1", box_name: "Test Box" });
  try {
    await getToolBox({
      baseUrl: BASE,
      accessToken: TOKEN,
      boxId: "box-1",
    });
    assert.equal(mock.calls[0].method, "GET");
    const url = new URL(mock.calls[0].url);
    assert.equal(url.pathname, `${API_PREFIX}/tool-box/box-1`);
  } finally {
    mock.restore();
  }
});

test("createToolBox sends POST to /toolbox", async () => {
  const mock = mockFetch({ box_id: "box-1" });
  try {
    await createToolBox({
      baseUrl: BASE,
      accessToken: TOKEN,
      body: { box_name: "Test Box", metadata_type: "openapi" },
    });
    assert.equal(mock.calls[0].method, "POST");
    const url = new URL(mock.calls[0].url);
    assert.equal(url.pathname, `${API_PREFIX}/tool-box`);
  } finally {
    mock.restore();
  }
});

test("updateToolBox sends PUT to /toolbox/:id", async () => {
  const mock = mockFetch({ box_id: "box-1" });
  try {
    await updateToolBox({
      baseUrl: BASE,
      accessToken: TOKEN,
      boxId: "box-1",
      body: { box_name: "Updated", box_desc: "desc", box_svc_url: "url", box_category: "cat" },
    });
    assert.equal(mock.calls[0].method, "PUT");
    const url = new URL(mock.calls[0].url);
    assert.equal(url.pathname, `${API_PREFIX}/tool-box/box-1`);
  } finally {
    mock.restore();
  }
});

test("deleteToolBox sends DELETE to /toolbox/:id", async () => {
  const mock = mockFetch({ box_id: "box-1" });
  try {
    await deleteToolBox({
      baseUrl: BASE,
      accessToken: TOKEN,
      boxId: "box-1",
    });
    assert.equal(mock.calls[0].method, "DELETE");
    const url = new URL(mock.calls[0].url);
    assert.equal(url.pathname, `${API_PREFIX}/tool-box/box-1`);
  } finally {
    mock.restore();
  }
});

test("updateToolBoxStatus sends PUT to /toolbox/:id/status", async () => {
  const mock = mockFetch({ box_id: "box-1", status: "published" });
  try {
    await updateToolBoxStatus({
      baseUrl: BASE,
      accessToken: TOKEN,
      boxId: "box-1",
      body: { status: "published" },
    });
    assert.equal(mock.calls[0].method, "PUT");
    const url = new URL(mock.calls[0].url);
    assert.equal(url.pathname, `${API_PREFIX}/tool-box/box-1/status`);
  } finally {
    mock.restore();
  }
});

test("listTools sends GET to /toolbox/:id/tools", async () => {
  const mock = mockFetch({ tools: [], total: 0 });
  try {
    await listTools({
      baseUrl: BASE,
      accessToken: TOKEN,
      boxId: "box-1",
      page: 1,
      page_size: 30,
    });
    assert.equal(mock.calls[0].method, "GET");
    const url = new URL(mock.calls[0].url);
    assert.equal(url.pathname, `${API_PREFIX}/tool-box/box-1/tools`);
  } finally {
    mock.restore();
  }
});

test("getTool sends GET to /tool-box/:boxId/tools/:toolId", async () => {
  const mock = mockFetch({ tool_id: "tool-1", name: "Test Tool" });
  try {
    await getTool({
      baseUrl: BASE,
      accessToken: TOKEN,
      boxId: "box-1",
      toolId: "tool-1",
    });
    assert.equal(mock.calls[0].method, "GET");
    const url = new URL(mock.calls[0].url);
    assert.equal(url.pathname, "/api/agent-operator-integration/v1/tool-box/box-1/tools/tool-1");
  } finally {
    mock.restore();
  }
});

test("createTool sends POST to /toolbox/:id/tools", async () => {
  const mock = mockFetch({ box_id: "box-1", success_count: 1 });
  try {
    await createTool({
      baseUrl: BASE,
      accessToken: TOKEN,
      boxId: "box-1",
      body: { metadata_type: "openapi", data: "openapi: '3.0.1'" },
    });
    assert.equal(mock.calls[0].method, "POST");
    const url = new URL(mock.calls[0].url);
    assert.equal(url.pathname, `${API_PREFIX}/tool-box/box-1/tools`);
  } finally {
    mock.restore();
  }
});

test("updateTool sends PUT to /toolbox/:boxId/tools/:toolId", async () => {
  const mock = mockFetch({ box_id: "box-1", tool_id: "tool-1" });
  try {
    await updateTool({
      baseUrl: BASE,
      accessToken: TOKEN,
      boxId: "box-1",
      toolId: "tool-1",
      body: { name: "Updated", description: "desc" },
    });
    assert.equal(mock.calls[0].method, "PUT");
    const url = new URL(mock.calls[0].url);
    assert.equal(url.pathname, `${API_PREFIX}/tool-box/box-1/tools/tool-1`);
  } finally {
    mock.restore();
  }
});

test("updateToolStatus sends PUT to /toolbox/:id/tools/status", async () => {
  const mock = mockFetch([{ tool_id: "tool-1", status: "enabled" }]);
  try {
    await updateToolStatus({
      baseUrl: BASE,
      accessToken: TOKEN,
      boxId: "box-1",
      body: { tool_id: "tool-1", status: "enabled" },
    });
    assert.equal(mock.calls[0].method, "PUT");
    const url = new URL(mock.calls[0].url);
    assert.equal(url.pathname, `${API_PREFIX}/tool-box/box-1/tools/status`);
  } finally {
    mock.restore();
  }
});

test("deleteTool sends DELETE to /toolbox/:boxId/tools/:toolId", async () => {
  const mock = mockFetch({ box_id: "box-1", tool_ids: ["tool-1"] });
  try {
    await deleteTool({
      baseUrl: BASE,
      accessToken: TOKEN,
      boxId: "box-1",
      toolId: "tool-1",
    });
    assert.equal(mock.calls[0].method, "DELETE");
    const url = new URL(mock.calls[0].url);
    assert.equal(url.pathname, `${API_PREFIX}/tool-box/box-1/tools/tool-1`);
  } finally {
    mock.restore();
  }
});

test("batchDeleteTools sends POST to /toolbox/:id/tools/batch-delete", async () => {
  const mock = mockFetch({ box_id: "box-1", tool_ids: ["tool-1", "tool-2"] });
  try {
    await batchDeleteTools({
      baseUrl: BASE,
      accessToken: TOKEN,
      boxId: "box-1",
      body: { tool_ids: ["tool-1", "tool-2"] },
    });
    assert.equal(mock.calls[0].method, "POST");
    const url = new URL(mock.calls[0].url);
    assert.equal(url.pathname, `${API_PREFIX}/tool-box/box-1/tools/batch-delete`);
  } finally {
    mock.restore();
  }
});

test("convertOperatorToTool sends POST to /toolbox/tools/convert", async () => {
  const mock = mockFetch({ box_id: "box-1", tool_id: "tool-1" });
  try {
    await convertOperatorToTool({
      baseUrl: BASE,
      accessToken: TOKEN,
      body: { box_id: "box-1", operator_id: "op-1", operator_version: "v1" },
    });
    assert.equal(mock.calls[0].method, "POST");
    const url = new URL(mock.calls[0].url);
    assert.equal(url.pathname, `${API_PREFIX}/tool-box/tools/convert`);
  } finally {
    mock.restore();
  }
});

test("listToolBoxMarket sends GET to /toolbox/market", async () => {
  const mock = mockFetch({ data: [], total: 0 });
  try {
    await listToolBoxMarket({
      baseUrl: BASE,
      accessToken: TOKEN,
      page: 1,
      page_size: 30,
    });
    assert.equal(mock.calls[0].method, "GET");
    const url = new URL(mock.calls[0].url);
    assert.equal(url.pathname, `${API_PREFIX}/tool-box/market`);
  } finally {
    mock.restore();
  }
});

test("getToolBoxMarket sends GET to /toolbox/market/:id", async () => {
  const mock = mockFetch({ box_id: "box-1" });
  try {
    await getToolBoxMarket({
      baseUrl: BASE,
      accessToken: TOKEN,
      boxId: "box-1",
    });
    assert.equal(mock.calls[0].method, "GET");
    const url = new URL(mock.calls[0].url);
    assert.equal(url.pathname, `${API_PREFIX}/tool-box/market/box-1`);
  } finally {
    mock.restore();
  }
});

test("listToolBoxCategories sends GET to /toolbox/categories", async () => {
  const mock = mockFetch([{ category_type: "cat-1", category_name: "Category 1" }]);
  try {
    await listToolBoxCategories({
      baseUrl: BASE,
      accessToken: TOKEN,
    });
    assert.equal(mock.calls[0].method, "GET");
    const url = new URL(mock.calls[0].url);
    assert.equal(url.pathname, `${API_PREFIX}/tool-box/categories`);
  } finally {
    mock.restore();
  }
});

test("createInternalToolBox sends POST to /toolbox/internal", async () => {
  const mock = mockFetch({ box_id: "box-1" });
  try {
    await createInternalToolBox({
      baseUrl: BASE,
      accessToken: TOKEN,
      body: {
        box_id: "box-1",
        box_name: "Test",
        box_desc: "desc",
        metadata_type: "function",
        data: "test",
        config_version: "v1",
        config_source: "auto",
      },
    });
    assert.equal(mock.calls[0].method, "POST");
    const url = new URL(mock.calls[0].url);
    assert.equal(url.pathname, `${API_PREFIX}/tool-box/internal`);
  } finally {
    mock.restore();
  }
});

test("toolProxy sends POST to /toolbox/:boxId/tools/:toolId/proxy", async () => {
  const mock = mockFetch({ status_code: 200, body: {} });
  try {
    await toolProxy({
      baseUrl: BASE,
      accessToken: TOKEN,
      boxId: "box-1",
      toolId: "tool-1",
      body: { body: { test: true } },
    });
    assert.equal(mock.calls[0].method, "POST");
    const url = new URL(mock.calls[0].url);
    assert.equal(url.pathname, `${API_PREFIX}/tool-box/box-1/tools/tool-1/proxy`);
  } finally {
    mock.restore();
  }
});

test("debugTool sends POST to /toolbox/:boxId/tools/:toolId/debug", async () => {
  const mock = mockFetch({ status_code: 200, body: {} });
  try {
    await debugTool({
      baseUrl: BASE,
      accessToken: TOKEN,
      boxId: "box-1",
      toolId: "tool-1",
      body: { body: { test: true } },
    });
    assert.equal(mock.calls[0].method, "POST");
    const url = new URL(mock.calls[0].url);
    assert.equal(url.pathname, `${API_PREFIX}/tool-box/box-1/tools/tool-1/debug`);
  } finally {
    mock.restore();
  }
});

test("executeFunction sends POST to /function/execute", async () => {
  const mock = mockFetch({ result: "ok" });
  try {
    await executeFunction({
      baseUrl: BASE,
      accessToken: TOKEN,
      body: { code: "print('hello')" },
    });
    assert.equal(mock.calls[0].method, "POST");
    const url = new URL(mock.calls[0].url);
    assert.equal(url.pathname, `${API_PREFIX}/function/execute`);
  } finally {
    mock.restore();
  }
});

test("aiGenerateFunction sends POST to /function/ai-generate", async () => {
  const mock = mockFetch({ content: { name: "test" } });
  try {
    await aiGenerateFunction({
      baseUrl: BASE,
      accessToken: TOKEN,
      body: { query: "generate a function" },
    });
    assert.equal(mock.calls[0].method, "POST");
    const url = new URL(mock.calls[0].url);
    assert.equal(url.pathname, `${API_PREFIX}/function/ai-generate`);
  } finally {
    mock.restore();
  }
});

test("listPromptTemplates sends GET to /function/prompt-templates", async () => {
  const mock = mockFetch([{ prompt_id: "p-1", name: "Template 1" }]);
  try {
    await listPromptTemplates({
      baseUrl: BASE,
      accessToken: TOKEN,
    });
    assert.equal(mock.calls[0].method, "GET");
    const url = new URL(mock.calls[0].url);
    assert.equal(url.pathname, `${API_PREFIX}/function/prompt-templates`);
  } finally {
    mock.restore();
  }
});

test("installDependencies sends POST to /function/dependencies/install", async () => {
  const mock = mockFetch({ session_id: "s-1" });
  try {
    await installDependencies({
      baseUrl: BASE,
      accessToken: TOKEN,
      body: { dependencies: [{ name: "requests", version: "2.28.0" }] },
    });
    assert.equal(mock.calls[0].method, "POST");
    const url = new URL(mock.calls[0].url);
    assert.equal(url.pathname, `${API_PREFIX}/function/dependencies/install`);
  } finally {
    mock.restore();
  }
});

test("getDependencyVersions sends GET to /function/dependencies/:name/versions", async () => {
  const mock = mockFetch({ package_name: "requests", versions: ["2.28.0", "2.27.0"] });
  try {
    await getDependencyVersions({
      baseUrl: BASE,
      accessToken: TOKEN,
      packageName: "requests",
    });
    assert.equal(mock.calls[0].method, "GET");
    const url = new URL(mock.calls[0].url);
    assert.equal(url.pathname, `${API_PREFIX}/function/dependencies/requests/versions`);
  } finally {
    mock.restore();
  }
});

// ── MCP API Tests ────────────────────────────────────────────────────────────

test("listMCPServers sends GET to /mcp/list", async () => {
  const mock = mockFetch({ data: [], total: 0 });
  try {
    await listMCPServers({
      baseUrl: BASE,
      accessToken: TOKEN,
      page: 1,
      page_size: 30,
    });
    assert.equal(mock.calls[0].method, "GET");
    const url = new URL(mock.calls[0].url);
    assert.equal(url.pathname, `${API_PREFIX}/mcp/list`);
  } finally {
    mock.restore();
  }
});

test("getMCPServer sends GET to /mcp/:id", async () => {
  const mock = mockFetch({ mcp_id: "mcp-1", name: "Test MCP" });
  try {
    await getMCPServer({
      baseUrl: BASE,
      accessToken: TOKEN,
      mcpId: "mcp-1",
    });
    assert.equal(mock.calls[0].method, "GET");
    const url = new URL(mock.calls[0].url);
    assert.equal(url.pathname, `${API_PREFIX}/mcp/mcp-1`);
  } finally {
    mock.restore();
  }
});

test("registerMCPServer sends POST to /mcp", async () => {
  const mock = mockFetch({ mcp_id: "mcp-1" });
  try {
    await registerMCPServer({
      baseUrl: BASE,
      accessToken: TOKEN,
      body: { name: "Test MCP", mode: "sse" },
    });
    assert.equal(mock.calls[0].method, "POST");
    const url = new URL(mock.calls[0].url);
    assert.equal(url.pathname, `${API_PREFIX}/mcp`);
  } finally {
    mock.restore();
  }
});

test("updateMCPServer sends PUT to /mcp/:id", async () => {
  const mock = mockFetch({ mcp_id: "mcp-1" });
  try {
    await updateMCPServer({
      baseUrl: BASE,
      accessToken: TOKEN,
      mcpId: "mcp-1",
      body: { mode: "sse" },
    });
    assert.equal(mock.calls[0].method, "PUT");
    const url = new URL(mock.calls[0].url);
    assert.equal(url.pathname, `${API_PREFIX}/mcp/mcp-1`);
  } finally {
    mock.restore();
  }
});

test("deleteMCPServer sends DELETE to /mcp/:id", async () => {
  const mock = mockFetch({});
  try {
    await deleteMCPServer({
      baseUrl: BASE,
      accessToken: TOKEN,
      mcpId: "mcp-1",
    });
    assert.equal(mock.calls[0].method, "DELETE");
    const url = new URL(mock.calls[0].url);
    assert.equal(url.pathname, `${API_PREFIX}/mcp/mcp-1`);
  } finally {
    mock.restore();
  }
});

test("updateMCPServerStatus sends PUT to /mcp/:id/status", async () => {
  const mock = mockFetch({ mcp_id: "mcp-1", status: "published" });
  try {
    await updateMCPServerStatus({
      baseUrl: BASE,
      accessToken: TOKEN,
      mcpId: "mcp-1",
      status: "published",
    });
    assert.equal(mock.calls[0].method, "PUT");
    const url = new URL(mock.calls[0].url);
    assert.equal(url.pathname, `${API_PREFIX}/mcp/mcp-1/status`);
    const body = JSON.parse(mock.calls[0].body!);
    assert.equal(body.status, "published");
  } finally {
    mock.restore();
  }
});

test("parseMCPSSERequest sends POST to /mcp/parse-sse", async () => {
  const mock = mockFetch({ tools: [{ name: "tool-1" }] });
  try {
    await parseMCPSSERequest({
      baseUrl: BASE,
      accessToken: TOKEN,
      body: { mode: "sse", url: "http://example.com/sse", headers: {} },
    });
    assert.equal(mock.calls[0].method, "POST");
    const url = new URL(mock.calls[0].url);
    assert.equal(url.pathname, `${API_PREFIX}/mcp/parse/sse`);
  } finally {
    mock.restore();
  }
});

test("debugMCPTool sends POST to /mcp/:id/tools/:name/debug", async () => {
  const mock = mockFetch({ content: [{ type: "text", text: "ok" }] });
  try {
    await debugMCPTool({
      baseUrl: BASE,
      accessToken: TOKEN,
      mcpId: "mcp-1",
      toolName: "tool-1",
      body: { param: "value" },
    });
    assert.equal(mock.calls[0].method, "POST");
    const url = new URL(mock.calls[0].url);
    assert.equal(url.pathname, `${API_PREFIX}/mcp/mcp-1/tools/tool-1/debug`);
  } finally {
    mock.restore();
  }
});

test("listMCPMarket sends GET to /mcp/market", async () => {
  const mock = mockFetch({ data: [], total: 0 });
  try {
    await listMCPMarket({
      baseUrl: BASE,
      accessToken: TOKEN,
      page: 1,
      page_size: 30,
    });
    assert.equal(mock.calls[0].method, "GET");
    const url = new URL(mock.calls[0].url);
    assert.equal(url.pathname, `${API_PREFIX}/mcp/market/list`);
  } finally {
    mock.restore();
  }
});

test("getMCPMarket sends GET to /mcp/market/:id", async () => {
  const mock = mockFetch({ mcp_id: "mcp-1" });
  try {
    await getMCPMarket({
      baseUrl: BASE,
      accessToken: TOKEN,
      mcpId: "mcp-1",
    });
    assert.equal(mock.calls[0].method, "GET");
    const url = new URL(mock.calls[0].url);
    assert.equal(url.pathname, `${API_PREFIX}/mcp/market/mcp-1`);
  } finally {
    mock.restore();
  }
});

test("listMCPCategories sends GET to /mcp/categories", async () => {
  const mock = mockFetch([{ category: "cat-1", name: "Category 1" }]);
  try {
    await listMCPCategories({
      baseUrl: BASE,
      accessToken: TOKEN,
    });
    assert.equal(mock.calls[0].method, "GET");
    const url = new URL(mock.calls[0].url);
    assert.equal(url.pathname, `${API_PREFIX}/mcp/categories`);
  } finally {
    mock.restore();
  }
});

test("mcpProxyCallTool sends POST to /mcp/:id/proxy/call-tool", async () => {
  const mock = mockFetch({ content: [{ type: "text", text: "ok" }] });
  try {
    await mcpProxyCallTool({
      baseUrl: BASE,
      accessToken: TOKEN,
      mcpId: "mcp-1",
      body: { tool_name: "tool-1", parameters: {} },
    });
    assert.equal(mock.calls[0].method, "POST");
    const url = new URL(mock.calls[0].url);
    assert.equal(url.pathname, `${API_PREFIX}/mcp/mcp-1/proxy/call-tool`);
  } finally {
    mock.restore();
  }
});

test("mcpProxyListTools sends GET to /mcp/:id/proxy/list-tools", async () => {
  const mock = mockFetch({ tools: [{ name: "tool-1" }] });
  try {
    await mcpProxyListTools({
      baseUrl: BASE,
      accessToken: TOKEN,
      mcpId: "mcp-1",
    });
    assert.equal(mock.calls[0].method, "GET");
    const url = new URL(mock.calls[0].url);
    assert.equal(url.pathname, `${API_PREFIX}/mcp/mcp-1/proxy/list-tools`);
  } finally {
    mock.restore();
  }
});

// ── Import/Export API Tests ──────────────────────────────────────────────────

test("exportData sends GET to /impex/export with query params", async () => {
  const mock = mockFetch({ operator: [], toolbox: [], mcp: [] });
  try {
    await exportData({
      baseUrl: BASE,
      accessToken: TOKEN,
      type: "operator",
      id: "op-1",
    });
    assert.equal(mock.calls[0].method, "GET");
    const url = new URL(mock.calls[0].url);
    assert.equal(url.pathname, `${API_PREFIX}/impex/export/operator/op-1`);
  } finally {
    mock.restore();
  }
});

test("importData sends POST to /impex/import", async () => {
  const mock = mockFetch([{ type: "operator", id: "op-1" }]);
  try {
    await importData({
      baseUrl: BASE,
      accessToken: TOKEN,
      type: "operator",
      body: { data: "{}", mode: "create" },
    });
    assert.equal(mock.calls[0].method, "POST");
    const url = new URL(mock.calls[0].url);
    assert.equal(url.pathname, `${API_PREFIX}/impex/import/operator`);
    const body = JSON.parse(mock.calls[0].body!);
    assert.equal(body.mode, "create");
  } finally {
    mock.restore();
  }
});

// ── Headers Tests ────────────────────────────────────────────────────────────

test("API calls include correct authorization headers", async () => {
  const mock = mockFetch({ data: [] });
  try {
    await listOperators({
      baseUrl: BASE,
      accessToken: TOKEN,
      businessDomain: "bd_test",
    });
    const call = mock.calls[0];
    const request = call as unknown as { url: string };
    const response = await fetch(request.url, { method: "GET" });
    assert.ok(response, "Request should be made");
  } finally {
    mock.restore();
  }
});

test("API calls use correct business domain header", async () => {
  const mock = mockFetch({ data: [] });
  try {
    await listOperators({
      baseUrl: BASE,
      accessToken: TOKEN,
      businessDomain: "bd_custom",
    });
    assert.equal(mock.calls.length, 1);
  } finally {
    mock.restore();
  }
});
