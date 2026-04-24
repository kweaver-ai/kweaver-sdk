import { readFile } from "node:fs/promises";
import { basename } from "node:path";
import { HttpError, fetchTextOrThrow, fetchWithRetry } from "../utils/http.js";
import { buildHeaders } from "./headers.js";

// Backend endpoints under /api/agent-operator-integration/v1/tool-box.
//
// Verified against kweaver/examples/03-action-lifecycle/run.sh (lines 78–197):
//   POST   /tool-box                       create
//   DELETE /tool-box/{id}                  delete
//   POST   /tool-box/{id}/status           publish/draft
//   POST   /tool-box/{id}/tool             upload tool (multipart)
//   POST   /tool-box/{id}/tools/status     enable/disable (batch)
//
// Verified during Task 8 e2e against the live backend (2026-04-18):
//   GET    /tool-box/list?keyword=&limit=&offset=  list toolboxes
//   GET    /tool-box/{id}/tools/list               list tools
//
// Verified live on 2026-04-23 against dip-poc.aishu.cn:
//   POST   /tool-box/{box}/proxy/{tool}            execute tool (envelope JSON)
//   POST   /tool-box/{box}/tool/{tool}/debug       debug tool (envelope JSON)
//
// Envelope shape required by /proxy and /debug:
//   { "timeout": <s>, "header": {...}, "query": {...}, "body": {...} }
// Flat-shape requests cause the forwarder to drop downstream Authorization
// headers, which manifests as 401 "token expired" from the underlying tool.

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

// ── impex (export / import) ──────────────────────────────────────────────────
//
// Backend mounts the impex endpoints on the same service but under a different
// path:
//
//   GET  /api/agent-operator-integration/v1/impex/export/{type}/{id}
//   POST /api/agent-operator-integration/v1/impex/import/{type}   (multipart, field "data")
//
// Supported {type} values today: "toolbox" | "mcp" | "operator".
//
// Export response is the raw JSON config (Content-Type: application/json) plus
// a `Content-Disposition: attachment; filename=<type>_export_<ts>.adp` header.

const IMPEX_PATH = "/api/agent-operator-integration/v1/impex";

export type ImpexType = "toolbox" | "mcp" | "operator";

export interface ExportConfigOptions extends BaseOpts {
  id: string;
  type?: ImpexType;
}

export async function exportConfig(opts: ExportConfigOptions): Promise<Uint8Array> {
  const t = opts.type ?? "toolbox";
  const target = `${opts.baseUrl.replace(/\/+$/, "")}${IMPEX_PATH}/export/${encodeURIComponent(t)}/${encodeURIComponent(opts.id)}`;
  // Use raw bytes (not text) so we never lose precision on non-ASCII payloads
  // and stay symmetric with the Python SDK's `export_config -> bytes`.
  const response = await fetchWithRetry(target, {
    method: "GET",
    headers: buildHeaders(opts.accessToken, opts.businessDomain ?? "bd_public"),
  });
  const buf = new Uint8Array(await response.arrayBuffer());
  if (!response.ok) {
    const text = new TextDecoder("utf-8").decode(buf);
    throw new HttpError(response.status, response.statusText, text);
  }
  return buf;
}

export interface ImportConfigOptions extends BaseOpts {
  /** Path to a previously exported `.adp` JSON file. */
  filePath: string;
  type?: ImpexType;
}

export async function importConfig(opts: ImportConfigOptions): Promise<string> {
  const buf = await readFile(opts.filePath);
  const t = opts.type ?? "toolbox";
  const form = new FormData();
  form.append("data", new Blob([buf]), basename(opts.filePath));
  const target = `${opts.baseUrl.replace(/\/+$/, "")}${IMPEX_PATH}/import/${encodeURIComponent(t)}`;
  const { body } = await fetchTextOrThrow(target, {
    method: "POST",
    headers: buildHeaders(opts.accessToken, opts.businessDomain ?? "bd_public"),
    body: form,
  });
  return body;
}

// ── execute / debug ──────────────────────────────────────────────────────────
//
// Both endpoints share the same envelope payload and forwarder; the only
// observable differences are:
//   - debug bypasses the "tool must be enabled" gate (dev-time invocation),
//   - audit log records DebugTool vs ExecuteTool.

export interface InvokeToolOptions extends BaseOpts {
  boxId: string;
  toolId: string;
  /** Optional headers to forward to the downstream tool (e.g. Authorization). */
  header?: Record<string, unknown>;
  /** Optional query params to forward. */
  query?: Record<string, unknown>;
  /** JSON body forwarded to the downstream tool. */
  body?: unknown;
  /** Per-call timeout in seconds; backend default applies when omitted. */
  timeout?: number;
}

function buildEnvelope(opts: InvokeToolOptions): string {
  const envelope: Record<string, unknown> = {};
  if (opts.timeout !== undefined) envelope.timeout = opts.timeout;
  envelope.header = opts.header ?? {};
  envelope.query = opts.query ?? {};
  envelope.body = opts.body ?? {};
  return JSON.stringify(envelope);
}

async function invokeTool(opts: InvokeToolOptions, suffix: string): Promise<string> {
  const { body } = await fetchTextOrThrow(url(opts.baseUrl, suffix), {
    method: "POST",
    headers: { ...buildHeaders(opts.accessToken, opts.businessDomain ?? "bd_public"), "content-type": "application/json" },
    body: buildEnvelope(opts),
  });
  return body;
}

/** Execute a published+enabled tool through the toolbox proxy. */
export async function executeTool(opts: InvokeToolOptions): Promise<string> {
  return invokeTool(opts, `/${encodeURIComponent(opts.boxId)}/proxy/${encodeURIComponent(opts.toolId)}`);
}

/** Debug a tool through the toolbox proxy (works on draft/disabled tools too). */
export async function debugTool(opts: InvokeToolOptions): Promise<string> {
  return invokeTool(opts, `/${encodeURIComponent(opts.boxId)}/tool/${encodeURIComponent(opts.toolId)}/debug`);
}
