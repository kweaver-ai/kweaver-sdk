import { access, readFile } from "node:fs/promises";
import { ensureValidToken, formatHttpError, with401RefreshRetry } from "../auth/oauth.js";
import { debugTool, executeTool, listTools, setToolStatuses, uploadTool } from "../api/toolboxes.js";
import { formatCallOutput } from "./call.js";
import { resolveBusinessDomain } from "../config/store.js";

const HELP = `kweaver tool

Subcommands:
  upload --toolbox <box-id> <openapi-spec-path> [--metadata-type openapi]
                                              Upload an OpenAPI spec file as a tool
  list --toolbox <box-id>                      List tools in a toolbox
  enable --toolbox <box-id> <tool-id>...       Enable one or more tools
  disable --toolbox <box-id> <tool-id>...      Disable one or more tools
  execute --toolbox <box-id> <tool-id> [--body '<json>'|--body-file <path>]
                                              [--header|--query|--path '<json>']
                                              Invoke a published+enabled tool
  debug   --toolbox <box-id> <tool-id> [--body '<json>'|--body-file <path>]
                                              [--header|--query|--path '<json>']
                                              Invoke a tool (works on draft/disabled too)

Options for execute/debug:
  --header '<json>'       Headers map forwarded to the downstream tool
                          (Authorization is auto-injected from current session
                          when --header omits it; pass {} to send none)
  --query  '<json>'       Query params map forwarded to the downstream tool
  --path   '<json>'       Path parameter map for OpenAPI path placeholders (e.g. {id})
                          (JSON object: quote id and UUID, e.g. key id for get_dataview_detail /
                          query_dataview_sql)
  --timeout <seconds>     Per-call timeout (backend default applies when omitted)

Common options:
  -bd, --biz-domain <s>   Business domain (default: bd_public)
  --pretty                Pretty-print JSON (default)
  --compact               Single-line JSON (pipeline-friendly)`;

export async function runToolCommand(args: string[]): Promise<number> {
  const [subcommand, ...rest] = args;
  if (!subcommand || subcommand === "--help" || subcommand === "-h") {
    console.log(HELP);
    return 0;
  }

  const dispatch = (): Promise<number> => {
    if (subcommand === "upload") return runToolUpload(rest);
    if (subcommand === "list") return runToolList(rest);
    if (subcommand === "enable") return runToolStatus(rest, "enabled");
    if (subcommand === "disable") return runToolStatus(rest, "disabled");
    if (subcommand === "execute") return runToolInvoke(rest, "execute");
    if (subcommand === "debug") return runToolInvoke(rest, "debug");
    return Promise.resolve(-1);
  };

  try {
    return await with401RefreshRetry(async () => {
      const code = await dispatch();
      if (code === -1) {
        console.error(`Unknown tool subcommand: ${subcommand}`);
        return 1;
      }
      return code;
    });
  } catch (error) {
    console.error(formatHttpError(error));
    return 1;
  }
}

// ── upload ────────────────────────────────────────────────────────────────────

export interface ToolUploadOptions {
  boxId: string;
  filePath: string;
  metadataType: "openapi";  // tightened — only value the backend accepts today
  businessDomain: string;
  pretty: boolean;
}

export function parseToolUploadArgs(args: string[]): ToolUploadOptions {
  let boxId = "";
  let filePath = "";
  let metadataType: "openapi" = "openapi";
  let businessDomain = "";
  let pretty = true;

  for (let i = 0; i < args.length; i += 1) {
    const a = args[i];
    if (a === "--toolbox" && args[i + 1]) { boxId = args[++i]; continue; }
    if (a === "--metadata-type" && args[i + 1]) {
      const val = args[++i];
      if (val !== "openapi") {
        throw new Error(`Unsupported --metadata-type: ${val} (only "openapi" is supported)`);
      }
      metadataType = val;
      continue;
    }
    if ((a === "-bd" || a === "--biz-domain") && args[i + 1]) { businessDomain = args[++i]; continue; }
    if (a === "--pretty") { pretty = true; continue; }
    if (a === "--compact") { pretty = false; continue; }
    if (!a.startsWith("-") && !filePath) { filePath = a; continue; }
  }

  if (!boxId) throw new Error("Missing required flag: --toolbox");
  if (!filePath) throw new Error("Missing required positional argument: <file-path>");
  if (!businessDomain) businessDomain = resolveBusinessDomain();
  return { boxId, filePath, metadataType, businessDomain, pretty };
}

async function runToolUpload(args: string[]): Promise<number> {
  let opts: ToolUploadOptions;
  try { opts = parseToolUploadArgs(args); }
  catch (e) { console.error(e instanceof Error ? e.message : String(e)); return 1; }

  try { await access(opts.filePath); }
  catch { console.error(`File not found: ${opts.filePath}`); return 1; }

  const token = await ensureValidToken();
  const body = await uploadTool({
    baseUrl: token.baseUrl,
    accessToken: token.accessToken,
    businessDomain: opts.businessDomain,
    boxId: opts.boxId,
    filePath: opts.filePath,
    metadataType: opts.metadataType,
  });
  console.log(formatCallOutput(body, opts.pretty));
  return 0;
}

// ── list ──────────────────────────────────────────────────────────────────────

async function runToolList(args: string[]): Promise<number> {
  let boxId = "";
  let businessDomain = "";
  let pretty = true;
  for (let i = 0; i < args.length; i += 1) {
    const a = args[i];
    if (a === "--toolbox" && args[i + 1]) { boxId = args[++i]; continue; }
    if ((a === "-bd" || a === "--biz-domain") && args[i + 1]) { businessDomain = args[++i]; continue; }
    if (a === "--pretty") { pretty = true; continue; }
    if (a === "--compact") { pretty = false; continue; }
  }
  if (!boxId) { console.error("Missing required flag: --toolbox"); return 1; }
  if (!businessDomain) businessDomain = resolveBusinessDomain();

  const token = await ensureValidToken();
  const body = await listTools({
    baseUrl: token.baseUrl,
    accessToken: token.accessToken,
    businessDomain,
    boxId,
  });
  console.log(formatCallOutput(body, pretty));
  return 0;
}

// ── enable / disable ──────────────────────────────────────────────────────────

export interface ToolStatusOptions {
  boxId: string;
  toolIds: string[];
  status: "enabled" | "disabled";
  businessDomain: string;
}

export function parseToolStatusArgs(args: string[], status: "enabled" | "disabled"): ToolStatusOptions {
  let boxId = "";
  let businessDomain = "";
  const toolIds: string[] = [];
  for (let i = 0; i < args.length; i += 1) {
    const a = args[i];
    if (a === "--toolbox" && args[i + 1]) { boxId = args[++i]; continue; }
    if ((a === "-bd" || a === "--biz-domain") && args[i + 1]) { businessDomain = args[++i]; continue; }
    if (!a.startsWith("-")) toolIds.push(a);
  }
  if (!boxId) throw new Error("Missing required flag: --toolbox");
  if (toolIds.length === 0) throw new Error("Missing tool id(s)");
  if (!businessDomain) businessDomain = resolveBusinessDomain();
  return { boxId, toolIds, status, businessDomain };
}

async function runToolStatus(args: string[], status: "enabled" | "disabled"): Promise<number> {
  let opts: ToolStatusOptions;
  try { opts = parseToolStatusArgs(args, status); }
  catch (e) { console.error(e instanceof Error ? e.message : String(e)); return 1; }

  const token = await ensureValidToken();
  await setToolStatuses({
    baseUrl: token.baseUrl,
    accessToken: token.accessToken,
    businessDomain: opts.businessDomain,
    boxId: opts.boxId,
    updates: opts.toolIds.map((toolId) => ({ toolId, status: opts.status })),
  });
  console.error(`${status === "enabled" ? "Enabled" : "Disabled"} ${opts.toolIds.length} tool(s) in toolbox ${opts.boxId}`);
  return 0;
}

// ── execute / debug ───────────────────────────────────────────────────────────

export interface ToolInvokeOptions {
  boxId: string;
  toolId: string;
  header?: Record<string, unknown>;
  query?: Record<string, unknown>;
  path?: Record<string, unknown>;
  body?: unknown;
  bodyFile?: string;
  timeout?: number;
  businessDomain: string;
  pretty: boolean;
}

function parseJsonOption(name: string, raw: string): Record<string, unknown> {
  let value: unknown;
  try { value = JSON.parse(raw); }
  catch (e) { throw new Error(`${name} must be valid JSON: ${(e as Error).message}`); }
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${name} must be a JSON object`);
  }
  return value as Record<string, unknown>;
}

export function parseToolInvokeArgs(args: string[]): ToolInvokeOptions {
  let boxId = "";
  let toolId = "";
  let businessDomain = "";
  let pretty = true;
  let header: Record<string, unknown> | undefined;
  let query: Record<string, unknown> | undefined;
  let path: Record<string, unknown> | undefined;
  let body: unknown;
  let bodyProvided = false;
  let bodyFile: string | undefined;
  let timeout: number | undefined;

  for (let i = 0; i < args.length; i += 1) {
    const a = args[i];
    if (a === "--toolbox" && args[i + 1]) { boxId = args[++i]; continue; }
    if (a === "--header" && args[i + 1]) { header = parseJsonOption("--header", args[++i]); continue; }
    if (a === "--query" && args[i + 1]) { query = parseJsonOption("--query", args[++i]); continue; }
    if (a === "--path" && args[i + 1]) { path = parseJsonOption("--path", args[++i]); continue; }
    if (a === "--body" && args[i + 1]) {
      const raw = args[++i];
      try { body = JSON.parse(raw); }
      catch (e) { throw new Error(`--body must be valid JSON: ${(e as Error).message}`); }
      bodyProvided = true;
      continue;
    }
    if (a === "--body-file" && args[i + 1]) { bodyFile = args[++i]; bodyProvided = true; continue; }
    if (a === "--timeout" && args[i + 1]) {
      const t = Number(args[++i]);
      if (!Number.isFinite(t) || t <= 0) throw new Error("--timeout must be a positive number");
      timeout = t;
      continue;
    }
    if ((a === "-bd" || a === "--biz-domain") && args[i + 1]) { businessDomain = args[++i]; continue; }
    if (a === "--pretty") { pretty = true; continue; }
    if (a === "--compact") { pretty = false; continue; }
    if (!a.startsWith("-") && !toolId) { toolId = a; continue; }
  }

  if (!boxId) throw new Error("Missing required flag: --toolbox");
  if (!toolId) throw new Error("Missing required positional argument: <tool-id>");
  if (bodyFile && body !== undefined) throw new Error("--body and --body-file are mutually exclusive");
  if (!businessDomain) businessDomain = resolveBusinessDomain();
  return {
    boxId,
    toolId,
    header,
    query,
    path,
    body: bodyProvided ? body : undefined,
    bodyFile,
    timeout,
    businessDomain,
    pretty,
  };
}

async function loadBodyFile(path: string): Promise<unknown> {
  let raw: string;
  try { raw = await readFile(path, "utf8"); }
  catch (e) { throw new Error(`Cannot read --body-file ${path}: ${(e as Error).message}`); }
  try { return JSON.parse(raw); }
  catch (e) { throw new Error(`--body-file ${path} is not valid JSON: ${(e as Error).message}`); }
}

async function runToolInvoke(args: string[], action: "execute" | "debug"): Promise<number> {
  let opts: ToolInvokeOptions;
  try { opts = parseToolInvokeArgs(args); }
  catch (e) { console.error(e instanceof Error ? e.message : String(e)); return 1; }

  let body: unknown = opts.body;
  if (opts.bodyFile !== undefined) {
    try { body = await loadBodyFile(opts.bodyFile); }
    catch (e) { console.error(e instanceof Error ? e.message : String(e)); return 1; }
  }

  const token = await ensureValidToken();
  // Auto-inject Authorization unless caller already provided one — most tools
  // declare an `Authorization` header parameter and would otherwise be called
  // anonymously, which the downstream tool answers with 401 token expired.
  const header = { ...(opts.header ?? {}) };
  const hasAuth = Object.keys(header).some((k) => k.toLowerCase() === "authorization");
  if (!hasAuth) header.Authorization = `Bearer ${token.accessToken}`;

  const fn = action === "execute" ? executeTool : debugTool;
  const responseBody = await fn({
    baseUrl: token.baseUrl,
    accessToken: token.accessToken,
    businessDomain: opts.businessDomain,
    boxId: opts.boxId,
    toolId: opts.toolId,
    header,
    query: opts.query,
    path: opts.path,
    body,
    timeout: opts.timeout,
  });
  console.log(formatCallOutput(responseBody, opts.pretty));
  return 0;
}
