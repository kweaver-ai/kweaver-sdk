import test from "node:test";
import assert from "node:assert/strict";
import {
  copyAgentTemplate,
  deleteAgentTemplate,
  getAgentTemplate,
  getAgentTemplateByKey,
  getAgentTemplatePublishInfo,
  publishAgentTemplate,
  unpublishAgentTemplate,
  updateAgentTemplate,
  updateAgentTemplatePublishInfo,
} from "../src/api/agent-tpl.js";

const BASE = "https://platform.example";
const TOKEN = "tok-test";
const FACTORY = "/api/agent-factory/v3";

function mockFetch(handler: (url: RequestInfo | URL, init?: RequestInit) => Promise<Response>) {
  const original = globalThis.fetch;
  globalThis.fetch = handler as typeof fetch;
  return () => {
    globalThis.fetch = original;
  };
}

async function captureOne<T>(
  fn: () => Promise<T>,
  handler: (url: RequestInfo | URL, init?: RequestInit) => Promise<Response>,
): Promise<{ result: T; url: string; method: string }> {
  let url = "";
  let method = "";
  const restore = mockFetch(async (u, init) => {
    url = String(u);
    method = init?.method ?? "GET";
    return handler(u, init);
  });
  try {
    const result = await fn();
    return { result, url, method };
  } finally {
    restore();
  }
}

test("getAgentTemplate GET /agent-tpl/{id}", async () => {
  const { url, method } = await captureOne(
    () => getAgentTemplate({ baseUrl: BASE, accessToken: TOKEN, templateId: "t1" }),
    async () => new Response("{}", { status: 200 }),
  );
  assert.equal(method, "GET");
  assert.equal(url, `${BASE}${FACTORY}/agent-tpl/t1`);
});

test("getAgentTemplateByKey GET /agent-tpl/by-key/{key}", async () => {
  const { url } = await captureOne(
    () => getAgentTemplateByKey({ baseUrl: BASE, accessToken: TOKEN, key: "my/key" }),
    async () => new Response("{}", { status: 200 }),
  );
  assert.equal(url, `${BASE}${FACTORY}/agent-tpl/by-key/my%2Fkey`);
});

test("updateAgentTemplate PUT JSON body", async () => {
  let body = "";
  const restore = mockFetch(async (_u, init) => {
    body = (init?.body as string) ?? "";
    return new Response("", { status: 200 });
  });
  try {
    await updateAgentTemplate({
      baseUrl: BASE,
      accessToken: TOKEN,
      templateId: "t1",
      body: '{"name":"x"}',
    });
    assert.equal(body, '{"name":"x"}');
  } finally {
    restore();
  }
});

test("deleteAgentTemplate DELETE", async () => {
  const { method, url } = await captureOne(
    () => deleteAgentTemplate({ baseUrl: BASE, accessToken: TOKEN, templateId: "t1" }),
    async () => new Response("", { status: 200 }),
  );
  assert.equal(method, "DELETE");
  assert.equal(url, `${BASE}${FACTORY}/agent-tpl/t1`);
});

test("copyAgentTemplate POST /copy with {}", async () => {
  let body = "";
  const restore = mockFetch(async (_u, init) => {
    body = (init?.body as string) ?? "";
    return new Response("{}", { status: 200 });
  });
  try {
    await copyAgentTemplate({ baseUrl: BASE, accessToken: TOKEN, templateId: "t1" });
    assert.equal(body, "{}");
  } finally {
    restore();
  }
});

test("publishAgentTemplate POST default body", async () => {
  let body = "";
  const restore = mockFetch(async (_u, init) => {
    body = (init?.body as string) ?? "";
    return new Response("{}", { status: 200 });
  });
  try {
    await publishAgentTemplate({ baseUrl: BASE, accessToken: TOKEN, templateId: "t1" });
    const parsed = JSON.parse(body);
    assert.equal(parsed.business_domain_id, "bd_public");
    assert.deepEqual(parsed.category_ids, []);
  } finally {
    restore();
  }
});

test("unpublishAgentTemplate PUT", async () => {
  const { method, url } = await captureOne(
    () => unpublishAgentTemplate({ baseUrl: BASE, accessToken: TOKEN, templateId: "t1" }),
    async () => new Response("", { status: 200 }),
  );
  assert.equal(method, "PUT");
  assert.ok(url.endsWith("/agent-tpl/t1/unpublish"));
});

test("getAgentTemplatePublishInfo GET", async () => {
  const { url, method } = await captureOne(
    () => getAgentTemplatePublishInfo({ baseUrl: BASE, accessToken: TOKEN, templateId: "t1" }),
    async () => new Response("{}", { status: 200 }),
  );
  assert.equal(method, "GET");
  assert.ok(url.endsWith("/agent-tpl/t1/publish-info"));
});

test("updateAgentTemplatePublishInfo PUT JSON", async () => {
  let body = "";
  const restore = mockFetch(async (_u, init) => {
    body = (init?.body as string) ?? "";
    return new Response("{}", { status: 200 });
  });
  try {
    await updateAgentTemplatePublishInfo({
      baseUrl: BASE,
      accessToken: TOKEN,
      templateId: "t1",
      body: '{"desc":"d"}',
    });
    assert.equal(body, '{"desc":"d"}');
  } finally {
    restore();
  }
});
