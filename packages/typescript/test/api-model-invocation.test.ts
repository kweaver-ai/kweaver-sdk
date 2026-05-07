import test from "node:test";
import assert from "node:assert/strict";
import {
  MF_MODEL_API_PATH_PREFIX,
  consumeOpenAiSseText,
  modelChatCompletions,
  modelEmbedding,
  modelEmbeddings,
  modelRerank,
} from "../src/api/model-invocation.js";
import { HttpError } from "../src/utils/http.js";

const BASE = "https://platform.example";
const TOKEN = "tok-invoke";

function mockFetch(handler: (url: RequestInfo | URL, init?: RequestInit) => Promise<Response>) {
  const original = globalThis.fetch;
  globalThis.fetch = handler as typeof fetch;
  return () => {
    globalThis.fetch = original;
  };
}

test("consumeOpenAiSseText concatenates delta content", async () => {
  const lines =
    'data: {"choices":[{"delta":{"content":"Hel"}}]}\n\ndata: {"choices":[{"delta":{"content":"lo"}}]}\n\ndata: [DONE]\n';
  const response = new Response(lines, {
    status: 200,
    headers: { "content-type": "text/event-stream" },
  });
  const text = await consumeOpenAiSseText(response, false);
  assert.equal(text, "Hello");
});

test("modelChatCompletions non-stream parses choices[0].message.content", async () => {
  const payload = {
    choices: [{ message: { role: "assistant", content: "Hi there" } }],
  };
  const restore = mockFetch(async () =>
    new Response(JSON.stringify(payload), {
      status: 200,
      headers: { "content-type": "application/json" },
    })
  );
  try {
    const r = await modelChatCompletions({
      baseUrl: BASE,
      accessToken: TOKEN,
      modelId: "1234567890123456789",
      messages: [{ role: "user", content: "ping" }],
      stream: false,
    });
    assert.equal(r.text, "Hi there");
  } finally {
    restore();
  }
});

test("modelChatCompletions stream sends accept text/event-stream", async () => {
  let captured: RequestInit | undefined;
  let bodyStr = "";
  const sse =
    'data: {"choices":[{"delta":{"content":"x"}}]}\n\ndata: [DONE]\n';
  const restore = mockFetch(async (_u, init) => {
    captured = init;
    bodyStr = init?.body as string;
    return new Response(sse, {
      status: 200,
      headers: { "content-type": "text/event-stream" },
    });
  });
  try {
    const r = await modelChatCompletions({
      baseUrl: BASE,
      accessToken: TOKEN,
      modelId: "1234567890123456789",
      messages: [{ role: "user", content: "p" }],
      stream: true,
    });
    assert.equal(r.text, "x");
    const h = captured?.headers as Record<string, string>;
    assert.equal(h.accept, "text/event-stream");
    const parsed = JSON.parse(bodyStr) as Record<string, unknown>;
    assert.equal(parsed.model, "1234567890123456789");
    assert.equal(parsed.model_id, "1234567890123456789");
    assert.equal(parsed.stream, true);
  } finally {
    restore();
  }
});

test("modelChatCompletions builds URL under mf-model-api prefix", async () => {
  let url = "";
  const restore = mockFetch(async (u) => {
    url = String(u);
    return new Response('{"choices":[{"message":{"content":""}}]}', {
      headers: { "content-type": "application/json" },
    });
  });
  const prev = process.env.KWEAVER_MF_MODEL_API_URL;
  delete process.env.KWEAVER_MF_MODEL_API_URL;
  try {
    await modelChatCompletions({
      baseUrl: BASE,
      accessToken: TOKEN,
      modelId: "1234567890123456789",
      messages: [{ role: "user", content: "a" }],
      stream: false,
    });
    assert.equal(url, `${BASE}${MF_MODEL_API_PATH_PREFIX}/chat/completions`);
  } finally {
    restore();
    if (prev !== undefined) process.env.KWEAVER_MF_MODEL_API_URL = prev;
  }
});

test("modelChatCompletions honors mfApiBaseUrl", async () => {
  let url = "";
  const restore = mockFetch(async (u) => {
    url = String(u);
    return new Response('{"choices":[{"message":{"content":""}}]}', {
      headers: { "content-type": "application/json" },
    });
  });
  try {
    await modelChatCompletions({
      baseUrl: BASE,
      mfApiBaseUrl: "https://api-other.example",
      accessToken: TOKEN,
      modelId: "1234567890123456789",
      messages: [{ role: "user", content: "a" }],
      stream: false,
    });
    assert.equal(url, `https://api-other.example${MF_MODEL_API_PATH_PREFIX}/chat/completions`);
  } finally {
    restore();
  }
});

test("modelChatCompletions maps modelName to body.model while keeping model_id", async () => {
  let bodyStr = "";
  const restore = mockFetch(async (_u, init) => {
    bodyStr = init?.body as string;
    return new Response('{"choices":[{"message":{"content":""}}]}', {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  });
  try {
    await modelChatCompletions({
      baseUrl: BASE,
      accessToken: TOKEN,
      modelId: "2052376865611583500",
      modelName: "dashscope-qwen-plus-intl",
      messages: [{ role: "user", content: "a" }],
      stream: false,
    });
    const parsed = JSON.parse(bodyStr) as Record<string, unknown>;
    assert.equal(parsed.model, "dashscope-qwen-plus-intl");
    assert.equal(parsed.model_id, "2052376865611583500");
  } finally {
    restore();
  }
});

test("modelEmbedding POSTs input and model_id", async () => {
  let init: RequestInit | undefined;
  let url = "";
  const restore = mockFetch(async (u, i) => {
    url = String(u);
    init = i;
    return new Response('{"ok":true}');
  });
  try {
    await modelEmbedding({
      baseUrl: BASE,
      accessToken: TOKEN,
      modelId: "1234567890123456789",
      input: ["a", "b"],
    });
    assert.equal(
      String(init?.body),
      JSON.stringify({
        input: ["a", "b"],
        model_id: "1234567890123456789",
        model: "1234567890123456789",
      }),
    );
    assert.match(url, /\/small-model\/embedding$/);
  } finally {
    restore();
  }
});

test("modelEmbeddings sets body.model to model_id when modelName omitted", async () => {
  let bodyStr = "";
  const restore = mockFetch(async (_u, init) => {
    bodyStr = init?.body as string;
    return new Response('{"data":[]}');
  });
  try {
    await modelEmbeddings({
      baseUrl: BASE,
      accessToken: TOKEN,
      modelId: "1234567890123456789",
      input: ["x"],
    });
    const parsed = JSON.parse(bodyStr) as Record<string, unknown>;
    assert.equal(parsed.model_id, "1234567890123456789");
    assert.equal(parsed.model, "1234567890123456789");
    assert.deepEqual(parsed.input, ["x"]);
  } finally {
    restore();
  }
});

test("modelEmbeddings maps trimmed modelName to body.model", async () => {
  let bodyStr = "";
  const restore = mockFetch(async (_u, init) => {
    bodyStr = init?.body as string;
    return new Response('{"data":[]}');
  });
  try {
    await modelEmbeddings({
      baseUrl: BASE,
      accessToken: TOKEN,
      modelId: "2052376865611583500",
      modelName: " my-mini ",
      input: ["a"],
    });
    const parsed = JSON.parse(bodyStr) as Record<string, unknown>;
    assert.equal(parsed.model, "my-mini");
    assert.equal(parsed.model_id, "2052376865611583500");
  } finally {
    restore();
  }
});

test("modelRerank sets body.model to model_id when modelName omitted", async () => {
  let bodyStr = "";
  const restore = mockFetch(async (_u, init) => {
    bodyStr = init?.body as string;
    return new Response('{"results":[]}');
  });
  try {
    await modelRerank({
      baseUrl: BASE,
      accessToken: TOKEN,
      modelId: "999",
      query: "q",
      documents: ["d1"],
    });
    const parsed = JSON.parse(bodyStr) as Record<string, unknown>;
    assert.equal(parsed.model_id, "999");
    assert.equal(parsed.model, "999");
    assert.equal(parsed.query, "q");
    assert.deepEqual(parsed.documents, ["d1"]);
  } finally {
    restore();
  }
});

test("modelChatCompletions throws HttpError when not ok", async () => {
  const restore = mockFetch(async () => new Response("err", { status: 400 }));
  try {
    await assert.rejects(
      async () =>
        modelChatCompletions({
          baseUrl: BASE,
          accessToken: TOKEN,
          modelId: "1234567890123456789",
          messages: [{ role: "user", content: "x" }],
          stream: false,
        }),
      (e: unknown) => e instanceof HttpError && e.status === 400,
    );
  } finally {
    restore();
  }
});
