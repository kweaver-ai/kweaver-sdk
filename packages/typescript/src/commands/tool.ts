import { access } from "node:fs/promises";
import { ensureValidToken, formatHttpError, with401RefreshRetry } from "../auth/oauth.js";
import { listTools, setToolStatuses, uploadTool } from "../api/toolboxes.js";
import { formatCallOutput } from "./call.js";
import { resolveBusinessDomain } from "../config/store.js";

const HELP = `kweaver tool

Subcommands:
  upload --toolbox <box-id> <openapi-spec-path> [--metadata-type openapi]
                                          Upload an OpenAPI spec file as a tool
  list --toolbox <box-id>                  List tools in a toolbox
  enable --toolbox <box-id> <tool-id>...   Enable one or more tools
  disable --toolbox <box-id> <tool-id>...  Disable one or more tools

Options:
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
