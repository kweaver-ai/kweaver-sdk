import { readFile } from "node:fs/promises";
import { basename } from "node:path";
import { fetchTextOrThrow } from "../utils/http.js";
import { buildHeaders } from "./headers.js";

// Backend endpoints under /api/agent-operator-integration/v1/tool-box.
//
// Verified against kweaver/examples/03-action-lifecycle/run.sh (lines 78–197):
//   POST   /tool-box                   create
//   DELETE /tool-box/{id}              delete
//   POST   /tool-box/{id}/status       publish/draft
//   POST   /tool-box/{id}/tool         upload tool (multipart)
//   POST   /tool-box/{id}/tools/status enable/disable (batch)
//
// Verified during Task 8 e2e against the live backend (2026-04-18):
//   GET    /tool-box/list?keyword=&limit=&offset=  list toolboxes
//   GET    /tool-box/{id}/tools/list               list tools

const PATH = "/api/agent-operator-integration/v1/tool-box";

interface BaseOpts {
  baseUrl: string;
  accessToken: string;
  businessDomain?: string;
}

function url(base: string, suffix = ""): string {
  return `${base.replace(/\/+$/, "")}${PATH}${suffix}`;
}

export interface CreateToolboxOptions extends BaseOpts {
  name: string;
  description: string;
  serviceUrl: string;
  metadataType?: "openapi"; // sole value the backend accepts today
  source?: string;          // default: custom
}

export async function createToolbox(opts: CreateToolboxOptions): Promise<string> {
  const body = JSON.stringify({
    metadata_type: opts.metadataType ?? "openapi",
    box_name: opts.name,
    box_desc: opts.description,
    box_svc_url: opts.serviceUrl,
    source: opts.source ?? "custom",
  });
  const { body: text } = await fetchTextOrThrow(url(opts.baseUrl), {
    method: "POST",
    headers: { ...buildHeaders(opts.accessToken, opts.businessDomain ?? "bd_public"), "content-type": "application/json" },
    body,
  });
  return text;
}

export interface DeleteToolboxOptions extends BaseOpts {
  boxId: string;
}

export async function deleteToolbox(opts: DeleteToolboxOptions): Promise<void> {
  await fetchTextOrThrow(url(opts.baseUrl, `/${encodeURIComponent(opts.boxId)}`), {
    method: "DELETE",
    headers: buildHeaders(opts.accessToken, opts.businessDomain ?? "bd_public"),
  });
}

export interface SetToolboxStatusOptions extends BaseOpts {
  boxId: string;
  status: "published" | "draft";
}

export async function setToolboxStatus(opts: SetToolboxStatusOptions): Promise<void> {
  await fetchTextOrThrow(url(opts.baseUrl, `/${encodeURIComponent(opts.boxId)}/status`), {
    method: "POST",
    headers: { ...buildHeaders(opts.accessToken, opts.businessDomain ?? "bd_public"), "content-type": "application/json" },
    body: JSON.stringify({ status: opts.status }),
  });
}

export interface UploadToolOptions extends BaseOpts {
  boxId: string;
  filePath: string;
  metadataType?: "openapi"; // sole value the backend accepts today
}

export async function uploadTool(opts: UploadToolOptions): Promise<string> {
  const buf = await readFile(opts.filePath);
  const form = new FormData();
  form.append("metadata_type", opts.metadataType ?? "openapi");
  form.append("data", new Blob([buf]), basename(opts.filePath));
  const { body: text } = await fetchTextOrThrow(url(opts.baseUrl, `/${encodeURIComponent(opts.boxId)}/tool`), {
    method: "POST",
    headers: buildHeaders(opts.accessToken, opts.businessDomain ?? "bd_public"),
    body: form,
  });
  return text;
}

export interface SetToolStatusesOptions extends BaseOpts {
  boxId: string;
  updates: Array<{ toolId: string; status: "enabled" | "disabled" }>;
}

export async function setToolStatuses(opts: SetToolStatusesOptions): Promise<void> {
  const body = JSON.stringify(opts.updates.map((u) => ({ tool_id: u.toolId, status: u.status })));
  await fetchTextOrThrow(url(opts.baseUrl, `/${encodeURIComponent(opts.boxId)}/tools/status`), {
    method: "POST",
    headers: { ...buildHeaders(opts.accessToken, opts.businessDomain ?? "bd_public"), "content-type": "application/json" },
    body,
  });
}

export interface ListToolboxesOptions extends BaseOpts {
  keyword?: string;
  limit?: number;
  offset?: number;
}

export async function listToolboxes(opts: ListToolboxesOptions): Promise<string> {
  const qp = new URLSearchParams();
  if (opts.keyword !== undefined) qp.set("keyword", opts.keyword);
  if (opts.limit !== undefined) qp.set("limit", String(opts.limit));
  if (opts.offset !== undefined) qp.set("offset", String(opts.offset));
  const suffix = `/list${qp.toString() ? `?${qp}` : ""}`;
  const { body } = await fetchTextOrThrow(url(opts.baseUrl, suffix), {
    method: "GET",
    headers: buildHeaders(opts.accessToken, opts.businessDomain ?? "bd_public"),
  });
  return body;
}

export interface ListToolsOptions extends BaseOpts {
  boxId: string;
}

export async function listTools(opts: ListToolsOptions): Promise<string> {
  const { body } = await fetchTextOrThrow(url(opts.baseUrl, `/${encodeURIComponent(opts.boxId)}/tools/list`), {
    method: "GET",
    headers: buildHeaders(opts.accessToken, opts.businessDomain ?? "bd_public"),
  });
  return body;
}
