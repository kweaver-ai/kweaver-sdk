import { buildHeaders } from "./headers.js";
import { HttpError } from "../utils/http.js";

export const MF_MODEL_MANAGER_PATH_PREFIX = "/api/mf-model-manager/v1";

export interface MfManagerBaseOptions {
  baseUrl: string;
  accessToken: string;
  businessDomain?: string;
  /**
   * Replace platform origin for mf-model-manager (still appends `/api/mf-model-manager/v1`).
   * Overrides `KWEAVER_MF_MODEL_MANAGER_URL` when set.
   */
  mfManagerBaseUrl?: string;
}

function resolveManagerOrigin(options: MfManagerBaseOptions): string {
  const env = process.env.KWEAVER_MF_MODEL_MANAGER_URL;
  const raw =
    options.mfManagerBaseUrl ?? (env && env.length > 0 ? env : undefined) ?? options.baseUrl;
  return raw.replace(/\/+$/, "");
}

function managerEndpoint(options: MfManagerBaseOptions, relPath: string): string {
  const origin = resolveManagerOrigin(options);
  const path = relPath.startsWith("/") ? relPath : `/${relPath}`;
  return `${origin}${MF_MODEL_MANAGER_PATH_PREFIX}${path}`;
}

async function fetchJson(
  url: string,
  accessToken: string,
  businessDomain: string,
  init: RequestInit
): Promise<unknown> {
  const headers = {
    ...buildHeaders(accessToken, businessDomain),
    ...((init.headers as Record<string, string>) ?? {}),
  };
  const response = await fetch(url, { ...init, headers });
  const text = await response.text();
  if (!response.ok) {
    throw new HttpError(response.status, response.statusText, text);
  }
  if (!text.trim()) return null;
  return JSON.parse(text) as unknown;
}

// ── Client-side validation (mirrors mf-model-manager mutual exclusion) ─────

/**
 * Ensure small-model request bodies do not combine direct `model_config` with adapter mode.
 */
export function assertSmallModelConfigAdapterExclusive(body: Record<string, unknown>): void {
  const cfg = body.model_config;
  const hasConfig =
    cfg != null &&
    typeof cfg === "object" &&
    !Array.isArray(cfg) &&
    Object.keys(cfg as Record<string, unknown>).length > 0;
  const adapter = body.adapter === true;
  const code = typeof body.adapter_code === "string" && body.adapter_code.length > 0;
  if (hasConfig && (adapter
    || code)) {
    throw new Error("model_config cannot be combined with adapter or adapter_code.");
  }
  if (!hasConfig && (!adapter
    || !code)) {
    throw new Error("Either model_config (non-empty) or adapter=true with adapter_code is required.");
  }
  if (adapter && !code) {
    throw new Error("adapter=true requires adapter_code.");
  }
}

/** For edit: validate mutual exclusion only when config or adapter fields are present. */
export function assertSmallModelEditBody(body: Record<string, unknown>): void {
  const cfg = body.model_config;
  const hasConfig =
    cfg != null &&
    typeof cfg === "object" &&
    !Array.isArray(cfg) &&
    Object.keys(cfg as Record<string, unknown>).length > 0;
  const adapter = body.adapter === true;
  const code = typeof body.adapter_code === "string" && body.adapter_code.length > 0;
  if (!hasConfig && !adapter && !code) {
    return;
  }
  assertSmallModelConfigAdapterExclusive(body);
}

// ── LLM ─────────────────────────────────────────────────────────────────────

export interface ListLlmModelsOptions extends MfManagerBaseOptions {
  page: number;
  size: number;
  order?: string;
  rule?: string;
  series?: string;
  name?: string;
  apiModel?: string;
  modelType?: string;
  quota?: boolean;
}

export async function listLlmModels(options: ListLlmModelsOptions): Promise<unknown> {
  const {
    accessToken,
    businessDomain = "bd_public",
    page,
    size,
    order = "desc",
    rule = "update_time",
    series = "all",
    name = "",
    apiModel = "",
    modelType = "",
    quota,
  } = options;
  const params = new URLSearchParams({
    page: String(page),
    size: String(size),
    order,
    rule,
    series,
    name,
    api_model: apiModel,
    model_type: modelType,
  });
  if (quota !== undefined) {
    params.set("quota", String(quota));
  }
  const url = `${managerEndpoint(options, "/llm/list")}?${params.toString()}`;
  return fetchJson(url, accessToken, businessDomain, { method: "GET" });
}

export interface GetLlmModelOptions extends MfManagerBaseOptions {
  modelId: string;
}

export async function getLlmModel(options: GetLlmModelOptions): Promise<unknown> {
  const { accessToken, businessDomain = "bd_public", modelId } = options;
  const params = new URLSearchParams({ model_id: modelId });
  const url = `${managerEndpoint(options, "/llm/get")}?${params.toString()}`;
  return fetchJson(url, accessToken, businessDomain, { method: "GET" });
}

export interface AddLlmModelOptions extends MfManagerBaseOptions {
  body: Record<string, unknown>;
}

export async function addLlmModel(options: AddLlmModelOptions): Promise<unknown> {
  const { accessToken, businessDomain = "bd_public", body } = options;
  const url = managerEndpoint(options, "/llm/add");
  return fetchJson(url, accessToken, businessDomain, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

export interface EditLlmModelOptions extends MfManagerBaseOptions {
  body: Record<string, unknown>;
}

export async function editLlmModel(options: EditLlmModelOptions): Promise<unknown> {
  const { accessToken, businessDomain = "bd_public", body } = options;
  const url = managerEndpoint(options, "/llm/edit");
  return fetchJson(url, accessToken, businessDomain, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

export interface DeleteLlmModelsOptions extends MfManagerBaseOptions {
  modelIds: string[];
}

export async function deleteLlmModels(options: DeleteLlmModelsOptions): Promise<unknown> {
  const { accessToken, businessDomain = "bd_public", modelIds } = options;
  const url = managerEndpoint(options, "/llm/delete");
  return fetchJson(url, accessToken, businessDomain, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ model_ids: modelIds }),
  });
}

export interface TestLlmModelOptions extends MfManagerBaseOptions {
  body: Record<string, unknown>;
}

export async function testLlmModel(options: TestLlmModelOptions): Promise<unknown> {
  const { accessToken, businessDomain = "bd_public", body } = options;
  const url = managerEndpoint(options, "/llm/test");
  return fetchJson(url, accessToken, businessDomain, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

// ── Small model ─────────────────────────────────────────────────────────────

export interface ListSmallModelsOptions extends MfManagerBaseOptions {
  page: number;
  size: number;
  order?: string;
  rule?: string;
  modelName?: string;
  modelType?: string;
  modelSeries?: string;
}

export async function listSmallModels(options: ListSmallModelsOptions): Promise<unknown> {
  const {
    accessToken,
    businessDomain = "bd_public",
    page,
    size,
    order = "desc",
    rule = "update_time",
    modelName = "",
    modelType = "",
    modelSeries = "",
  } = options;
  const params = new URLSearchParams({
    order,
    rule,
    page: String(page),
    size: String(size),
    model_name: modelName,
    model_type: modelType,
    model_series: modelSeries,
  });
  const url = `${managerEndpoint(options, "/small-model/list")}?${params.toString()}`;
  return fetchJson(url, accessToken, businessDomain, { method: "GET" });
}

export interface GetSmallModelOptions extends MfManagerBaseOptions {
  modelId: string;
}

export async function getSmallModel(options: GetSmallModelOptions): Promise<unknown> {
  const { accessToken, businessDomain = "bd_public", modelId } = options;
  const params = new URLSearchParams({ model_id: modelId });
  const url = `${managerEndpoint(options, "/small-model/get")}?${params.toString()}`;
  return fetchJson(url, accessToken, businessDomain, { method: "GET" });
}

export interface AddSmallModelOptions extends MfManagerBaseOptions {
  body: Record<string, unknown>;
}

export async function addSmallModel(options: AddSmallModelOptions): Promise<unknown> {
  assertSmallModelConfigAdapterExclusive(options.body);
  const { accessToken, businessDomain = "bd_public", body } = options;
  const url = managerEndpoint(options, "/small-model/add");
  return fetchJson(url, accessToken, businessDomain, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

export interface EditSmallModelOptions extends MfManagerBaseOptions {
  body: Record<string, unknown>;
}

export async function editSmallModel(options: EditSmallModelOptions): Promise<unknown> {
  assertSmallModelEditBody(options.body);
  const { accessToken, businessDomain = "bd_public", body } = options;
  const url = managerEndpoint(options, "/small-model/edit");
  return fetchJson(url, accessToken, businessDomain, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

export interface DeleteSmallModelsOptions extends MfManagerBaseOptions {
  modelIds: string[];
}

export async function deleteSmallModels(options: DeleteSmallModelsOptions): Promise<unknown> {
  const { accessToken, businessDomain = "bd_public", modelIds } = options;
  const url = managerEndpoint(options, "/small-model/delete");
  return fetchJson(url, accessToken, businessDomain, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ model_ids: modelIds }),
  });
}

export interface TestSmallModelOptions extends MfManagerBaseOptions {
  body: Record<string, unknown>;
}

export async function testSmallModel(options: TestSmallModelOptions): Promise<unknown> {
  const { accessToken, businessDomain = "bd_public", body } = options;
  const url = managerEndpoint(options, "/small-model/test");
  return fetchJson(url, accessToken, businessDomain, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}
