import { HttpError } from "../utils/http.js";
import { buildHeaders } from "./headers.js";
import { knUrl } from "./bkn-backend.js";
import type { BknBackendKnOptions } from "./bkn-backend.js";

async function readTextOrThrow(response: Response): Promise<string> {
  const text = await response.text();
  if (!response.ok) {
    throw new HttpError(response.status, response.statusText, text);
  }
  return text;
}

function appendSearchParams(
  url: URL,
  entries: Array<[string, string | number | boolean | undefined]>
): void {
  for (const [k, v] of entries) {
    if (v === undefined) continue;
    url.searchParams.set(k, String(v));
  }
}

export interface ListMetricsOptions extends BknBackendKnOptions {
  namePattern?: string;
  sort?: "update_time" | "name";
  direction?: "asc" | "desc";
  offset?: number;
  limit?: number;
  tag?: string;
  groupId?: string;
  branch?: string;
}

export async function listMetrics(options: ListMetricsOptions): Promise<string> {
  const {
    baseUrl,
    accessToken,
    knId,
    businessDomain = "bd_public",
    namePattern,
    sort,
    direction,
    offset,
    limit,
    tag,
    groupId,
    branch,
  } = options;
  const url = new URL(knUrl(baseUrl, knId, "metrics"));
  appendSearchParams(url, [
    ["name_pattern", namePattern],
    ["sort", sort],
    ["direction", direction],
    ["offset", offset],
    ["limit", limit],
    ["tag", tag],
    ["group_id", groupId],
    ["branch", branch],
  ]);
  const response = await fetch(url.toString(), {
    method: "GET",
    headers: buildHeaders(accessToken, businessDomain),
  });
  return readTextOrThrow(response);
}

export interface CreateMetricsOptions extends BknBackendKnOptions {
  body: string;
  branch?: string;
  strictMode?: boolean;
}

export async function createMetrics(options: CreateMetricsOptions): Promise<string> {
  return postWithMethodOverride(options, "POST");
}

export interface SearchMetricsOptions extends BknBackendKnOptions {
  body: string;
  branch?: string;
  strictMode?: boolean;
}

export async function searchMetrics(options: SearchMetricsOptions): Promise<string> {
  return postWithMethodOverride(options, "GET");
}

type PostMetricCollectionOptions = BknBackendKnOptions & {
  body: string;
  branch?: string;
  strictMode?: boolean;
};

async function postWithMethodOverride(
  options: PostMetricCollectionOptions,
  methodOverride: "POST" | "GET"
): Promise<string> {
  const { baseUrl, accessToken, knId, body, businessDomain = "bd_public", branch, strictMode } = options;
  const url = new URL(knUrl(baseUrl, knId, "metrics"));
  appendSearchParams(url, [
    ["branch", branch],
    ["strict_mode", strictMode],
  ]);
  const response = await fetch(url.toString(), {
    method: "POST",
    headers: {
      ...buildHeaders(accessToken, businessDomain),
      "content-type": "application/json",
      "X-HTTP-Method-Override": methodOverride,
    },
    body,
  });
  return readTextOrThrow(response);
}

export interface ValidateMetricsOptions extends BknBackendKnOptions {
  body: string;
  branch?: string;
  strictMode?: boolean;
  importMode?: "normal" | "ignore" | "overwrite";
}

export async function validateMetrics(options: ValidateMetricsOptions): Promise<string> {
  const { baseUrl, accessToken, knId, body, businessDomain = "bd_public", branch, strictMode, importMode } = options;
  const url = new URL(knUrl(baseUrl, knId, "metrics/validation"));
  appendSearchParams(url, [
    ["branch", branch],
    ["strict_mode", strictMode],
    ["import_mode", importMode],
  ]);
  const response = await fetch(url.toString(), {
    method: "POST",
    headers: { ...buildHeaders(accessToken, businessDomain), "content-type": "application/json" },
    body,
  });
  return readTextOrThrow(response);
}

export interface GetMetricOptions extends BknBackendKnOptions {
  metricId: string;
  branch?: string;
}

export async function getMetric(options: GetMetricOptions): Promise<string> {
  const { baseUrl, accessToken, knId, metricId, businessDomain = "bd_public", branch } = options;
  const url = new URL(knUrl(baseUrl, knId, `metrics/${encodeURIComponent(metricId)}`));
  appendSearchParams(url, [["branch", branch]]);
  const response = await fetch(url.toString(), {
    method: "GET",
    headers: buildHeaders(accessToken, businessDomain),
  });
  return readTextOrThrow(response);
}

export interface UpdateMetricOptions extends BknBackendKnOptions {
  metricId: string;
  body: string;
  branch?: string;
  strictMode?: boolean;
}

export async function updateMetric(options: UpdateMetricOptions): Promise<string> {
  const { baseUrl, accessToken, knId, metricId, body, businessDomain = "bd_public", branch, strictMode } = options;
  const url = new URL(knUrl(baseUrl, knId, `metrics/${encodeURIComponent(metricId)}`));
  appendSearchParams(url, [
    ["branch", branch],
    ["strict_mode", strictMode],
  ]);
  const response = await fetch(url.toString(), {
    method: "PUT",
    headers: { ...buildHeaders(accessToken, businessDomain), "content-type": "application/json" },
    body,
  });
  return readTextOrThrow(response);
}

export interface DeleteMetricOptions extends BknBackendKnOptions {
  metricId: string;
  branch?: string;
}

export async function deleteMetric(options: DeleteMetricOptions): Promise<string> {
  const { baseUrl, accessToken, knId, metricId, businessDomain = "bd_public", branch } = options;
  const url = new URL(knUrl(baseUrl, knId, `metrics/${encodeURIComponent(metricId)}`));
  appendSearchParams(url, [["branch", branch]]);
  const response = await fetch(url.toString(), {
    method: "DELETE",
    headers: buildHeaders(accessToken, businessDomain),
  });
  return readTextOrThrow(response);
}

export interface GetMetricsByIdsOptions extends BknBackendKnOptions {
  /** Comma-separated metric IDs in a single path segment. */
  metricIds: string;
  branch?: string;
}

export async function getMetrics(options: GetMetricsByIdsOptions): Promise<string> {
  const { baseUrl, accessToken, knId, metricIds, businessDomain = "bd_public", branch } = options;
  const url = new URL(knUrl(baseUrl, knId, `metrics/${metricIds}`));
  appendSearchParams(url, [["branch", branch]]);
  const response = await fetch(url.toString(), {
    method: "GET",
    headers: buildHeaders(accessToken, businessDomain),
  });
  return readTextOrThrow(response);
}

export interface DeleteMetricsByIdsOptions extends BknBackendKnOptions {
  metricIds: string;
  branch?: string;
}

export async function deleteMetrics(options: DeleteMetricsByIdsOptions): Promise<string> {
  const { baseUrl, accessToken, knId, metricIds, businessDomain = "bd_public", branch } = options;
  const url = new URL(knUrl(baseUrl, knId, `metrics/${metricIds}`));
  appendSearchParams(url, [["branch", branch]]);
  const response = await fetch(url.toString(), {
    method: "DELETE",
    headers: buildHeaders(accessToken, businessDomain),
  });
  return readTextOrThrow(response);
}
