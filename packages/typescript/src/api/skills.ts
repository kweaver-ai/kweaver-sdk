import { spawnSync } from "node:child_process";
import { Buffer } from "node:buffer";
import { existsSync, mkdirSync, readdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { basename, resolve } from "node:path";
import { buildHeaders as buildPlatformHeaders } from "./headers.js";
import { HttpError, fetchTextOrThrow } from "../utils/http.js";

const SKILL_API_PREFIX = "/api/agent-operator-integration/v1";

export type SkillStatus = "unpublish" | "published" | "offline";
export type SkillFileType = "zip" | "content";

export interface SkillSummary {
  id: string;
  name: string;
  description?: string;
  version?: string;
  status?: SkillStatus;
  source?: string;
  create_user?: string;
  create_time?: number;
  update_user?: string;
  update_time?: number;
  business_domain_id?: string;
  category?: string;
  category_name?: string;
}

export interface SkillInfo extends SkillSummary {
  dependencies?: Record<string, unknown>;
  extend_info?: Record<string, unknown>;
}

export interface SkillFileSummary {
  rel_path: string;
  file_type?: string;
  size?: number;
  mime_type?: string;
}

export interface SkillContentIndex {
  id: string;
  url: string;
  files: SkillFileSummary[];
  status?: SkillStatus;
}

export interface SkillFileReadResult {
  id: string;
  rel_path: string;
  url: string;
  mime_type?: string;
  file_type?: string;
}

export interface RegisterSkillResult {
  id: string;
  name: string;
  description?: string;
  version?: string;
  status?: SkillStatus;
  files?: string[];
}

export interface DeleteSkillResult {
  id: string;
  deleted: boolean;
}

export interface UpdateSkillStatusResult {
  id: string;
  status: SkillStatus;
}

export interface SkillListResult {
  total_count?: number;
  total?: number;
  page?: number;
  page_size?: number;
  total_page?: number;
  total_pages?: number;
  has_next?: boolean;
  has_prev?: boolean;
  data: SkillSummary[];
}

export interface SkillApiBaseOptions {
  baseUrl: string;
  accessToken: string;
  businessDomain?: string;
}

export interface ListSkillsOptions extends SkillApiBaseOptions {
  page?: number;
  pageSize?: number;
  sortBy?: "create_time" | "update_time" | "name";
  sortOrder?: "asc" | "desc";
  all?: boolean;
  name?: string;
  status?: SkillStatus;
  source?: string;
  createUser?: string;
}

export interface ListSkillMarketOptions extends SkillApiBaseOptions {
  page?: number;
  pageSize?: number;
  sortBy?: "create_time" | "update_time" | "name";
  sortOrder?: "asc" | "desc";
  all?: boolean;
  name?: string;
  source?: string;
}

export interface GetSkillOptions extends SkillApiBaseOptions {
  skillId: string;
}

export interface RegisterSkillContentOptions extends SkillApiBaseOptions {
  content: string;
  source?: string;
  extendInfo?: Record<string, unknown>;
}

export interface RegisterSkillZipOptions extends SkillApiBaseOptions {
  filename: string;
  bytes: Uint8Array;
  source?: string;
  extendInfo?: Record<string, unknown>;
}

export interface UpdateSkillStatusOptions extends SkillApiBaseOptions {
  skillId: string;
  status: SkillStatus;
}

export interface ReadSkillFileOptions extends SkillApiBaseOptions {
  skillId: string;
  relPath: string;
}

export interface DownloadSkillOptions extends SkillApiBaseOptions {
  skillId: string;
}

export interface DownloadedSkillArchive {
  fileName: string;
  bytes: Uint8Array;
}

export interface InstallSkillArchiveOptions {
  bytes: Uint8Array;
  directory: string;
  force?: boolean;
}

function baseHeaders(opts: SkillApiBaseOptions): Record<string, string> {
  return buildPlatformHeaders(opts.accessToken, opts.businessDomain ?? "bd_public");
}

function buildUrl(baseUrl: string, path: string): string {
  return `${baseUrl.replace(/\/+$/, "")}${path}`;
}

function unwrapEnvelope<T>(raw: string): T {
  const parsed = JSON.parse(raw) as unknown;
  if (parsed && typeof parsed === "object" && "data" in (parsed as Record<string, unknown>)) {
    return (parsed as { data: T }).data;
  }
  return parsed as T;
}

/** Rename `skill_id` → `id` for consistent output with other modules. */
function normalizeSkillId<T>(obj: T): T {
  if (!obj || typeof obj !== "object") return obj;
  if (Array.isArray(obj)) return obj.map(normalizeSkillId) as unknown as T;
  const record = obj as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(record)) {
    const newKey = key === "skill_id" ? "id" : key;
    out[newKey] = typeof value === "object" ? normalizeSkillId(value) : value;
  }
  return out as T;
}

function appendCommonListParams(url: URL, opts: {
  page?: number;
  pageSize?: number;
  sortBy?: string;
  sortOrder?: string;
  all?: boolean;
  name?: string;
  source?: string;
}): void {
  if (opts.page !== undefined) url.searchParams.set("page", String(opts.page));
  if (opts.pageSize !== undefined) url.searchParams.set("page_size", String(opts.pageSize));
  if (opts.sortBy) url.searchParams.set("sort_by", opts.sortBy);
  if (opts.sortOrder) url.searchParams.set("sort_order", opts.sortOrder);
  if (opts.all !== undefined) url.searchParams.set("all", String(opts.all));
  if (opts.name) url.searchParams.set("name", opts.name);
  if (opts.source) url.searchParams.set("source", opts.source);
}

function parseContentDisposition(value: string | null): string | undefined {
  if (!value) return undefined;
  const utf8Match = /filename\*=UTF-8''([^;]+)/i.exec(value);
  if (utf8Match?.[1]) {
    return decodeURIComponent(utf8Match[1]);
  }
  const plainMatch = /filename="?([^";]+)"?/i.exec(value);
  return plainMatch?.[1];
}

async function fetchBytesOrThrow(
  input: RequestInfo | URL,
  init?: RequestInit
): Promise<{ response: Response; body: Uint8Array }> {
  const response = await fetch(input, init);
  const body = new Uint8Array(await response.arrayBuffer());
  if (!response.ok) {
    throw new HttpError(response.status, response.statusText, new TextDecoder().decode(body));
  }
  return { response, body };
}

export async function listSkills(options: ListSkillsOptions): Promise<SkillListResult> {
  const url = new URL(buildUrl(options.baseUrl, `${SKILL_API_PREFIX}/skills`));
  appendCommonListParams(url, options);
  if (options.status) url.searchParams.set("status", options.status);
  if (options.createUser) url.searchParams.set("create_user", options.createUser);
  const { body } = await fetchTextOrThrow(url, { headers: baseHeaders(options) });
  return normalizeSkillId(unwrapEnvelope<SkillListResult>(body));
}

export async function listSkillMarket(options: ListSkillMarketOptions): Promise<SkillListResult> {
  const url = new URL(buildUrl(options.baseUrl, `${SKILL_API_PREFIX}/skills/market`));
  appendCommonListParams(url, options);
  const { body } = await fetchTextOrThrow(url, { headers: baseHeaders(options) });
  return normalizeSkillId(unwrapEnvelope<SkillListResult>(body));
}

export async function getSkill(options: GetSkillOptions): Promise<SkillInfo> {
  const url = buildUrl(options.baseUrl, `${SKILL_API_PREFIX}/skills/${encodeURIComponent(options.skillId)}`);
  const { body } = await fetchTextOrThrow(url, { headers: baseHeaders(options) });
  return normalizeSkillId(unwrapEnvelope<SkillInfo>(body));
}

export async function deleteSkill(options: GetSkillOptions): Promise<DeleteSkillResult> {
  const url = buildUrl(options.baseUrl, `${SKILL_API_PREFIX}/skills/${encodeURIComponent(options.skillId)}`);
  const { body } = await fetchTextOrThrow(url, { method: "DELETE", headers: baseHeaders(options) });
  return normalizeSkillId(unwrapEnvelope<DeleteSkillResult>(body));
}

export async function updateSkillStatus(options: UpdateSkillStatusOptions): Promise<UpdateSkillStatusResult> {
  const url = buildUrl(options.baseUrl, `${SKILL_API_PREFIX}/skills/${encodeURIComponent(options.skillId)}/status`);
  const { body } = await fetchTextOrThrow(url, {
    method: "PUT",
    headers: { ...baseHeaders(options), "content-type": "application/json" },
    body: JSON.stringify({ status: options.status }),
  });
  return normalizeSkillId(unwrapEnvelope<UpdateSkillStatusResult>(body));
}

export async function registerSkillContent(options: RegisterSkillContentOptions): Promise<RegisterSkillResult> {
  const url = buildUrl(options.baseUrl, `${SKILL_API_PREFIX}/skills`);
  const form = new FormData();
  form.set("file_type", "content");
  // Backend's gin form-binder rejects plain string field for `file`
  // (typed json.RawMessage); needs an actual multipart file part with
  // filename. See utils/gin.go GetBindMultipartFormRaw.
  form.set(
    "file",
    new Blob([options.content], { type: "text/markdown" }),
    "SKILL.md",
  );
  if (options.source) form.set("source", options.source);
  if (options.extendInfo) form.set("extend_info", JSON.stringify(options.extendInfo));

  const { body } = await fetchTextOrThrow(url, {
    method: "POST",
    headers: baseHeaders(options),
    body: form,
  });
  return normalizeSkillId(unwrapEnvelope<RegisterSkillResult>(body));
}

export async function registerSkillZip(options: RegisterSkillZipOptions): Promise<RegisterSkillResult> {
  const url = buildUrl(options.baseUrl, `${SKILL_API_PREFIX}/skills`);
  const form = new FormData();
  form.set("file_type", "zip");
  form.set("file", new Blob([Buffer.from(options.bytes)]), options.filename);
  if (options.source) form.set("source", options.source);
  if (options.extendInfo) form.set("extend_info", JSON.stringify(options.extendInfo));

  const { body } = await fetchTextOrThrow(url, {
    method: "POST",
    headers: baseHeaders(options),
    body: form,
  });
  return normalizeSkillId(unwrapEnvelope<RegisterSkillResult>(body));
}

export async function getSkillContentIndex(options: GetSkillOptions): Promise<SkillContentIndex> {
  const url = buildUrl(options.baseUrl, `${SKILL_API_PREFIX}/skills/${encodeURIComponent(options.skillId)}/content`);
  const { body } = await fetchTextOrThrow(url, { headers: baseHeaders(options) });
  return normalizeSkillId(unwrapEnvelope<SkillContentIndex>(body));
}

export async function fetchSkillContent(options: GetSkillOptions): Promise<string> {
  const index = await getSkillContentIndex(options);
  const { body } = await fetchTextOrThrow(index.url);
  return body;
}

export async function readSkillFile(options: ReadSkillFileOptions): Promise<SkillFileReadResult> {
  const url = buildUrl(
    options.baseUrl,
    `${SKILL_API_PREFIX}/skills/${encodeURIComponent(options.skillId)}/files/read`
  );
  const { body } = await fetchTextOrThrow(url, {
    method: "POST",
    headers: { ...baseHeaders(options), "content-type": "application/json" },
    body: JSON.stringify({ rel_path: options.relPath }),
  });
  return normalizeSkillId(unwrapEnvelope<SkillFileReadResult>(body));
}

export async function fetchSkillFile(options: ReadSkillFileOptions): Promise<Uint8Array> {
  const file = await readSkillFile(options);
  const { body } = await fetchBytesOrThrow(file.url);
  return body;
}

export async function downloadSkill(options: DownloadSkillOptions): Promise<DownloadedSkillArchive> {
  const url = buildUrl(options.baseUrl, `${SKILL_API_PREFIX}/skills/${encodeURIComponent(options.skillId)}/download`);
  const { response, body } = await fetchBytesOrThrow(url, { headers: baseHeaders(options) });
  const serverName = parseContentDisposition(response.headers.get("content-disposition"));
  return {
    fileName: basename(serverName || `${options.skillId}.zip`),
    bytes: body,
  };
}

export function installSkillArchive(options: InstallSkillArchiveOptions): { directory: string } {
  const targetDir = resolve(options.directory);
  const existed = existsSync(targetDir);
  if (existed) {
    const entries = readdirSync(targetDir);
    if (entries.length > 0) {
      if (!options.force) {
        throw new Error(`Install target is not empty: ${targetDir}. Use --force to replace it.`);
      }
    }
  }
  const parentDir = resolve(targetDir, "..");
  mkdirSync(parentDir, { recursive: true });
  const archivePath = resolve(parentDir, `${basename(targetDir)}.zip`);
  const stagingDir = resolve(parentDir, `.${basename(targetDir)}.tmp-${process.pid}-${Date.now()}`);
  const backupDir = existed ? resolve(parentDir, `.${basename(targetDir)}.bak-${process.pid}-${Date.now()}`) : undefined;

  mkdirSync(stagingDir, { recursive: true });
  writeFileSync(archivePath, options.bytes);
  try {
    const result = spawnSync("unzip", ["-oq", archivePath, "-d", stagingDir], {
      encoding: "utf8",
    });
    if (result.error) {
      throw result.error;
    }
    if (result.status !== 0) {
      throw new Error(result.stderr || `unzip exited with status ${result.status}`);
    }
    if (existsSync(targetDir)) {
      renameSync(targetDir, backupDir!);
    }
    renameSync(stagingDir, targetDir);
    if (backupDir && existsSync(backupDir)) {
      rmSync(backupDir, { recursive: true, force: true });
    }
    return { directory: targetDir };
  } catch (error) {
    rmSync(stagingDir, { recursive: true, force: true });
    if (backupDir && existsSync(backupDir) && !existsSync(targetDir)) {
      renameSync(backupDir, targetDir);
    }
    throw new Error(
      error instanceof Error
        ? `Skill install failed: ${error.message}`
        : `Skill install failed: ${String(error)}`
    );
  } finally {
    rmSync(archivePath, { force: true });
    if (backupDir && existsSync(backupDir)) {
      rmSync(backupDir, { recursive: true, force: true });
    }
  }
}
