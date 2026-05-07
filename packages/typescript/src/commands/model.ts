import { readFile } from "node:fs/promises";
import { createInterface } from "node:readline";
import { readBundledModelTemplateFile } from "../bundled-model-templates.js";
import { ensureValidToken, formatHttpError, with401RefreshRetry } from "../auth/oauth.js";
import { resolveBusinessDomain } from "../config/store.js";
import {
  addLlmModel,
  addSmallModel,
  deleteLlmModels,
  deleteSmallModels,
  editLlmModel,
  editSmallModel,
  getLlmModel,
  getSmallModel,
  listLlmModels,
  listSmallModels,
  testLlmModel,
  testSmallModel,
} from "../api/models.js";
import { modelChatCompletions, modelEmbeddings, modelRerank } from "../api/model-invocation.js";
import { formatCallOutput } from "./call.js";

const DEFAULT_LIST_LIMIT = 30;

export interface ModelGlobalParse {
  rest: string[];
  businessDomain: string;
  mfManagerBaseUrl?: string;
  mfApiBaseUrl?: string;
  pretty: boolean;
}

/** Strip global flags; fill default business domain. */
export function parseModelGlobalFlags(args: string[]): ModelGlobalParse {
  let businessDomain = "";
  let mfManagerBaseUrl: string | undefined;
  let mfApiBaseUrl: string | undefined;
  let pretty = true;
  const rest: string[] = [];

  for (let i = 0; i < args.length; i += 1) {
    const a = args[i];
    if ((a === "-bd" || a === "--biz-domain") && args[i + 1]) {
      businessDomain = args[i + 1];
      i += 1;
      continue;
    }
    if (a === "--mf-base-url" && args[i + 1]) {
      mfManagerBaseUrl = args[i + 1];
      i += 1;
      continue;
    }
    if (a === "--mf-api-base-url" && args[i + 1]) {
      mfApiBaseUrl = args[i + 1];
      i += 1;
      continue;
    }
    if (a === "--json") {
      pretty = false;
      continue;
    }
    if (a === "--compact") {
      pretty = false;
      continue;
    }
    if (a === "--pretty") {
      pretty = true;
      continue;
    }
    rest.push(a);
  }

  if (!businessDomain) {
    businessDomain = resolveBusinessDomain();
  }

  return { rest, businessDomain, mfManagerBaseUrl, mfApiBaseUrl, pretty };
}

function printModelUsage(): void {
  console.log(`kweaver model

Usage:
  kweaver model llm   list [--keyword X] [--type llm|rlm|vu] [--series S] [--api-model M] [--page N] [--limit N] [--json] [-bd value]
  kweaver model llm   get <model_id> [--json] [-bd value]
  kweaver model llm   add --body-file <path.json> [--upstream-url <url>] [--api-model <id>] [--api-key <secret>|--api-key-file <path>] [--json] [-bd value]
  kweaver model llm   edit [<model_id>] --body-file <path.json> [--upstream-url <url>] [--api-model <id>] [--api-key <secret>|--api-key-file <path>] [--json] [-bd value]
                        (optional leading model_id overrides body.model_id after merge)
                        OR: kweaver model llm edit <model_id> [sparse flags] (GET /llm/get then merge only flags you pass)
                        Sparse flags: --name, --series, --type|-t, --max-model-len, --quota, --model-config-file, upstream flags (same as --body-file)
  kweaver model llm   delete <model_id> [<model_id> ...] [-y] [-bd value]
  kweaver model llm   test --body-file <path.json> [--upstream-url <url>] [--api-model <id>] [--api-key <secret>|--api-key-file <path>] [--json] [-bd value]
  kweaver model llm   chat <model_id> (-m|--message) "text" [--model-name <registry_model_name>] [--skip-model-name-resolve] [--stream] [--no-stream] [--verbose] [--temperature N] [--max-tokens N] [--mf-api-base-url url] [-bd value]
  kweaver model llm   --template [--json]                     (offline: bundled llm registration JSON stub)

  kweaver model small list [--name X] [--type embedding|reranker] [--series S] [--page N] [--limit N] [--json] [-bd value]
  kweaver model small get <model_id> [--json] [-bd value]
  kweaver model small add --name N --type embedding|reranker --batch-size N
                        (--model-config-file <path.json> | --adapter --adapter-code-file <path.py>)
                        [--upstream-url <url>] [--api-model <id>] [--api-key <secret>|--api-key-file <path>]
                        [--max-tokens N] [--embedding-dim N] [--json] [-bd value]
                        (embedding requires --max-tokens and --embedding-dim; upstream flags merge into model_config.api_* — not valid with --adapter)
  kweaver model small edit <model_id> [--body-file <path.json> | partial flags]
                        (without --body-file: loads current model via GET, then applies only the flags you pass)
  kweaver model small delete <model_id> [<model_id> ...] [-y] [-bd value]
  kweaver model small test [--body-file <path.json>|<model_id>] [--json] [-bd value]
  kweaver model small embeddings <model_id> (-i|--input <text>) ... [--model-name <registry_model_name>] [--skip-model-name-resolve] [--mf-api-base-url url] [-bd value]
                        (runtime: POST mf-model-api /small-model/embeddings — like llm chat for vectors)
  kweaver model small rerank <model_id> (-q|--query) <text> (-d|--document <text>) ... [--model-name <registry_model_name>] [--skip-model-name-resolve] [--mf-api-base-url url] [-bd value]
                        (runtime: POST mf-model-api /small-model/reranker)
  kweaver model small --template [--json]                   (offline: bundled small model_config JSON stub)

Global:
  --mf-base-url <url>       Override origin for mf-model-manager (default: KWEAVER_BASE_URL or KWEAVER_MF_MODEL_MANAGER_URL)
  --mf-api-base-url <url>   Override origin for mf-model-api / chat (default: KWEAVER_BASE_URL or KWEAVER_MF_MODEL_API_URL)
  -bd, --biz-domain        Business domain (default from config)

Upstream secrets:
  Prefer --api-key-file over --api-key (shell history). For LLM add/edit/test, flags merge into body.model_config as api_url, api_model, api_key (creating model_config if missing). Small-model upstream flags merge into model_config the same way.

Bundled templates:
  model llm --template | model small --template — print offline JSON stub (no auth).`);
}

async function printBundledModelBranchTemplate(branch: "llm" | "small", g: ModelGlobalParse): Promise<number> {
  try {
    const text = await readBundledModelTemplateFile(branch, "basic");
    console.log(formatCallOutput(text, g.pretty));
    return 0;
  } catch (e) {
    console.error(e instanceof Error ? e.message : String(e));
    return 1;
  }
}

function confirmYes(prompt: string): Promise<boolean> {
  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    rl.question(`${prompt} [y/N] `, (answer) => {
      rl.close();
      const t = answer.trim().toLowerCase();
      resolve(t === "y" || t === "yes");
    });
  });
}

async function readJsonBodyFile(path: string): Promise<Record<string, unknown>> {
  const raw = await readFile(path, "utf-8");
  return JSON.parse(raw) as Record<string, unknown>;
}

async function readApiKeyCredential(flags: { apiKey?: string; apiKeyFile?: string }): Promise<string> {
  const inline = flags.apiKey ?? "";
  const path = flags.apiKeyFile ?? "";
  if (inline && path) {
    throw new Error("Use only one of --api-key or --api-key-file.");
  }
  if (path) {
    return (await readFile(path, "utf-8")).trim();
  }
  return inline;
}

/** Merge cloud upstream settings into small-model ``model_config`` (api_url / api_model / api_key). */
function mergeUpstreamIntoSmallModelConfig(
  mc: Record<string, unknown>,
  upstreamUrl: string | undefined,
  apiModel: string | undefined,
  apiKeyPlain: string,
): void {
  if (upstreamUrl) mc.api_url = upstreamUrl;
  if (apiModel) mc.api_model = apiModel;
  if (apiKeyPlain) mc.api_key = apiKeyPlain;
}

async function mergeUpstreamIntoLlmModelConfig(
  body: Record<string, unknown>,
  opts: { upstreamUrl?: string; apiModel?: string; apiKey?: string; apiKeyFile?: string },
): Promise<void> {
  let mc = body.model_config;
  if (!mc || typeof mc !== "object" || Array.isArray(mc)) {
    mc = {};
    body.model_config = mc;
  }
  const key = await readApiKeyCredential(opts);
  mergeUpstreamIntoSmallModelConfig(mc as Record<string, unknown>, opts.upstreamUrl, opts.apiModel, key);
}

async function readLlmJsonBodyWithUpstreamMerge(tail: string[], verb: string): Promise<Record<string, unknown>> {
  let bodyFile = "";
  const uf: { upstreamUrl?: string; apiModel?: string; apiKey?: string; apiKeyFile?: string } = {};
  for (let i = 0; i < tail.length; i += 1) {
    const a = tail[i];
    if ((a === "--body-file" || a === "-f") && tail[i + 1]) {
      bodyFile = tail[++i];
      continue;
    }
    if ((a === "--upstream-url" || a === "--api-url") && tail[i + 1]) {
      uf.upstreamUrl = tail[++i];
      continue;
    }
    if (a === "--api-model" && tail[i + 1]) {
      uf.apiModel = tail[++i];
      continue;
    }
    if (a === "--api-key" && tail[i + 1]) {
      uf.apiKey = tail[++i];
      continue;
    }
    if ((a === "--api-key-file" || a === "--secret-file") && tail[i + 1]) {
      uf.apiKeyFile = tail[++i];
      continue;
    }
    throw new Error(`Unknown flag for model llm ${verb}: ${a}`);
  }
  if (!bodyFile) {
    throw new Error(`kweaver model llm ${verb} requires --body-file <path.json>`);
  }
  const body = await readJsonBodyFile(bodyFile);
  await mergeUpstreamIntoLlmModelConfig(body, uf);
  return body;
}

function tailHasLlmBodyFileFlag(tail: string[]): boolean {
  for (let i = 0; i < tail.length; i += 1) {
    const a = tail[i];
    if ((a === "--body-file" || a === "-f") && tail[i + 1]) return true;
  }
  return false;
}

/** Sparse flags for model llm edit (after leading model_id). Exported for unit tests. */
export interface ParsedLlmSparseEditFlags {
  name?: string;
  modelSeries?: string;
  modelType?: string;
  maxModelLen?: number;
  quota?: boolean;
  modelConfigFile?: string;
  upstreamUrl?: string;
  apiModel?: string;
  apiKey?: string;
  apiKeyFile?: string;
}

/** Exported for unit tests. */
export function parsedLlmSparseEditHasUpdates(p: ParsedLlmSparseEditFlags): boolean {
  return (
    p.name !== undefined ||
    p.modelSeries !== undefined ||
    p.modelType !== undefined ||
    p.maxModelLen !== undefined ||
    p.quota !== undefined ||
    p.modelConfigFile !== undefined ||
    p.upstreamUrl !== undefined ||
    p.apiModel !== undefined ||
    p.apiKey !== undefined ||
    p.apiKeyFile !== undefined
  );
}

/** Exported for unit tests. */
export function parseLlmSparseEditFlags(tail: string[]): ParsedLlmSparseEditFlags {
  const o: ParsedLlmSparseEditFlags = {};
  for (let i = 0; i < tail.length; i += 1) {
    const a = tail[i];
    if (a === "--name" && tail[i + 1]) {
      o.name = tail[++i];
      continue;
    }
    if (a === "--series" && tail[i + 1]) {
      o.modelSeries = tail[++i];
      continue;
    }
    if ((a === "--type" || a === "-t") && tail[i + 1]) {
      o.modelType = tail[++i];
      continue;
    }
    if (a === "--max-model-len" && tail[i + 1]) {
      const n = Number(tail[++i]);
      if (!Number.isFinite(n)) {
        throw new Error("--max-model-len must be a finite number.");
      }
      o.maxModelLen = n;
      continue;
    }
    if (a === "--quota") {
      const v = tail[i + 1];
      if (v === "true" || v === "1") {
        o.quota = true;
        i += 1;
      } else if (v === "false" || v === "0") {
        o.quota = false;
        i += 1;
      } else {
        o.quota = true;
      }
      continue;
    }
    if ((a === "--model-config-file" || a === "--config-file") && tail[i + 1]) {
      o.modelConfigFile = tail[++i];
      continue;
    }
    if ((a === "--upstream-url" || a === "--api-url") && tail[i + 1]) {
      o.upstreamUrl = tail[++i];
      continue;
    }
    if (a === "--api-model" && tail[i + 1]) {
      o.apiModel = tail[++i];
      continue;
    }
    if (a === "--api-key" && tail[i + 1]) {
      o.apiKey = tail[++i];
      continue;
    }
    if ((a === "--api-key-file" || a === "--secret-file") && tail[i + 1]) {
      o.apiKeyFile = tail[++i];
      continue;
    }
    throw new Error(`Unknown flag for model llm edit: ${a}`);
  }
  return o;
}

/**
 * Normalize GET /llm/get JSON into a body suitable for POST /llm/edit.
 * Exported for unit tests.
 */
export function llmModelGetToEditBase(raw: unknown): Record<string, unknown> {
  if (!raw || typeof raw !== "object") {
    throw new Error("llm/get returned invalid response.");
  }
  const obj = raw as Record<string, unknown>;
  const mid = obj.model_id;
  if (mid == null || String(mid).trim() === "") {
    throw new Error("llm/get response missing model_id.");
  }
  const mcRaw = obj.model_config;
  const modelConfig =
    mcRaw != null && typeof mcRaw === "object" && !Array.isArray(mcRaw)
      ? { ...(mcRaw as Record<string, unknown>) }
      : {};
  const out: Record<string, unknown> = {
    ...obj,
    model_id: String(mid),
    model_config: modelConfig,
  };

  // GET /llm/get sometimes omits `quota`; mf-model-manager edit handler expects it (KeyError otherwise).
  const q = out.quota;
  if (q === undefined || q === null) {
    out.quota = false;
  } else if (typeof q === "number") {
    out.quota = q !== 0;
  } else if (typeof q === "string") {
    const s = q.trim().toLowerCase();
    out.quota = s === "true" || s === "1";
  }

  return out;
}

/** Apply sparse llm edit flags onto a normalized record from GET. Exported for unit tests. */
export async function mergeLlmEditOntoExistingBase(
  base: Record<string, unknown>,
  p: ParsedLlmSparseEditFlags,
): Promise<Record<string, unknown>> {
  const out: Record<string, unknown> = {
    ...base,
    model_config:
      base.model_config != null &&
      typeof base.model_config === "object" &&
      !Array.isArray(base.model_config)
        ? { ...(base.model_config as Record<string, unknown>) }
        : {},
  };

  if (p.name !== undefined) out.model_name = p.name;
  if (p.modelSeries !== undefined) out.model_series = p.modelSeries;
  if (p.modelType !== undefined) out.model_type = p.modelType;
  if (p.maxModelLen !== undefined) out.max_model_len = p.maxModelLen;
  if (p.quota !== undefined) out.quota = p.quota;

  const wantsMc =
    p.modelConfigFile !== undefined ||
    p.upstreamUrl !== undefined ||
    p.apiModel !== undefined ||
    p.apiKey !== undefined ||
    p.apiKeyFile !== undefined;

  if (wantsMc) {
    const mc = out.model_config as Record<string, unknown>;
    if (p.modelConfigFile) {
      const rawJson = await readFile(p.modelConfigFile, "utf-8");
      Object.assign(mc, JSON.parse(rawJson) as Record<string, unknown>);
    }
    const apiKeyPlain = await readApiKeyCredential(p);
    mergeUpstreamIntoSmallModelConfig(mc, p.upstreamUrl, p.apiModel, apiKeyPlain);
    out.model_config = mc;
  }

  return out;
}

async function mergeLlmEditFromPartialFlags(
  modelId: string,
  p: ParsedLlmSparseEditFlags,
  mfOpts: {
    baseUrl: string;
    accessToken: string;
    businessDomain?: string;
    mfManagerBaseUrl?: string;
  },
): Promise<Record<string, unknown>> {
  const raw = await getLlmModel({ ...mfOpts, modelId });
  const base = llmModelGetToEditBase(raw);
  if (String(base.model_id) !== String(modelId)) {
    base.model_id = modelId;
  }
  return mergeLlmEditOntoExistingBase(base, p);
}

async function runLlmList(g: ModelGlobalParse, tail: string[]): Promise<number> {
  let keyword = "";
  let type = "";
  let series = "all";
  let apiModel = "";
  let page = 1;
  let limit = DEFAULT_LIST_LIMIT;
  let quota: boolean | undefined;

  for (let i = 0; i < tail.length; i += 1) {
    const a = tail[i];
    if ((a === "--keyword" || a === "-k") && tail[i + 1]) {
      keyword = tail[++i];
      continue;
    }
    if ((a === "--type" || a === "-t") && tail[i + 1]) {
      type = tail[++i];
      continue;
    }
    if (a === "--series" && tail[i + 1]) {
      series = tail[++i];
      continue;
    }
    if (a === "--api-model" && tail[i + 1]) {
      apiModel = tail[++i];
      continue;
    }
    if (a === "--page" && tail[i + 1]) {
      page = Math.max(1, Number(tail[++i]) || 1);
      continue;
    }
    if (a === "--limit" && tail[i + 1]) {
      limit = Math.max(1, Number(tail[++i]) || DEFAULT_LIST_LIMIT);
      continue;
    }
    if (a === "--quota") {
      const v = tail[i + 1];
      if (v === "true" || v === "1") {
        quota = true;
        i += 1;
      } else if (v === "false" || v === "0") {
        quota = false;
        i += 1;
      } else {
        quota = true;
      }
      continue;
    }
    console.error(`Unknown flag for model llm list: ${a}`);
    return 1;
  }

  const token = await ensureValidToken();
  const data = await listLlmModels({
    baseUrl: token.baseUrl,
    accessToken: token.accessToken,
    businessDomain: g.businessDomain,
    mfManagerBaseUrl: g.mfManagerBaseUrl,
    page,
    size: limit,
    name: keyword,
    modelType: type,
    series,
    apiModel,
    quota,
  });
  console.log(formatCallOutput(JSON.stringify(data), g.pretty));
  return 0;
}

async function runSmallList(g: ModelGlobalParse, tail: string[]): Promise<number> {
  let modelName = "";
  let modelType = "";
  let modelSeries = "";
  let page = 1;
  let limit = DEFAULT_LIST_LIMIT;

  for (let i = 0; i < tail.length; i += 1) {
    const a = tail[i];
    if ((a === "--name" || a === "--keyword" || a === "-k") && tail[i + 1]) {
      modelName = tail[++i];
      continue;
    }
    if ((a === "--type" || a === "-t") && tail[i + 1]) {
      modelType = tail[++i];
      continue;
    }
    if (a === "--series" && tail[i + 1]) {
      modelSeries = tail[++i];
      continue;
    }
    if (a === "--page" && tail[i + 1]) {
      page = Math.max(1, Number(tail[++i]) || 1);
      continue;
    }
    if (a === "--limit" && tail[i + 1]) {
      limit = Math.max(1, Number(tail[++i]) || DEFAULT_LIST_LIMIT);
      continue;
    }
    console.error(`Unknown flag for model small list: ${a}`);
    return 1;
  }

  const token = await ensureValidToken();
  const data = await listSmallModels({
    baseUrl: token.baseUrl,
    accessToken: token.accessToken,
    businessDomain: g.businessDomain,
    mfManagerBaseUrl: g.mfManagerBaseUrl,
    page,
    size: limit,
    modelName,
    modelType,
    modelSeries,
  });
  console.log(formatCallOutput(JSON.stringify(data), g.pretty));
  return 0;
}

async function runLlmGet(g: ModelGlobalParse, tail: string[]): Promise<number> {
  const id = tail[0];
  if (!id || id.startsWith("-")) {
    console.error("Usage: kweaver model llm get <model_id>");
    return 1;
  }
  const token = await ensureValidToken();
  const data = await getLlmModel({
    baseUrl: token.baseUrl,
    accessToken: token.accessToken,
    businessDomain: g.businessDomain,
    mfManagerBaseUrl: g.mfManagerBaseUrl,
    modelId: id,
  });
  console.log(formatCallOutput(JSON.stringify(data), g.pretty));
  return 0;
}

async function runSmallGet(g: ModelGlobalParse, tail: string[]): Promise<number> {
  const id = tail[0];
  if (!id || id.startsWith("-")) {
    console.error("Usage: kweaver model small get <model_id>");
    return 1;
  }
  const token = await ensureValidToken();
  const data = await getSmallModel({
    baseUrl: token.baseUrl,
    accessToken: token.accessToken,
    businessDomain: g.businessDomain,
    mfManagerBaseUrl: g.mfManagerBaseUrl,
    modelId: id,
  });
  console.log(formatCallOutput(JSON.stringify(data), g.pretty));
  return 0;
}

async function runLlmAdd(g: ModelGlobalParse, tail: string[]): Promise<number> {
  let body: Record<string, unknown>;
  try {
    body = await readLlmJsonBodyWithUpstreamMerge(tail, "add");
  } catch (e) {
    console.error(e instanceof Error ? e.message : String(e));
    return 1;
  }
  const token = await ensureValidToken();
  const data = await addLlmModel({
    baseUrl: token.baseUrl,
    accessToken: token.accessToken,
    businessDomain: g.businessDomain,
    mfManagerBaseUrl: g.mfManagerBaseUrl,
    body,
  });
  console.log(formatCallOutput(JSON.stringify(data), g.pretty));
  return 0;
}

async function runLlmEdit(g: ModelGlobalParse, tail: string[]): Promise<number> {
  const token = await ensureValidToken();
  const mfOpts = {
    baseUrl: token.baseUrl,
    accessToken: token.accessToken,
    businessDomain: g.businessDomain,
    mfManagerBaseUrl: g.mfManagerBaseUrl,
  };

  let body: Record<string, unknown>;
  try {
    if (tailHasLlmBodyFileFlag(tail)) {
      let slice = tail;
      let forcedModelId: string | undefined;
      if (tail[0] && !tail[0].startsWith("-")) {
        forcedModelId = tail[0];
        slice = tail.slice(1);
      }
      body = await readLlmJsonBodyWithUpstreamMerge(slice, "edit");
      if (forcedModelId) body.model_id = forcedModelId;
    } else {
      const modelId = tail[0];
      if (!modelId || modelId.startsWith("-")) {
        console.error(
          "Usage: kweaver model llm edit <model_id> [sparse flags] | [--body-file <path.json> ...] (see kweaver model --help)",
        );
        return 1;
      }
      const parsed = parseLlmSparseEditFlags(tail.slice(1));
      if (!parsedLlmSparseEditHasUpdates(parsed)) {
        throw new Error(
          "llm edit: pass --body-file or at least one of --name, --series, --type, --max-model-len, --quota, --model-config-file, --upstream-url, --api-model, --api-key/--api-key-file",
        );
      }
      body = await mergeLlmEditFromPartialFlags(modelId, parsed, mfOpts);
    }
  } catch (e) {
    console.error(e instanceof Error ? e.message : String(e));
    return 1;
  }

  const data = await editLlmModel({
    ...mfOpts,
    body,
  });
  console.log(formatCallOutput(JSON.stringify(data), g.pretty));
  return 0;
}

async function runLlmTest(g: ModelGlobalParse, tail: string[]): Promise<number> {
  let body: Record<string, unknown>;
  try {
    body = await readLlmJsonBodyWithUpstreamMerge(tail, "test");
  } catch (e) {
    console.error(e instanceof Error ? e.message : String(e));
    return 1;
  }
  const token = await ensureValidToken();
  const data = await testLlmModel({
    baseUrl: token.baseUrl,
    accessToken: token.accessToken,
    businessDomain: g.businessDomain,
    mfManagerBaseUrl: g.mfManagerBaseUrl,
    body,
  });
  console.log(formatCallOutput(JSON.stringify(data), g.pretty));
  return 0;
}

async function runLlmDelete(g: ModelGlobalParse, tail: string[]): Promise<number> {
  let skipConfirm = false;
  const ids: string[] = [];
  for (const a of tail) {
    if (a === "-y" || a === "--yes") {
      skipConfirm = true;
      continue;
    }
    if (!a.startsWith("-")) ids.push(a);
  }
  if (ids.length === 0) {
    console.error("Usage: kweaver model llm delete <model_id> [...] [-y]");
    return 1;
  }
  if (!skipConfirm) {
    const ok = await confirmYes(`Delete LLM model(s) ${ids.join(", ")}?`);
    if (!ok) {
      console.error("Cancelled.");
      return 1;
    }
  }
  const token = await ensureValidToken();
  const data = await deleteLlmModels({
    baseUrl: token.baseUrl,
    accessToken: token.accessToken,
    businessDomain: g.businessDomain,
    mfManagerBaseUrl: g.mfManagerBaseUrl,
    modelIds: ids,
  });
  console.log(formatCallOutput(JSON.stringify(data), g.pretty));
  return 0;
}

/**
 * Returns registry **model_name** from ``GET /llm/get`` JSON when present. Exported for unit tests.
 */
export function llmGetRecordModelName(raw: unknown): string {
  if (!raw || typeof raw !== "object") return "";
  const mn = (raw as Record<string, unknown>).model_name;
  return typeof mn === "string" && mn.trim().length > 0 ? mn.trim() : "";
}

/** Registry **model_name** from ``GET /small-model/get``. Exported for unit tests. */
export function smallGetRecordModelName(raw: unknown): string {
  if (!raw || typeof raw !== "object") return "";
  const mn = (raw as Record<string, unknown>).model_name;
  return typeof mn === "string" && mn.trim().length > 0 ? mn.trim() : "";
}

async function runLlmChat(g: ModelGlobalParse, tail: string[]): Promise<number> {
  const modelId = tail[0];
  if (!modelId || modelId.startsWith("-")) {
    console.error(
      'Usage: kweaver model llm chat <model_id> (-m|--message) "text" [--model-name <registry_model_name>] [--skip-model-name-resolve] ...',
    );
    return 1;
  }
  let message = "";
  let registryModelName = "";
  let skipModelNameResolve = false;
  let stream = true;
  let verbose = false;
  let temperature: number | undefined;
  let maxTokens: number | undefined;
  for (let i = 1; i < tail.length; i += 1) {
    const a = tail[i];
    if ((a === "--model-name" || a === "--register-name") && tail[i + 1]) {
      registryModelName = tail[++i];
      continue;
    }
    if (a === "--skip-model-name-resolve") {
      skipModelNameResolve = true;
      continue;
    }
    if ((a === "-m" || a === "--message") && tail[i + 1]) {
      message = tail[++i];
      continue;
    }
    if (a === "--stream") {
      stream = true;
      continue;
    }
    if (a === "--no-stream") {
      stream = false;
      continue;
    }
    if (a === "--verbose" || a === "-v") {
      verbose = true;
      continue;
    }
    if (a === "--temperature" && tail[i + 1]) {
      temperature = Number(tail[++i]);
      continue;
    }
    if (a === "--max-tokens" && tail[i + 1]) {
      maxTokens = Number(tail[++i]);
      continue;
    }
    console.error(`Unknown flag for model llm chat: ${a}`);
    return 1;
  }
  if (!message) {
    console.error("kweaver model llm chat requires -m / --message");
    return 1;
  }
  const token = await ensureValidToken();
  const mfManagerOpts = {
    baseUrl: token.baseUrl,
    accessToken: token.accessToken,
    businessDomain: g.businessDomain,
    mfManagerBaseUrl: g.mfManagerBaseUrl,
  };

  let resolvedModelName = registryModelName.trim();
  if (resolvedModelName.length === 0 && !skipModelNameResolve) {
    try {
      const raw = await getLlmModel({ ...mfManagerOpts, modelId });
      resolvedModelName = llmGetRecordModelName(raw);
    } catch (e) {
      console.error(e instanceof Error ? e.message : String(e));
      return 1;
    }
  }

  const result = await modelChatCompletions({
    baseUrl: token.baseUrl,
    accessToken: token.accessToken,
    businessDomain: g.businessDomain,
    mfApiBaseUrl: g.mfApiBaseUrl,
    modelId,
    ...(resolvedModelName.length > 0 ? { modelName: resolvedModelName } : {}),
    messages: [{ role: "user", content: message }],
    stream,
    temperature,
    maxTokens,
    verbose,
  });
  if (stream) {
    process.stdout.write(result.text);
    if (!result.text.endsWith("\n")) process.stdout.write("\n");
  } else {
    console.log(result.text);
  }
  return 0;
}

export interface ParsedSmallAddFlags {
  name?: string;
  modelType?: "embedding" | "reranker";
  batchSize?: number;
  maxTokens?: number;
  embeddingDim?: number;
  modelConfigFile?: string;
  adapter?: boolean;
  adapterCodeFile?: string;
  bodyFile?: string;
  /** Outbound HTTP API base or full path (stored in model_config.api_url). */
  upstreamUrl?: string;
  /** Third-party model id / deployment name (model_config.api_model). */
  apiModel?: string;
  /** Inline API secret — prefer --api-key-file (shell history risk). */
  apiKey?: string;
  apiKeyFile?: string;
}

/** True when sparse CLI flags should perform an edit (excluding --body-file). Exported for unit tests. */
export function parsedSmallFlagsHasEditUpdates(p: ParsedSmallAddFlags): boolean {
  return (
    p.name !== undefined ||
    p.modelType !== undefined ||
    p.batchSize !== undefined ||
    p.maxTokens !== undefined ||
    p.embeddingDim !== undefined ||
    p.modelConfigFile !== undefined ||
    p.adapter === true ||
    p.adapterCodeFile !== undefined ||
    p.upstreamUrl !== undefined ||
    p.apiModel !== undefined ||
    p.apiKey !== undefined ||
    p.apiKeyFile !== undefined
  );
}

function coerceFiniteNumber(value: unknown, label: string): number {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) {
    throw new Error(`${label} must be a finite number, got: ${String(value)}`);
  }
  return n;
}

/**
 * Normalize GET /small-model/get JSON into a body suitable for POST /small-model/edit.
 * Exported for unit tests.
 */
export function smallModelGetToEditBase(raw: unknown): Record<string, unknown> {
  if (!raw || typeof raw !== "object") {
    throw new Error("small-model/get returned invalid response.");
  }
  const o = raw as Record<string, unknown>;
  const mid = o.model_id;
  if (mid == null || String(mid).trim() === "") {
    throw new Error("small-model/get response missing model_id.");
  }

  const mcRaw = o.model_config;
  const mc =
    mcRaw != null && typeof mcRaw === "object" && !Array.isArray(mcRaw)
      ? { ...(mcRaw as Record<string, unknown>) }
      : {};

  const body: Record<string, unknown> = {
    model_id: String(mid),
    model_name: typeof o.model_name === "string" ? o.model_name : String(o.model_name ?? ""),
    model_type: typeof o.model_type === "string" ? o.model_type : String(o.model_type ?? ""),
    batch_size: coerceFiniteNumber(o.batch_size, "batch_size"),
    model_config: mc,
    adapter: o.adapter === true,
    adapter_code: typeof o.adapter_code === "string" ? o.adapter_code : "",
  };

  if (o.max_tokens != null && String(o.max_tokens) !== "") {
    body.max_tokens = coerceFiniteNumber(o.max_tokens, "max_tokens");
  }
  if (o.embedding_dim != null && String(o.embedding_dim) !== "") {
    body.embedding_dim = coerceFiniteNumber(o.embedding_dim, "embedding_dim");
  }

  return body;
}

/**
 * Apply sparse edit flags onto a normalized small-model record (from GET). Exported for unit tests.
 */
export async function mergeSmallEditOntoExistingBase(
  base: Record<string, unknown>,
  p: ParsedSmallAddFlags,
): Promise<Record<string, unknown>> {
  const out: Record<string, unknown> = {
    ...base,
    model_config:
      base.model_config != null &&
      typeof base.model_config === "object" &&
      !Array.isArray(base.model_config)
        ? { ...(base.model_config as Record<string, unknown>) }
        : {},
  };

  delete out.change;

  if (p.name !== undefined) out.model_name = p.name;
  if (p.modelType !== undefined) out.model_type = p.modelType;
  if (p.batchSize !== undefined) out.batch_size = p.batchSize;
  if (p.maxTokens !== undefined) out.max_tokens = p.maxTokens;
  if (p.embeddingDim !== undefined) out.embedding_dim = p.embeddingDim;

  const existingAdapter = base.adapter === true;

  const wantsConfigInputs =
    p.modelConfigFile !== undefined ||
    p.upstreamUrl !== undefined ||
    p.apiModel !== undefined ||
    p.apiKey !== undefined ||
    p.apiKeyFile !== undefined;

  const wantsAdapterInputs = p.adapter === true || p.adapterCodeFile !== undefined;

  if (existingAdapter && wantsConfigInputs) {
    throw new Error(
      "This small model uses adapter mode; use --adapter-code-file to replace code, or --body-file for a full JSON body. Upstream flags and --model-config-file are not merged for adapter models.",
    );
  }

  if (wantsAdapterInputs) {
    if (existingAdapter) {
      if (p.adapterCodeFile) {
        out.adapter = true;
        out.adapter_code = await readFile(p.adapterCodeFile, "utf-8");
      }
      return out;
    }
    if (!p.adapterCodeFile) {
      throw new Error("small edit: switching to adapter mode requires --adapter-code-file (Python source).");
    }
    out.adapter = true;
    out.adapter_code = await readFile(p.adapterCodeFile, "utf-8");
    out.model_config = {};
    return out;
  }

  if (wantsConfigInputs) {
    const mc = out.model_config as Record<string, unknown>;
    if (p.modelConfigFile) {
      const rawJson = await readFile(p.modelConfigFile, "utf-8");
      Object.assign(mc, JSON.parse(rawJson) as Record<string, unknown>);
    }
    const apiKeyPlain = await readApiKeyCredential(p);
    mergeUpstreamIntoSmallModelConfig(mc, p.upstreamUrl, p.apiModel, apiKeyPlain);
    out.model_config = mc;
    out.adapter = false;
    out.adapter_code = "";
    if (apiKeyPlain.length > 0) out.change = true;
    return out;
  }

  return out;
}

async function mergeSmallEditFromPartialFlags(
  modelId: string,
  p: ParsedSmallAddFlags,
  mfOpts: {
    baseUrl: string;
    accessToken: string;
    businessDomain?: string;
    mfManagerBaseUrl?: string;
  },
): Promise<Record<string, unknown>> {
  const raw = await getSmallModel({ ...mfOpts, modelId });
  const base = smallModelGetToEditBase(raw);
  if (String(base.model_id) !== String(modelId)) {
    base.model_id = modelId;
  }
  return mergeSmallEditOntoExistingBase(base, p);
}

/** Parse small-model add/edit flags from argv tail (after action). Exported for unit tests. */
export function parseSmallAddFlags(tail: string[]): ParsedSmallAddFlags {
  const o: ParsedSmallAddFlags = {};
  for (let i = 0; i < tail.length; i += 1) {
    const a = tail[i];
    if (a === "--name" && tail[i + 1]) {
      o.name = tail[++i];
      continue;
    }
    if (a === "--type" && tail[i + 1]) {
      const t = tail[++i];
      if (t !== "embedding" && t !== "reranker") {
        throw new Error(`--type must be embedding or reranker, got: ${t}`);
      }
      o.modelType = t;
      continue;
    }
    if (a === "--batch-size" && tail[i + 1]) {
      o.batchSize = Number(tail[++i]);
      continue;
    }
    if (a === "--max-tokens" && tail[i + 1]) {
      o.maxTokens = Number(tail[++i]);
      continue;
    }
    if (a === "--embedding-dim" && tail[i + 1]) {
      o.embeddingDim = Number(tail[++i]);
      continue;
    }
    if ((a === "--model-config-file" || a === "--config-file") && tail[i + 1]) {
      o.modelConfigFile = tail[++i];
      continue;
    }
    if (a === "--adapter") {
      o.adapter = true;
      continue;
    }
    if ((a === "--adapter-code-file" || a === "--code-file") && tail[i + 1]) {
      o.adapterCodeFile = tail[++i];
      continue;
    }
    if ((a === "--upstream-url" || a === "--api-url") && tail[i + 1]) {
      o.upstreamUrl = tail[++i];
      continue;
    }
    if (a === "--api-model" && tail[i + 1]) {
      o.apiModel = tail[++i];
      continue;
    }
    if (a === "--api-key" && tail[i + 1]) {
      o.apiKey = tail[++i];
      continue;
    }
    if ((a === "--api-key-file" || a === "--secret-file") && tail[i + 1]) {
      o.apiKeyFile = tail[++i];
      continue;
    }
    if ((a === "--body-file" || a === "-f") && tail[i + 1]) {
      o.bodyFile = tail[++i];
      continue;
    }
    throw new Error(`Unknown flag for small model: ${a}`);
  }
  return o;
}

export async function buildSmallBodyFromFlags(p: ParsedSmallAddFlags, modelId?: string): Promise<Record<string, unknown>> {
  if (p.bodyFile) {
    return readJsonBodyFile(p.bodyFile);
  }
  if (!p.name || !p.modelType || p.batchSize == null || Number.isNaN(p.batchSize)) {
    throw new Error("small add/edit requires --name, --type, --batch-size or --body-file");
  }
  const body: Record<string, unknown> = {
    model_name: p.name,
    model_type: p.modelType,
    batch_size: p.batchSize,
  };
  if (modelId) body.model_id = modelId;
  if (p.modelType === "embedding") {
    if (p.maxTokens == null || p.embeddingDim == null) {
      throw new Error("embedding type requires --max-tokens and --embedding-dim");
    }
    body.max_tokens = p.maxTokens;
    body.embedding_dim = p.embeddingDim;
  }
  if (p.adapter) {
    if (p.upstreamUrl || p.apiModel || p.apiKey || p.apiKeyFile) {
      throw new Error(
        "Upstream flags (--upstream-url, --api-model, --api-key/--api-key-file) cannot be used with --adapter. Use direct config (--model-config-file with optional upstream flags, or only upstream flags), or embed URL/key inside adapter_code.",
      );
    }
    if (!p.adapterCodeFile) throw new Error("--adapter requires --adapter-code-file");
    const code = await readFile(p.adapterCodeFile, "utf-8");
    body.adapter = true;
    body.adapter_code = code;
    return body;
  }

  const apiKeyPlain = await readApiKeyCredential(p);
  const mc: Record<string, unknown> = {};
  if (p.modelConfigFile) {
    const raw = await readFile(p.modelConfigFile, "utf-8");
    Object.assign(mc, JSON.parse(raw) as Record<string, unknown>);
  }
  mergeUpstreamIntoSmallModelConfig(mc, p.upstreamUrl, p.apiModel, apiKeyPlain);
  if (Object.keys(mc).length === 0) {
    throw new Error(
      "Provide --model-config-file and/or --upstream-url with --api-key or --api-key-file (and usually --api-model) for cloud-hosted small models.",
    );
  }
  body.model_config = mc;
  body.adapter = false;
  return body;
}

async function runSmallAdd(g: ModelGlobalParse, tail: string[]): Promise<number> {
  let parsed: ParsedSmallAddFlags;
  try {
    parsed = parseSmallAddFlags(tail);
  } catch (e) {
    console.error(e instanceof Error ? e.message : String(e));
    return 1;
  }
  let body: Record<string, unknown>;
  try {
    body = await buildSmallBodyFromFlags(parsed);
  } catch (e) {
    console.error(e instanceof Error ? e.message : String(e));
    return 1;
  }
  const token = await ensureValidToken();
  const data = await addSmallModel({
    baseUrl: token.baseUrl,
    accessToken: token.accessToken,
    businessDomain: g.businessDomain,
    mfManagerBaseUrl: g.mfManagerBaseUrl,
    body,
  });
  console.log(formatCallOutput(JSON.stringify(data), g.pretty));
  return 0;
}

async function runSmallEdit(g: ModelGlobalParse, tail: string[]): Promise<number> {
  const modelId = tail[0];
  if (!modelId || modelId.startsWith("-")) {
    console.error("Usage: kweaver model small edit <model_id> [--body-file ... | flags...]");
    return 1;
  }
  let parsed: ParsedSmallAddFlags;
  try {
    parsed = parseSmallAddFlags(tail.slice(1));
  } catch (e) {
    console.error(e instanceof Error ? e.message : String(e));
    return 1;
  }
  const token = await ensureValidToken();
  const mfOpts = {
    baseUrl: token.baseUrl,
    accessToken: token.accessToken,
    businessDomain: g.businessDomain,
    mfManagerBaseUrl: g.mfManagerBaseUrl,
  };
  let body: Record<string, unknown>;
  try {
    if (parsed.bodyFile) {
      body = await readJsonBodyFile(parsed.bodyFile);
      body.model_id = modelId;
    } else if (!parsedSmallFlagsHasEditUpdates(parsed)) {
      throw new Error(
        "small edit: pass --body-file or at least one of --name, --type, --batch-size, --max-tokens, --embedding-dim, --model-config-file, --adapter/--adapter-code-file, --upstream-url, --api-model, --api-key/--api-key-file",
      );
    } else {
      body = await mergeSmallEditFromPartialFlags(modelId, parsed, mfOpts);
    }
  } catch (e) {
    console.error(e instanceof Error ? e.message : String(e));
    return 1;
  }
  const data = await editSmallModel({
    ...mfOpts,
    body,
  });
  console.log(formatCallOutput(JSON.stringify(data), g.pretty));
  return 0;
}

async function runSmallDelete(g: ModelGlobalParse, tail: string[]): Promise<number> {
  let skipConfirm = false;
  const ids: string[] = [];
  for (const a of tail) {
    if (a === "-y" || a === "--yes") {
      skipConfirm = true;
      continue;
    }
    if (!a.startsWith("-")) ids.push(a);
  }
  if (ids.length === 0) {
    console.error("Usage: kweaver model small delete <model_id> [...] [-y]");
    return 1;
  }
  if (!skipConfirm) {
    const ok = await confirmYes(`Delete small model(s) ${ids.join(", ")}?`);
    if (!ok) {
      console.error("Cancelled.");
      return 1;
    }
  }
  const token = await ensureValidToken();
  const data = await deleteSmallModels({
    baseUrl: token.baseUrl,
    accessToken: token.accessToken,
    businessDomain: g.businessDomain,
    mfManagerBaseUrl: g.mfManagerBaseUrl,
    modelIds: ids,
  });
  console.log(formatCallOutput(JSON.stringify(data), g.pretty));
  return 0;
}

async function runSmallTest(g: ModelGlobalParse, tail: string[]): Promise<number> {
  let bodyFile = "";
  const positional: string[] = [];
  for (let i = 0; i < tail.length; i += 1) {
    const a = tail[i];
    if ((a === "--body-file" || a === "-f") && tail[i + 1]) {
      bodyFile = tail[++i];
      continue;
    }
    if (a.startsWith("-")) {
      console.error(`Unknown flag for model small test: ${a}`);
      return 1;
    }
    positional.push(a);
  }
  let body: Record<string, unknown>;
  if (bodyFile) {
    body = await readJsonBodyFile(bodyFile);
  } else if (positional.length === 1) {
    body = { model_id: positional[0] };
  } else {
    console.error("Usage: kweaver model small test <model_id> | --body-file <path.json>");
    return 1;
  }
  const token = await ensureValidToken();
  const data = await testSmallModel({
    baseUrl: token.baseUrl,
    accessToken: token.accessToken,
    businessDomain: g.businessDomain,
    mfManagerBaseUrl: g.mfManagerBaseUrl,
    body,
  });
  console.log(formatCallOutput(JSON.stringify(data), g.pretty));
  return 0;
}

async function runSmallEmbeddings(g: ModelGlobalParse, tail: string[]): Promise<number> {
  const modelId = tail[0];
  if (!modelId || modelId.startsWith("-")) {
    console.error(
      'Usage: kweaver model small embeddings <model_id> (-i|--input <text>) ... [--model-name <registry_model_name>] [--skip-model-name-resolve]',
    );
    return 1;
  }
  const inputs: string[] = [];
  let registryModelName = "";
  let skipModelNameResolve = false;
  for (let i = 1; i < tail.length; i += 1) {
    const a = tail[i];
    if ((a === "--input" || a === "-i") && tail[i + 1]) {
      inputs.push(tail[++i]);
      continue;
    }
    if ((a === "--model-name" || a === "--register-name") && tail[i + 1]) {
      registryModelName = tail[++i];
      continue;
    }
    if (a === "--skip-model-name-resolve") {
      skipModelNameResolve = true;
      continue;
    }
    console.error(`Unknown flag for model small embeddings: ${a}`);
    return 1;
  }
  if (inputs.length === 0) {
    console.error("kweaver model small embeddings requires at least one -i / --input");
    return 1;
  }

  const token = await ensureValidToken();
  const mfManagerOpts = {
    baseUrl: token.baseUrl,
    accessToken: token.accessToken,
    businessDomain: g.businessDomain,
    mfManagerBaseUrl: g.mfManagerBaseUrl,
  };

  let resolvedModelName = registryModelName.trim();
  if (resolvedModelName.length === 0 && !skipModelNameResolve) {
    try {
      const raw = await getSmallModel({ ...mfManagerOpts, modelId });
      resolvedModelName = smallGetRecordModelName(raw);
    } catch (e) {
      console.error(e instanceof Error ? e.message : String(e));
      return 1;
    }
  }

  const data = await modelEmbeddings({
    baseUrl: token.baseUrl,
    accessToken: token.accessToken,
    businessDomain: g.businessDomain,
    mfApiBaseUrl: g.mfApiBaseUrl,
    modelId,
    ...(resolvedModelName.length > 0 ? { modelName: resolvedModelName } : {}),
    input: inputs,
  });
  console.log(formatCallOutput(JSON.stringify(data), g.pretty));
  return 0;
}

async function runSmallRerank(g: ModelGlobalParse, tail: string[]): Promise<number> {
  const modelId = tail[0];
  if (!modelId || modelId.startsWith("-")) {
    console.error(
      'Usage: kweaver model small rerank <model_id> (-q|--query) <text> (-d|--document <text>) ... [--model-name <registry_model_name>] [--skip-model-name-resolve]',
    );
    return 1;
  }
  let query = "";
  const documents: string[] = [];
  let registryModelName = "";
  let skipModelNameResolve = false;
  for (let i = 1; i < tail.length; i += 1) {
    const a = tail[i];
    if ((a === "--query" || a === "-q") && tail[i + 1]) {
      query = tail[++i];
      continue;
    }
    if ((a === "--document" || a === "-d") && tail[i + 1]) {
      documents.push(tail[++i]);
      continue;
    }
    if ((a === "--model-name" || a === "--register-name") && tail[i + 1]) {
      registryModelName = tail[++i];
      continue;
    }
    if (a === "--skip-model-name-resolve") {
      skipModelNameResolve = true;
      continue;
    }
    console.error(`Unknown flag for model small rerank: ${a}`);
    return 1;
  }
  if (!query) {
    console.error("kweaver model small rerank requires -q / --query");
    return 1;
  }
  if (documents.length === 0) {
    console.error("kweaver model small rerank requires at least one -d / --document");
    return 1;
  }

  const token = await ensureValidToken();
  const mfManagerOpts = {
    baseUrl: token.baseUrl,
    accessToken: token.accessToken,
    businessDomain: g.businessDomain,
    mfManagerBaseUrl: g.mfManagerBaseUrl,
  };

  let resolvedModelName = registryModelName.trim();
  if (resolvedModelName.length === 0 && !skipModelNameResolve) {
    try {
      const raw = await getSmallModel({ ...mfManagerOpts, modelId });
      resolvedModelName = smallGetRecordModelName(raw);
    } catch (e) {
      console.error(e instanceof Error ? e.message : String(e));
      return 1;
    }
  }

  const data = await modelRerank({
    baseUrl: token.baseUrl,
    accessToken: token.accessToken,
    businessDomain: g.businessDomain,
    mfApiBaseUrl: g.mfApiBaseUrl,
    modelId,
    ...(resolvedModelName.length > 0 ? { modelName: resolvedModelName } : {}),
    query,
    documents,
  });
  console.log(formatCallOutput(JSON.stringify(data), g.pretty));
  return 0;
}

export async function runModelCommand(args: string[]): Promise<number> {
  const g = parseModelGlobalFlags(args);
  const rest = g.rest;

  if (rest.length === 0 || rest[0] === "--help" || rest[0] === "-h") {
    printModelUsage();
    return 0;
  }

  const branch = rest[0];
  const action = rest[1];
  const tail = rest.slice(2);

  if (branch !== "llm" && branch !== "small") {
    console.error(`Unknown model branch: ${branch} (expected llm or small)`);
    printModelUsage();
    return 1;
  }

  if (!action || action === "--help" || action === "-h") {
    printModelUsage();
    return 0;
  }

  if (action === "--template") {
    if (tail.length > 0) {
      console.error(`Usage: kweaver model ${branch} --template`);
      return 1;
    }
    return printBundledModelBranchTemplate(branch, g);
  }

  const dispatch = async (): Promise<number> => {
    if (branch === "llm") {
      if (action === "list") return runLlmList(g, tail);
      if (action === "get") return runLlmGet(g, tail);
      if (action === "add") return runLlmAdd(g, tail);
      if (action === "edit") return runLlmEdit(g, tail);
      if (action === "test") return runLlmTest(g, tail);
      if (action === "delete") return runLlmDelete(g, tail);
      if (action === "chat") return runLlmChat(g, tail);
    } else {
      if (action === "list") return runSmallList(g, tail);
      if (action === "get") return runSmallGet(g, tail);
      if (action === "add") return runSmallAdd(g, tail);
      if (action === "edit") return runSmallEdit(g, tail);
      if (action === "test") return runSmallTest(g, tail);
      if (action === "embeddings") return runSmallEmbeddings(g, tail);
      if (action === "rerank") return runSmallRerank(g, tail);
      if (action === "delete") return runSmallDelete(g, tail);
    }
    console.error(`Unknown action: kweaver model ${branch} ${action}`);
    printModelUsage();
    return 1;
  };

  try {
    return await with401RefreshRetry(async () => dispatch());
  } catch (e) {
    console.error(formatHttpError(e));
    return 1;
  }
}
