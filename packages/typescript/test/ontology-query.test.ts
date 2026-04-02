import test from "node:test";
import assert from "node:assert/strict";

import { getActionType, createActionTypes, updateActionType, deleteActionTypes } from "../src/api/knowledge-networks.js";

import {
  objectTypeQuery,
  objectTypeProperties,
  subgraph,
  actionTypeQuery,
  actionTypeExecute,
  actionExecutionGet,
  actionLogsList,
  actionLogGet,
  actionLogCancel,
} from "../src/api/ontology-query.js";

const originalFetch = globalThis.fetch;

test("objectTypeQuery maps path body and X-HTTP-Method-Override", async () => {
  globalThis.fetch = async (input, init) => {
    const url = new URL(typeof input === "string" ? input : input.toString());
    const headers = new Headers(init?.headers);
    assert.equal(init?.method, "POST");
    assert.equal(
      url.pathname,
      "/api/ontology-query/v1/knowledge-networks/kn-1/object-types/pod"
    );
    assert.equal(headers.get("X-HTTP-Method-Override"), "GET");
    assert.equal(headers.get("content-type"), "application/json");
    assert.equal(init?.body, "{\"condition\":{\"operation\":\"and\",\"sub_conditions\":[]},\"limit\":10}");
    return new Response("{\"datas\":[]}", { status: 200 });
  };

  try {
    const body = await objectTypeQuery({
      baseUrl: "https://dip.aishu.cn",
      accessToken: "token-abc",
      knId: "kn-1",
      otId: "pod",
      body: "{\"condition\":{\"operation\":\"and\",\"sub_conditions\":[]},\"limit\":10}",
    });
    assert.equal(body, "{\"datas\":[]}");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("objectTypeProperties maps path and body", async () => {
  globalThis.fetch = async (input, init) => {
    const url = new URL(typeof input === "string" ? input : input.toString());
    const headers = new Headers(init?.headers);
    assert.equal(init?.method, "POST");
    assert.equal(
      url.pathname,
      "/api/ontology-query/v1/knowledge-networks/kn-1/object-types/pod/properties"
    );
    assert.equal(headers.get("X-HTTP-Method-Override"), "GET");
    assert.equal(init?.body, "{\"_instance_identities\":[],\"properties\":[\"name\"]}");
    return new Response("{\"datas\":[]}", { status: 200 });
  };

  try {
    const body = await objectTypeProperties({
      baseUrl: "https://dip.aishu.cn",
      accessToken: "token-abc",
      knId: "kn-1",
      otId: "pod",
      body: "{\"_instance_identities\":[],\"properties\":[\"name\"]}",
    });
    assert.equal(body, "{\"datas\":[]}");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("subgraph maps path and body", async () => {
  globalThis.fetch = async (input, init) => {
    const url = new URL(typeof input === "string" ? input : input.toString());
    assert.equal(init?.method, "POST");
    assert.equal(url.pathname, "/api/ontology-query/v1/knowledge-networks/kn-1/subgraph");
    assert.equal(init?.body, "{\"relation_type_paths\":[]}");
    const headers = init?.headers as Record<string, string>;
    assert.equal(headers["X-HTTP-Method-Override"], "GET");
    return new Response("{\"objects\":{}}", { status: 200 });
  };

  try {
    const body = await subgraph({
      baseUrl: "https://dip.aishu.cn",
      accessToken: "token-abc",
      knId: "kn-1",
      body: "{\"relation_type_paths\":[]}",
    });
    assert.equal(body, "{\"objects\":{}}");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("actionTypeQuery maps path and body", async () => {
  globalThis.fetch = async (input, init) => {
    const url = new URL(typeof input === "string" ? input : input.toString());
    const headers = new Headers(init?.headers);
    assert.equal(init?.method, "POST");
    assert.equal(
      url.pathname,
      "/api/ontology-query/v1/knowledge-networks/kn-1/action-types/restart_pod/"
    );
    assert.equal(headers.get("X-HTTP-Method-Override"), "GET");
    assert.equal(init?.body, "{\"_instance_identities\":[{\"pod_ip\":\"1.2.3.4\"}]}");
    return new Response("{\"actions\":[]}", { status: 200 });
  };

  try {
    const body = await actionTypeQuery({
      baseUrl: "https://dip.aishu.cn",
      accessToken: "token-abc",
      knId: "kn-1",
      atId: "restart_pod",
      body: "{\"_instance_identities\":[{\"pod_ip\":\"1.2.3.4\"}]}",
    });
    assert.equal(body, "{\"actions\":[]}");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("actionTypeExecute maps path and body", async () => {
  globalThis.fetch = async (input, init) => {
    const url = typeof input === "string" ? input : input.toString();
    assert.equal(init?.method, "POST");
    assert.equal(
      url,
      "https://dip.aishu.cn/api/ontology-query/v1/knowledge-networks/kn-1/action-types/restart_pod/execute"
    );
    assert.equal(init?.body, "{\"_instance_identities\":[{\"pod_ip\":\"1.2.3.4\"}]}");
    return new Response("{\"execution_id\":\"ex-1\",\"status\":\"pending\"}", { status: 202 });
  };

  try {
    const body = await actionTypeExecute({
      baseUrl: "https://dip.aishu.cn",
      accessToken: "token-abc",
      knId: "kn-1",
      atId: "restart_pod",
      body: "{\"_instance_identities\":[{\"pod_ip\":\"1.2.3.4\"}]}",
    });
    assert.equal(body, "{\"execution_id\":\"ex-1\",\"status\":\"pending\"}");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("actionExecutionGet maps path", async () => {
  globalThis.fetch = async (input, init) => {
    const url = typeof input === "string" ? input : input.toString();
    assert.equal(init?.method, "GET");
    assert.equal(
      url,
      "https://dip.aishu.cn/api/ontology-query/v1/knowledge-networks/kn-1/action-executions/ex-123"
    );
    return new Response("{\"id\":\"ex-123\",\"status\":\"completed\"}", { status: 200 });
  };

  try {
    const body = await actionExecutionGet({
      baseUrl: "https://dip.aishu.cn",
      accessToken: "token-abc",
      knId: "kn-1",
      executionId: "ex-123",
    });
    assert.equal(body, "{\"id\":\"ex-123\",\"status\":\"completed\"}");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("actionLogsList maps query params", async () => {
  globalThis.fetch = async (input, init) => {
    const url = new URL(typeof input === "string" ? input : input.toString());
    assert.equal(init?.method, "GET");
    assert.equal(url.pathname, "/api/ontology-query/v1/knowledge-networks/kn-1/action-logs");
    assert.equal(url.searchParams.get("limit"), "50");
    assert.equal(url.searchParams.get("need_total"), "true");
    assert.equal(url.searchParams.get("status"), "running");
    return new Response("{\"entries\":[]}", { status: 200 });
  };

  try {
    const body = await actionLogsList({
      baseUrl: "https://dip.aishu.cn",
      accessToken: "token-abc",
      knId: "kn-1",
      limit: 50,
      needTotal: true,
      status: "running",
    });
    assert.equal(body, "{\"entries\":[]}");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("actionLogGet maps path", async () => {
  globalThis.fetch = async (input, init) => {
    const url = typeof input === "string" ? input : input.toString();
    assert.equal(init?.method, "GET");
    assert.equal(
      url,
      "https://dip.aishu.cn/api/ontology-query/v1/knowledge-networks/kn-1/action-logs/log-456"
    );
    return new Response("{\"id\":\"log-456\"}", { status: 200 });
  };

  try {
    const body = await actionLogGet({
      baseUrl: "https://dip.aishu.cn",
      accessToken: "token-abc",
      knId: "kn-1",
      logId: "log-456",
    });
    assert.equal(body, "{\"id\":\"log-456\"}");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("actionLogCancel maps path", async () => {
  globalThis.fetch = async (input, init) => {
    const url = typeof input === "string" ? input : input.toString();
    assert.equal(init?.method, "POST");
    assert.equal(
      url,
      "https://dip.aishu.cn/api/ontology-query/v1/knowledge-networks/kn-1/action-logs/log-789/cancel"
    );
    return new Response("{\"status\":\"cancelled\"}", { status: 200 });
  };

  try {
    const body = await actionLogCancel({
      baseUrl: "https://dip.aishu.cn",
      accessToken: "token-abc",
      knId: "kn-1",
      logId: "log-789",
    });
    assert.equal(body, "{\"status\":\"cancelled\"}");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("getActionType sends GET to /action-types/:atId", async () => {
  globalThis.fetch = async (input, init) => {
    const url = typeof input === "string" ? input : input.toString();
    assert.equal(init?.method, "GET");
    assert.ok(url.includes("/action-types/at-1"));
    return new Response("{}", { status: 200 });
  };
  try {
    await getActionType({ baseUrl: "https://host", accessToken: "t", knId: "kn-1", atId: "at-1" });
  } finally { globalThis.fetch = originalFetch; }
});

test("createActionTypes sends POST to /action-types", async () => {
  globalThis.fetch = async (input, init) => {
    const url = typeof input === "string" ? input : input.toString();
    assert.equal(init?.method, "POST");
    assert.ok(url.includes("/action-types"));
    assert.equal(init?.body, '{"name":"at"}');
    return new Response("{}", { status: 201 });
  };
  try {
    await createActionTypes({ baseUrl: "https://host", accessToken: "t", knId: "kn-1", body: '{"name":"at"}' });
  } finally { globalThis.fetch = originalFetch; }
});

test("updateActionType sends PUT to /action-types/:atId", async () => {
  globalThis.fetch = async (input, init) => {
    const url = typeof input === "string" ? input : input.toString();
    assert.equal(init?.method, "PUT");
    assert.ok(url.includes("/action-types/at-1"));
    return new Response("{}", { status: 200 });
  };
  try {
    await updateActionType({ baseUrl: "https://host", accessToken: "t", knId: "kn-1", atId: "at-1", body: '{}' });
  } finally { globalThis.fetch = originalFetch; }
});

test("deleteActionTypes sends DELETE to /action-types/:atIds", async () => {
  globalThis.fetch = async (input, init) => {
    const url = typeof input === "string" ? input : input.toString();
    assert.equal(init?.method, "DELETE");
    assert.ok(url.includes("/action-types/at-1"));
    return new Response("", { status: 200 });
  };
  try {
    await deleteActionTypes({ baseUrl: "https://host", accessToken: "t", knId: "kn-1", atIds: "at-1" });
  } finally { globalThis.fetch = originalFetch; }
});
