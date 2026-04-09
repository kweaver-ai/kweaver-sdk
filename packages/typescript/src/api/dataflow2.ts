import { HttpError } from "../utils/http.js";
import { buildHeaders } from "./headers.js";

export interface DataflowListItem {
  id: string;
  title?: string;
  status?: string;
  trigger?: string;
  creator?: string;
  updated_at?: number;
  version_id?: string;
}

export interface DataflowListResponse {
  dags: DataflowListItem[];
  limit?: number;
  page?: number;
  total?: number;
}

export interface DataflowRunSource {
  name?: string;
  content_type?: string;
  size?: number;
  [key: string]: unknown;
}

export interface DataflowRunItem {
  id: string;
  status?: string;
  started_at?: number;
  ended_at?: number | null;
  reason?: string | null;
  source?: DataflowRunSource;
}

export interface DataflowRunsResponse {
  results: DataflowRunItem[];
  limit?: number;
  page?: number;
  total?: number;
}

export interface DataflowLogMetadata {
  duration?: number;
  [key: string]: unknown;
}

export interface DataflowLogItem {
  id: string;
  operator?: string;
  status?: string;
  started_at?: number;
  updated_at?: number;
  inputs?: unknown;
  outputs?: unknown;
  taskId?: string;
  metadata?: DataflowLogMetadata;
}

export interface DataflowLogsResponse {
  results: DataflowLogItem[];
  limit?: number;
  page?: number;
  total?: number;
}

export interface DataflowRunResponse {
  dag_instance_id: string;
}

interface BaseOptions {
  baseUrl: string;
  accessToken: string;
  businessDomain?: string;
}

export interface RunDataflowWithFileOptions extends BaseOptions {
  dagId: string;
  fileName: string;
  fileBytes: Uint8Array;
}

export interface RunDataflowWithRemoteUrlOptions extends BaseOptions {
  dagId: string;
  url: string;
  name: string;
}

export interface ListDataflowRunsOptions extends BaseOptions {
  dagId: string;
}

export interface GetDataflowLogsPageOptions extends BaseOptions {
  dagId: string;
  instanceId: string;
  page: number;
  limit?: number;
}

async function parseJsonOrThrow<T>(response: Response): Promise<T> {
  const body = await response.text();
  if (!response.ok) {
    throw new HttpError(response.status, response.statusText, body);
  }
  return JSON.parse(body) as T;
}

export async function listDataflows(options: BaseOptions): Promise<DataflowListResponse> {
  const { baseUrl, accessToken, businessDomain = "bd_public" } = options;
  const base = baseUrl.replace(/\/+$/, "");
  const url = `${base}/api/automation/v2/dags?type=data-flow&page=0&limit=-1`;
  const response = await fetch(url, {
    method: "GET",
    headers: buildHeaders(accessToken, businessDomain),
  });
  return parseJsonOrThrow<DataflowListResponse>(response);
}

export async function runDataflowWithFile(options: RunDataflowWithFileOptions): Promise<DataflowRunResponse> {
  const { baseUrl, accessToken, businessDomain = "bd_public", dagId, fileName, fileBytes } = options;
  const base = baseUrl.replace(/\/+$/, "");
  const url = `${base}/api/automation/v2/dataflow-doc/trigger/${encodeURIComponent(dagId)}`;
  const form = new FormData();
  form.set("file", new Blob([fileBytes as unknown as ArrayBufferView<ArrayBuffer>]), fileName);
  const response = await fetch(url, {
    method: "POST",
    headers: buildHeaders(accessToken, businessDomain),
    body: form,
  });
  return parseJsonOrThrow<DataflowRunResponse>(response);
}

export async function runDataflowWithRemoteUrl(options: RunDataflowWithRemoteUrlOptions): Promise<DataflowRunResponse> {
  const { baseUrl, accessToken, businessDomain = "bd_public", dagId, url, name } = options;
  const base = baseUrl.replace(/\/+$/, "");
  const endpoint = `${base}/api/automation/v2/dataflow-doc/trigger/${encodeURIComponent(dagId)}`;
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      ...buildHeaders(accessToken, businessDomain),
      "content-type": "application/json",
    },
    body: JSON.stringify({
      source_from: "remote",
      url,
      name,
    }),
  });
  return parseJsonOrThrow<DataflowRunResponse>(response);
}

export async function listDataflowRuns(options: ListDataflowRunsOptions): Promise<DataflowRunsResponse> {
  const { baseUrl, accessToken, businessDomain = "bd_public", dagId } = options;
  const base = baseUrl.replace(/\/+$/, "");
  const url = `${base}/api/automation/v2/dag/${encodeURIComponent(dagId)}/results?page=0&limit=100`;
  const response = await fetch(url, {
    method: "GET",
    headers: buildHeaders(accessToken, businessDomain),
  });
  return parseJsonOrThrow<DataflowRunsResponse>(response);
}

export async function getDataflowLogsPage(options: GetDataflowLogsPageOptions): Promise<DataflowLogsResponse> {
  const { baseUrl, accessToken, businessDomain = "bd_public", dagId, instanceId, page, limit = 10 } = options;
  const base = baseUrl.replace(/\/+$/, "");
  const url = `${base}/api/automation/v2/dag/${encodeURIComponent(dagId)}/result/${encodeURIComponent(instanceId)}?page=${page}&limit=${limit}`;
  const response = await fetch(url, {
    method: "GET",
    headers: buildHeaders(accessToken, businessDomain),
  });
  return parseJsonOrThrow<DataflowLogsResponse>(response);
}
