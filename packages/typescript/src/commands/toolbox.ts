import { writeFile } from "node:fs/promises";
import { createInterface } from "node:readline";
import { ensureValidToken, formatHttpError, with401RefreshRetry } from "../auth/oauth.js";
import {
  createToolbox,
  deleteToolbox,
  exportConfig,
  importConfig,
  listToolboxes,
  setToolboxStatus,
  type ImpexType,
} from "../api/toolboxes.js";
import { formatCallOutput } from "./call.js";
import { resolveBusinessDomain } from "../config/store.js";

const VALID_IMPEX_TYPES: ReadonlySet<ImpexType> = new Set(["toolbox", "mcp", "operator"]);

const HELP = `kweaver toolbox

Subcommands:
  create --name <n> --service-url <url> [--description <d>]   Create a new toolbox
  list [--keyword <s>] [--limit <n>] [--offset <n>]           List toolboxes
  publish <box-id>                                            Publish a toolbox (status=published)
  unpublish <box-id>                                          Unpublish (status=draft)
  delete <box-id> [-y|--yes]                                  Delete a toolbox
  export <box-id> [-o <file>|-] [--type toolbox|mcp|operator] Export toolbox config (.adp JSON)
  import <file> [--type toolbox|mcp|operator]                 Import a previously exported config

Options:
  -bd, --biz-domain <s>   Business domain (default: bd_public)
  --pretty                Pretty-print JSON (default)
  --compact               Single-line JSON (pipeline-friendly)`;

export async function runToolboxCommand(args: string[]): Promise<number> {
  const [subcommand, ...rest] = args;
  if (!subcommand || subcommand === "--help" || subcommand === "-h") {
    console.log(HELP);
    return 0;
  }

  const dispatch = (): Promise<number> => {
    if (subcommand === "create") return runToolboxCreate(rest);
    if (subcommand === "list") return runToolboxList(rest);
    if (subcommand === "publish") return runToolboxSetStatus(rest, "published");
    if (subcommand === "unpublish") return runToolboxSetStatus(rest, "draft");
    if (subcommand === "delete") return runToolboxDelete(rest);
    if (subcommand === "export") return runToolboxExport(rest);
    if (subcommand === "import") return runToolboxImport(rest);
    return Promise.resolve(-1);
  };

  try {
    return await with401RefreshRetry(async () => {
      const code = await dispatch();
      if (code === -1) {
        console.error(`Unknown toolbox subcommand: ${subcommand}`);
        return 1;
      }
      return code;
    });
  } catch (error) {
    console.error(formatHttpError(error));
    return 1;
  }
}

// ── create ────────────────────────────────────────────────────────────────────

export interface ToolboxCreateOptions {
  name: string;
  serviceUrl: string;
  description: string;
  businessDomain: string;
  pretty: boolean;
}

export function parseToolboxCreateArgs(args: string[]): ToolboxCreateOptions {
  let name = "";
  let serviceUrl = "";
  let description = "";
  let businessDomain = "";
  let pretty = true;

  for (let i = 0; i < args.length; i += 1) {
    const a = args[i];
    if (a === "--name" && args[i + 1]) { name = args[++i]; continue; }
    if (a === "--service-url" && args[i + 1]) { serviceUrl = args[++i]; continue; }
    if (a === "--description" && args[i + 1]) { description = args[++i]; continue; }
    if ((a === "-bd" || a === "--biz-domain") && args[i + 1]) { businessDomain = args[++i]; continue; }
    if (a === "--pretty") { pretty = true; continue; }
    if (a === "--compact") { pretty = false; continue; }
  }

  if (!name) throw new Error("Missing required flag: --name");
  if (!serviceUrl) throw new Error("Missing required flag: --service-url");
  if (!businessDomain) businessDomain = resolveBusinessDomain();
  return { name, serviceUrl, description, businessDomain, pretty };
}

async function runToolboxCreate(args: string[]): Promise<number> {
  let opts: ToolboxCreateOptions;
  try { opts = parseToolboxCreateArgs(args); }
  catch (e) { console.error(e instanceof Error ? e.message : String(e)); return 1; }

  const token = await ensureValidToken();
  const body = await createToolbox({
    baseUrl: token.baseUrl,
    accessToken: token.accessToken,
    name: opts.name,
    description: opts.description,
    serviceUrl: opts.serviceUrl,
    businessDomain: opts.businessDomain,
  });
  console.log(formatCallOutput(body, opts.pretty));
  return 0;
}

// ── list ──────────────────────────────────────────────────────────────────────

async function runToolboxList(args: string[]): Promise<number> {
  let keyword: string | undefined;
  let limit: number | undefined;
  let offset: number | undefined;
  let businessDomain = "";
  let pretty = true;
  for (let i = 0; i < args.length; i += 1) {
    const a = args[i];
    if (a === "--keyword" && args[i + 1]) { keyword = args[++i]; continue; }
    if (a === "--limit" && args[i + 1]) {
      const n = parseInt(args[++i], 10);
      if (Number.isNaN(n)) {
        console.error("--limit must be a number");
        return 1;
      }
      limit = n;
      continue;
    }
    if (a === "--offset" && args[i + 1]) {
      const n = parseInt(args[++i], 10);
      if (Number.isNaN(n)) {
        console.error("--offset must be a number");
        return 1;
      }
      offset = n;
      continue;
    }
    if ((a === "-bd" || a === "--biz-domain") && args[i + 1]) { businessDomain = args[++i]; continue; }
    if (a === "--pretty") { pretty = true; continue; }
    if (a === "--compact") { pretty = false; continue; }
  }
  if (!businessDomain) businessDomain = resolveBusinessDomain();

  const token = await ensureValidToken();
  const body = await listToolboxes({
    baseUrl: token.baseUrl,
    accessToken: token.accessToken,
    businessDomain,
    keyword, limit, offset,
  });
  console.log(formatCallOutput(body, pretty));
  return 0;
}

// ── publish / unpublish ───────────────────────────────────────────────────────

export interface ToolboxSetStatusOptions {
  boxId: string;
  businessDomain: string;
}

export function parseToolboxSetStatusArgs(args: string[]): ToolboxSetStatusOptions {
  let boxId = "";
  let businessDomain = "";
  for (let i = 0; i < args.length; i += 1) {
    const a = args[i];
    if ((a === "-bd" || a === "--biz-domain") && args[i + 1]) {
      businessDomain = args[++i];
      continue;
    }
    if (!a.startsWith("-")) boxId = a;
  }
  if (!boxId) throw new Error("Missing required argument: <box-id>");
  if (!businessDomain) businessDomain = resolveBusinessDomain();
  return { boxId, businessDomain };
}

async function runToolboxSetStatus(args: string[], status: "published" | "draft"): Promise<number> {
  let opts: ToolboxSetStatusOptions;
  try { opts = parseToolboxSetStatusArgs(args); }
  catch (e) {
    console.error(`Usage: kweaver toolbox ${status === "published" ? "publish" : "unpublish"} <box-id>`);
    return 1;
  }

  const token = await ensureValidToken();
  await setToolboxStatus({
    baseUrl: token.baseUrl,
    accessToken: token.accessToken,
    businessDomain: opts.businessDomain,
    boxId: opts.boxId,
    status,
  });
  console.error(`${status === "published" ? "Published" : "Unpublished"} toolbox ${opts.boxId}`);
  return 0;
}

// ── delete ────────────────────────────────────────────────────────────────────

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

async function runToolboxDelete(args: string[]): Promise<number> {
  let boxId = "";
  let yes = false;
  let businessDomain = "";
  for (let i = 0; i < args.length; i += 1) {
    const a = args[i];
    if (a === "--yes" || a === "-y") yes = true;
    else if ((a === "-bd" || a === "--biz-domain") && args[i + 1]) { businessDomain = args[++i]; }
    else if (!a.startsWith("-")) boxId = a;
  }
  if (!boxId) {
    console.error("Usage: kweaver toolbox delete <box-id> [-y|--yes]");
    return 1;
  }
  if (!yes) {
    const ok = await confirmYes(`Delete toolbox ${boxId}?`);
    if (!ok) { console.error("Aborted."); return 1; }
  }
  if (!businessDomain) businessDomain = resolveBusinessDomain();

  const token = await ensureValidToken();
  await deleteToolbox({
    baseUrl: token.baseUrl,
    accessToken: token.accessToken,
    businessDomain,
    boxId,
  });
  console.error(`Deleted toolbox ${boxId}`);
  return 0;
}

// ── export / import ──────────────────────────────────────────────────────────

export interface ToolboxExportOptions {
  boxId: string;
  output: string;          // file path; "-" for stdout; "" for default <type>_<id>.adp
  type: ImpexType;
  businessDomain: string;
}

export function parseToolboxExportArgs(args: string[]): ToolboxExportOptions {
  let boxId = "";
  let output = "";
  let type: ImpexType = "toolbox";
  let businessDomain = "";
  for (let i = 0; i < args.length; i += 1) {
    const a = args[i];
    if ((a === "-o" || a === "--output") && args[i + 1] !== undefined) { output = args[++i]; continue; }
    if (a === "--type" && args[i + 1]) {
      const v = args[++i];
      if (!VALID_IMPEX_TYPES.has(v as ImpexType)) {
        throw new Error(`--type must be one of: ${[...VALID_IMPEX_TYPES].join(", ")}`);
      }
      type = v as ImpexType;
      continue;
    }
    if ((a === "-bd" || a === "--biz-domain") && args[i + 1]) { businessDomain = args[++i]; continue; }
    if (!a.startsWith("-")) { boxId = a; continue; }
  }
  if (!boxId) throw new Error("Missing required argument: <box-id>");
  if (!businessDomain) businessDomain = resolveBusinessDomain();
  return { boxId, output, type, businessDomain };
}

async function runToolboxExport(args: string[]): Promise<number> {
  let opts: ToolboxExportOptions;
  try { opts = parseToolboxExportArgs(args); }
  catch (e) {
    console.error(e instanceof Error ? e.message : String(e));
    console.error("Usage: kweaver toolbox export <box-id> [-o <file>|-] [--type toolbox|mcp|operator]");
    return 1;
  }

  const token = await ensureValidToken();
  const buf = await exportConfig({
    baseUrl: token.baseUrl,
    accessToken: token.accessToken,
    businessDomain: opts.businessDomain,
    id: opts.boxId,
    type: opts.type,
  });

  if (opts.output === "-") {
    process.stdout.write(buf);
    if (buf.length === 0 || buf[buf.length - 1] !== 0x0a) process.stdout.write("\n");
    return 0;
  }

  const target = opts.output || `${opts.type}_${opts.boxId}.adp`;
  await writeFile(target, buf);
  console.error(`Exported ${opts.type} ${opts.boxId} → ${target} (${buf.byteLength} bytes)`);
  return 0;
}

export interface ToolboxImportOptions {
  filePath: string;
  type: ImpexType;
  businessDomain: string;
  pretty: boolean;
}

export function parseToolboxImportArgs(args: string[]): ToolboxImportOptions {
  let filePath = "";
  let type: ImpexType = "toolbox";
  let businessDomain = "";
  let pretty = true;
  for (let i = 0; i < args.length; i += 1) {
    const a = args[i];
    if (a === "--type" && args[i + 1]) {
      const v = args[++i];
      if (!VALID_IMPEX_TYPES.has(v as ImpexType)) {
        throw new Error(`--type must be one of: ${[...VALID_IMPEX_TYPES].join(", ")}`);
      }
      type = v as ImpexType;
      continue;
    }
    if ((a === "-bd" || a === "--biz-domain") && args[i + 1]) { businessDomain = args[++i]; continue; }
    if (a === "--pretty") { pretty = true; continue; }
    if (a === "--compact") { pretty = false; continue; }
    if (!a.startsWith("-")) { filePath = a; continue; }
  }
  if (!filePath) throw new Error("Missing required argument: <file>");
  if (!businessDomain) businessDomain = resolveBusinessDomain();
  return { filePath, type, businessDomain, pretty };
}

async function runToolboxImport(args: string[]): Promise<number> {
  let opts: ToolboxImportOptions;
  try { opts = parseToolboxImportArgs(args); }
  catch (e) {
    console.error(e instanceof Error ? e.message : String(e));
    console.error("Usage: kweaver toolbox import <file> [--type toolbox|mcp|operator]");
    return 1;
  }

  const token = await ensureValidToken();
  const body = await importConfig({
    baseUrl: token.baseUrl,
    accessToken: token.accessToken,
    businessDomain: opts.businessDomain,
    filePath: opts.filePath,
    type: opts.type,
  });
  console.log(formatCallOutput(body, opts.pretty));
  return 0;
}
