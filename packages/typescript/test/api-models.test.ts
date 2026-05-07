import test from "node:test";
import assert from "node:assert/strict";
import {
  assertSmallModelConfigAdapterExclusive,
  listLlmModels,
  getLlmModel,
  deleteLlmModels,
  addSmallModel,
  MF_MODEL_MANAGER_PATH_PREFIX,
} from "../src/api/models.js";

const BASE = "https://platform.example";
const TOKEN = "tok-model";

function mockFetch(handler: (url: RequestInfo | URL, init?: RequestInit) => Promise<Response>) {
  const original = globalThis.fetch;
  globalThis.fetch = handler as typeof fetch;
  return () => {
    globalThis.fetch = original;
  };
}

test("assertSmallModelConfigAdapterExclusive rejects when both model_config and adapter", () => {
  assert.throws(
    () =>
      assertSmallModelConfigAdapterExclusive({
        model_config: { api_url: "http://x", api_model: "m" },
        adapter: true,
        adapter_code: "async def main(): pass",
      }),
    /cannot be combined/,
  );
});

test("assertSmallModelConfigAdapterExclusive rejects adapter=true without code", () => {
  assert.throws(
    () =>
      assertSmallModelConfigAdapterExclusive({
        model_name: "n",
        model_type: "embedding",
        adapter: true,
        batch_size: 8,
        max_tokens: 512,
        embedding_dim: 768,
      }),
    /adapter_code/,
  );
});

test("assertSmallModelConfigAdapterExclusive accepts direct config", () => {
  assert.doesNotThrow(() =>
    assertSmallModelConfigAdapterExclusive({
      model_name: "n",
      model_type: "embedding",
      model_config: { api_url: "http://x", api_model: "m" },
      adapter: false,
      batch_size: 8,
      max_tokens: 512,
      embedding_dim: 768,
    }),
  );
});

test("assertSmallModelConfigAdapterExclusive accepts adapter path", () => {
  assert.doesNotThrow(() =>
    assertSmallModelConfigAdapterExclusive({
      model_name: "n",
      model_type: "embedding",
      adapter: true,
      adapter_code: "async def main(t): return {}",
      batch_size: 8,
      max_tokens: 512,
      embedding_dim: 768,
    }),
  );
});

test("listLlmModels builds URL under mf-model-manager prefix", async () => {
  let url = "";
  const restore = mockFetch(async (u) => {
    url = String(u);
    return new Response("{}");
  });
  const prev = process.env.KWEAVER_MF_MODEL_MANAGER_URL;
  delete process.env.KWEAVER_MF_MODEL_MANAGER_URL;
  try {
    await listLlmModels({
      baseUrl: BASE,
      accessToken: TOKEN,
      businessDomain: "bd_public",
      page: 1,
      size: 30,
    });
    assert.equal(url.split("?")[0], `${BASE}${MF_MODEL_MANAGER_PATH_PREFIX}/llm/list`);
    assert.ok(url.includes("size=30"));
    assert.ok(url.includes("page=1"));
  } finally {
    restore();
    if (prev !== undefined) process.env.KWEAVER_MF_MODEL_MANAGER_URL = prev;
  }
});

test("listLlmModels honors mfManagerBaseUrl override origin", async () => {
  let url = "";
  const restore = mockFetch(async (u) => {
    url = String(u);
    return new Response("{}");
  });
  try {
    await listLlmModels({
      baseUrl: BASE,
      mfManagerBaseUrl: "https://other.example",
      accessToken: TOKEN,
      page: 1,
      size: 10,
    });
    assert.equal(url.split("?")[0], `https://other.example${MF_MODEL_MANAGER_PATH_PREFIX}/llm/list`);
  } finally {
    restore();
  }
});

test("deleteLlmModels POSTs model_ids", async () => {
  let init: RequestInit | undefined;
  const restore = mockFetch(async (_u, i) => {
    init = i;
    return new Response("{}");
  });
  try {
    await deleteLlmModels({
      baseUrl: BASE,
      accessToken: TOKEN,
      modelIds: ["id1", "id2"],
    });
    assert.equal(init?.method, "POST");
    assert.equal(
      init?.body,
      JSON.stringify({ model_ids: ["id1", "id2"] }),
    );
  } finally {
    restore();
  }
});

test("getLlmModel passes model_id query", async () => {
  let url = "";
  const restore = mockFetch(async (u) => {
    url = String(u);
    return new Response("{}");
  });
  try {
    await getLlmModel({ baseUrl: BASE, accessToken: TOKEN, modelId: "m1234567890123456789" });
    assert.ok(url.includes("model_id=m1234567890123456789"));
    assert.ok(url.includes("/llm/get"));
  } finally {
    restore();
  }
});

test("addSmallModel does not POST when client validation fails", async () => {
  let posts = 0;
  const restore = mockFetch(async () => {
    posts += 1;
    return new Response("{}");
  });
  try {
    await assert.rejects(
      async () =>
        addSmallModel({
          baseUrl: BASE,
          accessToken: TOKEN,
          body: {
            model_name: "x",
            model_type: "embedding",
            model_config: { api_url: "http://a", api_model: "b" },
            adapter: true,
            adapter_code: "code",
            batch_size: 1,
          },
        }),
    );
    assert.equal(posts, 0);
  } finally {
    restore();
  }
});

import { HttpError } from "../src/utils/http.js";

test("listLlmModels throws HttpError on non-OK", async () => {
  const restore = mockFetch(async () => new Response("bad", { status: 502, statusText: "Bad" }));
  try {
    await assert.rejects(
      async () =>
        listLlmModels({
          baseUrl: BASE,
          accessToken: TOKEN,
          page: 1,
          size: 30,
        }),
      (e: unknown) => e instanceof HttpError && e.status === 502,
    );
  } finally {
    restore();
  }
});
