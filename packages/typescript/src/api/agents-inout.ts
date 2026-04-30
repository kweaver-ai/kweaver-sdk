/**
 * Agent-factory v3: personal-space copy and agent-inout bulk export/import.
 * Not to be confused with agent-operator impex (toolbox/mcp/operator).
 */

import { readFile } from "node:fs/promises";
import { basename } from "node:path";
import { HttpError, fetchWithRetry, rethrowIfEndpointUnavailable } from "../utils/http.js";
import { buildHeaders } from "./headers.js";

const FACTORY_V3 = "/api/agent-factory/v3";

interface BaseOpts {
  baseUrl: string;
  accessToken: string;
  businessDomain?: string;
}

function factoryUrl(baseUrl: string, suffix: string): string {
  return `${baseUrl.replace(/\/+$/, "")}${FACTORY_V3}${suffix}`;
}

/** Parse filename from Content-Disposition (attachment). */
export function parseAttachmentFilename(header: string | null): string | undefined {
  if (!header) return undefined;
  const star = header.match(/filename\*=(?:UTF-8''|)([^;\s]+)/i);
  if (star?.[1]) {
    try {
      return decodeURIComponent(star[1].replace(/^"|"$/g, ""));
    } catch {
      return star[1].replace(/^"|"$/g, "");
    }
  }
  const plain = header.match(/filename="([^"]+)"/i);
  if (plain?.[1]) return plain[1];
  const plain2 = header.match(/filename=([^;\s]+)/i);
  return plain2?.[1]?.replace(/^"|"$/g, "");
}

export interface CopyAgentOptions extends BaseOpts {
  agentId: string;
}

export async function copyAgent(opts: CopyAgentOptions): Promise<string> {
  const pathSeg = `/agent/${encodeURIComponent(opts.agentId)}/copy`;
  const url = factoryUrl(opts.baseUrl, pathSeg);
  const response = await fetchWithRetry(url, {
    method: "POST",
    headers: buildHeaders(opts.accessToken, opts.businessDomain ?? "bd_public"),
  });
  const body = await response.text();
  if (!response.ok) {
    rethrowIfEndpointUnavailable(`${FACTORY_V3}${pathSeg}`, new HttpError(response.status, response.statusText, body));
  }
  return body;
}

export async function copyAgentToTemplate(opts: CopyAgentOptions): Promise<string> {
  const pathSeg = `/agent/${encodeURIComponent(opts.agentId)}/copy2tpl`;
  const url = factoryUrl(opts.baseUrl, pathSeg);
  const response = await fetchWithRetry(url, {
    method: "POST",
    headers: buildHeaders(opts.accessToken, opts.businessDomain ?? "bd_public"),
  });
  const body = await response.text();
  if (!response.ok) {
    rethrowIfEndpointUnavailable(`${FACTORY_V3}${pathSeg}`, new HttpError(response.status, response.statusText, body));
  }
  return body;
}

export interface ExportAgentsOptions extends BaseOpts {
  agentIds: string[];
}

export async function exportAgents(opts: ExportAgentsOptions): Promise<{ filename: string; bytes: Uint8Array }> {
  const pathSeg = `/agent-inout/export`;
  const url = factoryUrl(opts.baseUrl, pathSeg);
  const response = await fetchWithRetry(url, {
    method: "POST",
    headers: {
      ...buildHeaders(opts.accessToken, opts.businessDomain ?? "bd_public"),
      "content-type": "application/json",
    },
    body: JSON.stringify({ agent_ids: opts.agentIds }),
  });
  const buf = new Uint8Array(await response.arrayBuffer());
  const text = new TextDecoder("utf-8").decode(buf);
  if (!response.ok) {
    rethrowIfEndpointUnavailable(`${FACTORY_V3}${pathSeg}`, new HttpError(response.status, response.statusText, text));
  }
  const cd = response.headers.get("content-disposition");
  const filename =
    parseAttachmentFilename(cd) ?? `agents_export_${Date.now()}.json`;
  return { filename, bytes: buf };
}

export type AgentImportMode = "create" | "upsert";

export interface ImportAgentsOptions extends BaseOpts {
  filePath: string;
  importType?: AgentImportMode;
}

export async function importAgents(opts: ImportAgentsOptions): Promise<string> {
  const pathSeg = `/agent-inout/import`;
  const url = factoryUrl(opts.baseUrl, pathSeg);
  const buf = await readFile(opts.filePath);
  const filename = basename(opts.filePath);
  const form = new FormData();
  // Some backends reject imports unless the multipart part declares JSON.
  const fileType = filename.toLowerCase().endsWith(".json") ? "application/json" : "application/octet-stream";
  form.append("file", new Blob([buf], { type: fileType }), filename);
  form.append("import_type", opts.importType ?? "create");

  const response = await fetchWithRetry(url, {
    method: "POST",
    headers: buildHeaders(opts.accessToken, opts.businessDomain ?? "bd_public"),
    body: form,
  });
  const body = await response.text();
  if (!response.ok) {
    rethrowIfEndpointUnavailable(`${FACTORY_V3}${pathSeg}`, new HttpError(response.status, response.statusText, body));
  }
  return body;
}
