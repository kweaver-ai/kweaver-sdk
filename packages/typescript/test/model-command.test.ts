import test from "node:test";
import assert from "node:assert/strict";
import {
  parseModelGlobalFlags,
  parseSmallAddFlags,
  buildSmallBodyFromFlags,
  parsedSmallFlagsHasEditUpdates,
  smallModelGetToEditBase,
  mergeSmallEditOntoExistingBase,
  parseLlmSparseEditFlags,
  parsedLlmSparseEditHasUpdates,
  llmModelGetToEditBase,
  mergeLlmEditOntoExistingBase,
  llmGetRecordModelName,
  smallGetRecordModelName,
} from "../src/commands/model.js";

test("parseModelGlobalFlags extracts -bd and leaves branch args", () => {
  const g = parseModelGlobalFlags([
    "-bd",
    "bd_x",
    "--mf-base-url",
    "https://mgr.example",
    "llm",
    "list",
  ]);
  assert.equal(g.businessDomain, "bd_x");
  assert.equal(g.mfManagerBaseUrl, "https://mgr.example");
  assert.deepEqual(g.rest, ["llm", "list"]);
});

test("parseModelGlobalFlags --json sets pretty false", () => {
  const g = parseModelGlobalFlags(["-bd", "bd_public", "--json", "small", "list"]);
  assert.equal(g.pretty, false);
  assert.equal(g.businessDomain, "bd_public");
});

test("parseSmallAddFlags --limit default path for type embedding", () => {
  const p = parseSmallAddFlags([
    "--name",
    "m",
    "--type",
    "embedding",
    "--batch-size",
    "8",
    "--max-tokens",
    "512",
    "--embedding-dim",
    "768",
    "--model-config-file",
    "/tmp/cfg.json",
  ]);
  assert.equal(p.name, "m");
  assert.equal(p.modelType, "embedding");
  assert.equal(p.batchSize, 8);
  assert.equal(p.modelConfigFile, "/tmp/cfg.json");
});

test("parseSmallAddFlags adapter mode", () => {
  const p = parseSmallAddFlags([
    "--name",
    "a",
    "--type",
    "reranker",
    "--batch-size",
    "4",
    "--adapter",
    "--adapter-code-file",
    "/tmp/ad.py",
  ]);
  assert.equal(p.adapter, true);
  assert.equal(p.adapterCodeFile, "/tmp/ad.py");
});

test("parseSmallAddFlags rejects invalid type", () => {
  assert.throws(
    () => parseSmallAddFlags(["--name", "x", "--type", "llm", "--batch-size", "1"]),
    /embedding or reranker/,
  );
});

test("parseSmallAddFlags parses upstream credential flags", () => {
  const p = parseSmallAddFlags([
    "--name",
    "emb",
    "--type",
    "embedding",
    "--batch-size",
    "8",
    "--max-tokens",
    "512",
    "--embedding-dim",
    "768",
    "--upstream-url",
    "https://example.com/v1/embeddings",
    "--api-model",
    "text-embedding-v4",
    "--api-key-file",
    "/secret/key.txt",
  ]);
  assert.equal(p.upstreamUrl, "https://example.com/v1/embeddings");
  assert.equal(p.apiModel, "text-embedding-v4");
  assert.equal(p.apiKeyFile, "/secret/key.txt");
});

test("buildSmallBodyFromFlags merges api_url/api_model/api_key without config file", async () => {
  const p = parseSmallAddFlags([
    "--name",
    "dash-e",
    "--type",
    "embedding",
    "--batch-size",
    "8",
    "--max-tokens",
    "8192",
    "--embedding-dim",
    "1024",
    "--upstream-url",
    "https://dash.example.com/compatible-mode/v1/embeddings",
    "--api-model",
    "text-embedding-v4",
    "--api-key",
    "sk-from-flag",
  ]);
  const body = await buildSmallBodyFromFlags(p);
  const mc = body.model_config as Record<string, unknown>;
  assert.equal(mc.api_url, "https://dash.example.com/compatible-mode/v1/embeddings");
  assert.equal(mc.api_model, "text-embedding-v4");
  assert.equal(mc.api_key, "sk-from-flag");
  assert.equal(body.adapter, false);
});

test("buildSmallBodyFromFlags rejects upstream flags combined with adapter", async () => {
  const p = parseSmallAddFlags([
    "--name",
    "a",
    "--type",
    "reranker",
    "--batch-size",
    "4",
    "--adapter",
    "--adapter-code-file",
    "/tmp/ad.py",
    "--upstream-url",
    "https://x/",
  ]);
  await assert.rejects(() => buildSmallBodyFromFlags(p), /--adapter/);
});

test("parsedSmallFlagsHasEditUpdates is false for empty argv", () => {
  assert.equal(parsedSmallFlagsHasEditUpdates(parseSmallAddFlags([])), false);
});

test("small edit merge: rename-only keeps embedding dimensions from GET-shaped base", async () => {
  const base = smallModelGetToEditBase({
    model_id: "2052368861092777984",
    model_name: "old",
    model_type: "embedding",
    batch_size: 8196,
    max_tokens: 8192,
    embedding_dim: 1024,
    model_config: { api_url: "https://x", api_model: "m", api_key: "k" },
    adapter: false,
    adapter_code: "",
  });
  const out = await mergeSmallEditOntoExistingBase(base, parseSmallAddFlags(["--name", "dashscope-text-embedding-v41"]));
  assert.equal(out.model_name, "dashscope-text-embedding-v41");
  assert.equal(out.max_tokens, 8192);
  assert.equal(out.embedding_dim, 1024);
  assert.equal((out.model_config as Record<string, unknown>).api_url, "https://x");
});

test("small edit merge: --batch-size only does not require embedding flags", async () => {
  const base = smallModelGetToEditBase({
    model_id: "1",
    model_name: "e",
    model_type: "embedding",
    batch_size: 8,
    max_tokens: 512,
    embedding_dim: 768,
    model_config: { api_url: "https://u", api_model: "emb", api_key: "x" },
    adapter: false,
    adapter_code: "",
  });
  const out = await mergeSmallEditOntoExistingBase(base, parseSmallAddFlags(["--batch-size", "8196"]));
  assert.equal(out.batch_size, 8196);
  assert.equal(out.embedding_dim, 768);
});

test("small edit merge rejects upstream flags on adapter-backed model", async () => {
  const base = smallModelGetToEditBase({
    model_id: "1",
    model_name: "a",
    model_type: "reranker",
    batch_size: 4,
    model_config: {},
    adapter: true,
    adapter_code: "print(1)",
  });
  await assert.rejects(
    () =>
      mergeSmallEditOntoExistingBase(base, parseSmallAddFlags(["--upstream-url", "https://vendor.example/v1"])),
    /adapter mode/,
  );
});

test("small edit merge sets change when api key supplied", async () => {
  const base = smallModelGetToEditBase({
    model_id: "1",
    model_name: "e",
    model_type: "embedding",
    batch_size: 8,
    max_tokens: 512,
    embedding_dim: 768,
    model_config: { api_url: "https://u", api_model: "emb", api_key: "***" },
    adapter: false,
    adapter_code: "",
  });
  const out = await mergeSmallEditOntoExistingBase(base, parseSmallAddFlags(["--api-key", "sk-new"]));
  assert.equal(out.change, true);
  assert.equal((out.model_config as Record<string, unknown>).api_key, "sk-new");
});

test("parsedLlmSparseEditHasUpdates is false for empty argv", () => {
  assert.equal(parsedLlmSparseEditHasUpdates(parseLlmSparseEditFlags([])), false);
});

test("parseLlmSparseEditFlags parses upstream and top-level flags", () => {
  const p = parseLlmSparseEditFlags([
    "--name",
    "n",
    "--series",
    "openai",
    "-t",
    "rlm",
    "--max-model-len",
    "16384",
    "--quota",
    "false",
    "--upstream-url",
    "https://api.example/v1/chat/completions",
    "--api-model",
    "gpt-4",
  ]);
  assert.equal(p.name, "n");
  assert.equal(p.modelSeries, "openai");
  assert.equal(p.modelType, "rlm");
  assert.equal(p.maxModelLen, 16384);
  assert.equal(p.quota, false);
  assert.equal(p.upstreamUrl, "https://api.example/v1/chat/completions");
  assert.equal(p.apiModel, "gpt-4");
});

test("llm edit merge: name-only preserves model_config", async () => {
  const base = llmModelGetToEditBase({
    model_id: "99",
    model_name: "old",
    model_series: "others",
    model_type: "llm",
    max_model_len: 8192,
    model_config: { api_url: "https://u", api_model: "m", api_key: "k" },
    quota: false,
  });
  const out = await mergeLlmEditOntoExistingBase(base, parseLlmSparseEditFlags(["--name", "new-name"]));
  assert.equal(out.model_name, "new-name");
  assert.equal(out.max_model_len, 8192);
  const mc = out.model_config as Record<string, unknown>;
  assert.equal(mc.api_url, "https://u");
  assert.equal(mc.api_model, "m");
});

test("llm edit merge: upstream flags merge into existing model_config", async () => {
  const base = llmModelGetToEditBase({
    model_id: "1",
    model_name: "x",
    model_series: "others",
    model_type: "llm",
    max_model_len: 4096,
    model_config: { api_url: "https://old", api_model: "oldm", api_key: "oldk" },
    quota: true,
  });
  const out = await mergeLlmEditOntoExistingBase(
    base,
    parseLlmSparseEditFlags(["--upstream-url", "https://new", "--api-model", "newm"]),
  );
  const mc = out.model_config as Record<string, unknown>;
  assert.equal(mc.api_url, "https://new");
  assert.equal(mc.api_model, "newm");
  assert.equal(mc.api_key, "oldk");
});

test("llmModelGetToEditBase defaults quota when GET omits it", () => {
  const b = llmModelGetToEditBase({
    model_id: "1",
    model_name: "n",
    model_series: "qwen",
    model_type: "llm",
    max_model_len: 8192,
    model_config: {},
  });
  assert.equal(b.quota, false);
});

test("llmModelGetToEditBase coerces numeric quota to boolean", () => {
  const b0 = llmModelGetToEditBase({
    model_id: "1",
    model_name: "n",
    model_series: "qwen",
    model_type: "llm",
    max_model_len: 8192,
    model_config: {},
    quota: 0,
  });
  assert.equal(b0.quota, false);
  const b1 = llmModelGetToEditBase({
    model_id: "1",
    model_name: "n",
    model_series: "qwen",
    model_type: "llm",
    max_model_len: 8192,
    model_config: {},
    quota: 1,
  });
  assert.equal(b1.quota, true);
});

test("smallGetRecordModelName reads model_name from small/get-shaped JSON", () => {
  assert.equal(smallGetRecordModelName({ model_name: " emb ", model_id: "1" }), "emb");
  assert.equal(smallGetRecordModelName({}), "");
});

test("llmGetRecordModelName reads model_name from llm/get-shaped JSON", () => {
  assert.equal(llmGetRecordModelName({ model_name: " dash-scope ", model_id: "1" }), "dash-scope");
  assert.equal(llmGetRecordModelName({}), "");
  assert.equal(llmGetRecordModelName(null), "");
});
