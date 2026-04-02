import { spawnSync } from "node:child_process";
import { mkdirSync, readdirSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { loadNetwork, allObjects, allRelations, allActions, generateChecksum, validateNetwork } from "@kweaver-ai/bkn";
import {
  prepareBknDirectoryForImport,
  stripBknEncodingCliArgs,
  type BknEncodingImportOptions,
} from "../utils/bkn-encoding.js";
import { ensureValidToken, formatHttpError } from "../auth/oauth.js";
import {
  listKnowledgeNetworks,
  getKnowledgeNetwork,
  createKnowledgeNetwork,
  createObjectTypes,
  buildKnowledgeNetwork,
  getBuildStatus,
} from "../api/knowledge-networks.js";
import { listTablesWithColumns, scanMetadata, getDatasource } from "../api/datasources.js";
import { createDataView, findDataView } from "../api/dataviews.js";
import {
  downloadBkn,
  uploadBkn,
  listActionSchedules,
  getActionSchedule,
  createActionSchedule,
  updateActionSchedule,
  setActionScheduleStatus,
  deleteActionSchedules,
} from "../api/bkn-backend.js";
import { formatCallOutput } from "./call.js";
import { resolveBusinessDomain } from "../config/store.js";
import { runDsImportCsv } from "./ds.js";
import {
  pollWithBackoff,
  detectPrimaryKey,
  detectDisplayKey,
  confirmYes,
} from "./bkn-utils.js";

// ── Build ───────────────────────────────────────────────────────────────────

const KN_BUILD_HELP = `kweaver bkn build <kn-id> [options]

Trigger a full build for a knowledge network.

Options:
  --wait (default)     Poll until build completes
  --no-wait            Return immediately after triggering
  --timeout <seconds>  Max wait time when --wait (default: 300)
  -bd, --biz-domain    Business domain (default: bd_public)`;

export function parseKnBuildArgs(args: string[]): {
  knId: string;
  wait: boolean;
  timeout: number;
  businessDomain: string;
} {
  let knId = "";
  let wait = true;
  let timeout = 300;
  let businessDomain = "";

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === "--help" || arg === "-h") throw new Error("help");
    if (arg === "--wait") {
      wait = true;
      continue;
    }
    if (arg === "--no-wait") {
      wait = false;
      continue;
    }
    if (arg === "--timeout" && args[i + 1]) {
      timeout = parseInt(args[i + 1], 10);
      if (Number.isNaN(timeout) || timeout < 1) timeout = 300;
      i += 1;
      continue;
    }
    if ((arg === "-bd" || arg === "--biz-domain") && args[i + 1]) {
      businessDomain = args[i + 1];
      i += 1;
      continue;
    }
    if (!arg.startsWith("-") && !knId) {
      knId = arg;
    }
  }

  if (!knId) {
    throw new Error("Missing kn-id. Usage: kweaver bkn build <kn-id> [options]");
  }
  if (!businessDomain) businessDomain = resolveBusinessDomain();
  return { knId, wait, timeout, businessDomain };
}

export async function runKnBuildCommand(args: string[]): Promise<number> {
  let options: ReturnType<typeof parseKnBuildArgs>;
  try {
    options = parseKnBuildArgs(args);
  } catch (error) {
    if (error instanceof Error && error.message === "help") {
      console.log(KN_BUILD_HELP);
      return 0;
    }
    console.error(formatHttpError(error));
    return 1;
  }

  const TERMINAL_STATES = ["completed", "failed", "success"];

  try {
    const token = await ensureValidToken();
    await buildKnowledgeNetwork({
      baseUrl: token.baseUrl,
      accessToken: token.accessToken,
      knId: options.knId,
      businessDomain: options.businessDomain,
    });
    console.error(`Build started for ${options.knId}`);

    if (!options.wait) {
      console.error("Build triggered (not waiting).");
      return 0;
    }

    console.error("Waiting for build to complete ...");
    try {
      const { state, detail } = await pollWithBackoff<{ state: string; detail?: string }>({
        fn: async () => {
          const body = await getBuildStatus({
            baseUrl: token.baseUrl,
            accessToken: token.accessToken,
            knId: options.knId,
            businessDomain: options.businessDomain,
          });
          const parsed = JSON.parse(body) as
            | Array<{ state?: string; state_detail?: string }>
            | { entries?: Array<{ state?: string; state_detail?: string }>; data?: Array<{ state?: string; state_detail?: string }> };
          const jobs = Array.isArray(parsed) ? parsed : (parsed.entries ?? parsed.data ?? []);
          const job = jobs[0];
          const st = (job?.state ?? "running").toLowerCase();
          const dt = job?.state_detail;
          if (TERMINAL_STATES.includes(st)) return { done: true, value: { state: st, detail: dt } };
          return { done: false, value: { state: st } };
        },
        interval: 2000,
        timeout: options.timeout * 1000,
      });
      console.log(state);
      if (detail) {
        console.log(`Detail: ${detail}`);
      }
      return state === "failed" ? 1 : 0;
    } catch {
      console.error(`Build did not complete within ${options.timeout}s`);
      return 1;
    }
  } catch (error) {
    console.error(formatHttpError(error));
    return 1;
  }
}

// ── Validate ────────────────────────────────────────────────────────────────

export async function runKnValidateCommand(args: string[]): Promise<number> {
  if (args.includes("--help") || args.includes("-h")) {
    console.log(
      "Usage: kweaver bkn validate <directory> [options]\n\n" +
        "Validate a local BKN directory without uploading.\n\n" +
        "Options:\n" +
        "  --detect-encoding       Detect .bkn encoding and normalize to UTF-8 (default: on)\n" +
        "  --no-detect-encoding    Require UTF-8 .bkn files\n" +
        "  --source-encoding <n>   Decode all .bkn with this encoding (e.g. gb18030)",
    );
    return 0;
  }

  let encodingOptions: BknEncodingImportOptions;
  let restArgs: string[];
  try {
    const stripped = stripBknEncodingCliArgs(args);
    encodingOptions = stripped.options;
    restArgs = stripped.rest;
  } catch (e) {
    console.error(e instanceof Error ? e.message : String(e));
    return 1;
  }

  const directory = restArgs.find((a) => !a.startsWith("-"));
  if (!directory) {
    console.error("Missing directory. Usage: kweaver bkn validate <directory> [options]");
    return 1;
  }

  const absDir = resolve(directory);
  try {
    const stat = statSync(absDir);
    if (!stat.isDirectory()) {
      console.error(`Not a directory: ${directory}`);
      return 1;
    }
  } catch (err) {
    if (err && typeof err === "object" && "code" in err && err.code === "ENOENT") {
      console.error(`Directory not found: ${directory}`);
      return 1;
    }
    throw err;
  }

  const prepared = prepareBknDirectoryForImport(absDir, encodingOptions);
  try {
    const network = await loadNetwork(prepared.dir);
    const result = validateNetwork(network);
    if (!result.ok) {
      for (const e of result.errors) console.error(`  - ${e}`);
      console.error(`BKN validation failed: ${result.errors.length} error(s)`);
      return 1;
    }
    const objs = allObjects(network);
    const rels = allRelations(network);
    const acts = allActions(network);
    console.log(
      `Valid: ${objs.length} object types, ${rels.length} relation types, ${acts.length} action types`
    );
    return 0;
  } catch (error) {
    console.error(`BKN validation failed: ${error instanceof Error ? error.message : String(error)}`);
    return 1;
  } finally {
    prepared.cleanup();
  }
}

// ── Push / Pull (BKN tar import/export) ─────────────────────────────────────

export interface KnPushOptions {
  directory: string;
  branch: string;
  businessDomain: string;
  pretty: boolean;
  encodingOptions: BknEncodingImportOptions;
}

export function parseKnPushArgs(args: string[]): KnPushOptions {
  const { rest, options: encodingOptions } = stripBknEncodingCliArgs(args);
  let directory = "";
  let branch = "main";
  let businessDomain = "";
  let pretty = true;

  for (let i = 0; i < rest.length; i += 1) {
    const arg = rest[i];

    if (arg === "--help" || arg === "-h") {
      throw new Error("help");
    }

    if (arg === "--branch") {
      branch = args[i + 1] ?? "main";
      if (!branch || branch.startsWith("-")) {
        throw new Error("Missing value for --branch");
      }
      i += 1;
      continue;
    }

    if (arg === "-bd" || arg === "--biz-domain") {
      businessDomain = args[i + 1] ?? "bd_public";
      if (!businessDomain || businessDomain.startsWith("-")) {
        throw new Error("Missing value for biz-domain flag");
      }
      i += 1;
      continue;
    }

    if (arg === "--pretty") {
      pretty = true;
      continue;
    }

    if (!arg.startsWith("-") && !directory) {
      directory = arg;
      continue;
    }

    throw new Error(`Unsupported bkn push argument: ${arg}`);
  }

  if (!directory) {
    throw new Error("Missing directory. Usage: kweaver bkn push <directory> [--branch main] [-bd value]");
  }

  if (!businessDomain) businessDomain = resolveBusinessDomain();
  return { directory, branch, businessDomain, pretty, encodingOptions };
}

export interface KnPullOptions {
  knId: string;
  directory: string;
  branch: string;
  businessDomain: string;
}

export function parseKnPullArgs(args: string[]): KnPullOptions {
  let knId = "";
  let directory = "";
  let branch = "main";
  let businessDomain = "";

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];

    if (arg === "--help" || arg === "-h") {
      throw new Error("help");
    }

    if (arg === "--branch") {
      branch = args[i + 1] ?? "main";
      if (!branch || branch.startsWith("-")) {
        throw new Error("Missing value for --branch");
      }
      i += 1;
      continue;
    }

    if (arg === "-bd" || arg === "--biz-domain") {
      businessDomain = args[i + 1] ?? "bd_public";
      if (!businessDomain || businessDomain.startsWith("-")) {
        throw new Error("Missing value for biz-domain flag");
      }
      i += 1;
      continue;
    }

    if (!arg.startsWith("-")) {
      if (!knId) {
        knId = arg;
      } else if (!directory) {
        directory = arg;
      } else {
        throw new Error(`Unexpected positional argument: ${arg}`);
      }
      continue;
    }

    throw new Error(`Unsupported bkn pull argument: ${arg}`);
  }

  if (!knId) {
    throw new Error("Missing kn-id. Usage: kweaver bkn pull <kn-id> [<directory>] [--branch main] [-bd value]");
  }

  if (!businessDomain) businessDomain = resolveBusinessDomain();
  return { knId, directory: directory || knId, branch, businessDomain };
}

export function packDirectoryToTar(dirPath: string): Buffer {
  const absPath = resolve(dirPath);
  const entries = readdirSync(absPath);
  const args = ["cf", "-", "-C", absPath, ...entries];
  const result = spawnSync("tar", args, {
    encoding: "buffer",
    env: { ...process.env, COPYFILE_DISABLE: "1" },
  });
  if (result.error) {
    if ("code" in result.error && result.error.code === "ENOENT") {
      throw new Error(
        "tar executable not found. On Windows, ensure tar.exe is in PATH " +
        "(ships with Windows 10 1803+) or install GNU tar via Git for Windows / scoop.",
      );
    }
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error(`tar pack failed: ${result.stderr?.toString() ?? result.status}`);
  }
  return result.stdout as Buffer;
}

export function extractTarToDirectory(tarBuffer: Buffer, dirPath: string): void {
  const absPath = resolve(dirPath);
  mkdirSync(absPath, { recursive: true });
  const result = spawnSync("tar", ["xf", "-", "-C", absPath], {
    input: tarBuffer,
  });
  if (result.error) {
    if ("code" in result.error && result.error.code === "ENOENT") {
      throw new Error(
        "tar executable not found. On Windows, ensure tar.exe is in PATH " +
        "(ships with Windows 10 1803+) or install GNU tar via Git for Windows / scoop.",
      );
    }
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error(`tar extract failed: ${result.stderr?.toString() ?? result.status}`);
  }
}

const KN_PUSH_HELP = `kweaver bkn push <directory> [options]

Pack a BKN directory into a tar and upload to import as a knowledge network.

Options:
  --branch <s>       Branch name (default: main)
  -bd, --biz-domain  Business domain (default: bd_public)
  --pretty           Pretty-print JSON output
  --detect-encoding  Detect .bkn encoding and normalize to UTF-8 (default: on)
  --no-detect-encoding  Do not detect; require UTF-8 .bkn files
  --source-encoding <name>  Decode all .bkn files with this encoding (e.g. gb18030); overrides detection`;

const KN_PULL_HELP = `kweaver bkn pull <kn-id> [<directory>] [options]

Download a BKN tar from a knowledge network and extract to a local directory.

Options:
  <directory>        Output directory (default: <kn-id>)
  --branch <s>       Branch name (default: main)
  -bd, --biz-domain  Business domain (default: bd_public)`;

export async function runKnPushCommand(args: string[]): Promise<number> {
  let options: KnPushOptions;
  try {
    options = parseKnPushArgs(args);
  } catch (error) {
    if (error instanceof Error && error.message === "help") {
      console.log(KN_PUSH_HELP);
      return 0;
    }
    console.error(formatHttpError(error));
    return 1;
  }

  const absDir = resolve(options.directory);
  try {
    const stat = statSync(absDir);
    if (!stat.isDirectory()) {
      console.error(`Not a directory: ${options.directory}`);
      return 1;
    }
  } catch (err) {
    if (err && typeof err === "object" && "code" in err && err.code === "ENOENT") {
      console.error(`Directory not found: ${options.directory}`);
      return 1;
    }
    throw err;
  }

  const prepared = prepareBknDirectoryForImport(absDir, options.encodingOptions);
  const workDir = prepared.dir;
  try {
    try {
      const network = await loadNetwork(workDir);
      const objs = allObjects(network);
      const rels = allRelations(network);
      const acts = allActions(network);
      console.error(
        `Validated: ${objs.length} object types, ${rels.length} relation types, ${acts.length} action types`
      );
    } catch (error) {
      console.error(`BKN validation failed: ${error instanceof Error ? error.message : String(error)}`);
      return 1;
    }

    try {
      await generateChecksum(workDir);
      console.error("Checksum generated");
    } catch (error) {
      console.error(`Checksum generation failed: ${error instanceof Error ? error.message : String(error)}`);
      return 1;
    }

    try {
      const tarBuffer = packDirectoryToTar(workDir);
      const token = await ensureValidToken();
      const body = await uploadBkn({
        baseUrl: token.baseUrl,
        accessToken: token.accessToken,
        tarBuffer,
        businessDomain: options.businessDomain,
        branch: options.branch,
      });
      console.log(formatCallOutput(body, options.pretty));
      return 0;
    } catch (error) {
      console.error(formatHttpError(error));
      return 1;
    }
  } finally {
    prepared.cleanup();
  }
}

export async function runKnPullCommand(args: string[]): Promise<number> {
  let options: KnPullOptions;
  try {
    options = parseKnPullArgs(args);
  } catch (error) {
    if (error instanceof Error && error.message === "help") {
      console.log(KN_PULL_HELP);
      return 0;
    }
    console.error(formatHttpError(error));
    return 1;
  }

  try {
    const token = await ensureValidToken();
    const tarBuffer = await downloadBkn({
      baseUrl: token.baseUrl,
      accessToken: token.accessToken,
      knId: options.knId,
      businessDomain: options.businessDomain,
      branch: options.branch,
    });
    const absDir = resolve(options.directory);
    extractTarToDirectory(tarBuffer, absDir);
    console.log(`Extracted to ${absDir}`);
    return 0;
  } catch (error) {
    console.error(formatHttpError(error));
    return 1;
  }
}

// ── Create from datasource ──────────────────────────────────────────────────

const KN_CREATE_FROM_DS_HELP = `kweaver bkn create-from-ds <ds-id> --name X [options]

Create a knowledge network from a datasource (dataviews + object types + optional build).

Options:
  --name <s>       Knowledge network name (required)
  --tables <a,b>   Comma-separated table names (default: all)
  --build (default)  Build after creation
  --no-build       Skip build after creation
  --timeout <n>    Build timeout in seconds (default: 300)
  -bd, --biz-domain  Business domain (default: bd_public)
  --pretty         Pretty-print output (default)`;

export function parseKnCreateFromDsArgs(args: string[]): {
  dsId: string;
  name: string;
  tables: string[];
  build: boolean;
  timeout: number;
  businessDomain: string;
  pretty: boolean;
} {
  let dsId = "";
  let name = "";
  let tablesStr = "";
  let build = true;
  let timeout = 300;
  let businessDomain = "";
  let pretty = true;

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === "--help" || arg === "-h") throw new Error("help");
    if (arg === "--name" && args[i + 1]) {
      name = args[++i];
      continue;
    }
    if (arg === "--tables" && args[i + 1]) {
      tablesStr = args[++i];
      continue;
    }
    if (arg === "--build") {
      build = true;
      continue;
    }
    if (arg === "--no-build") {
      build = false;
      continue;
    }
    if (arg === "--timeout" && args[i + 1]) {
      timeout = parseInt(args[++i], 10);
      if (Number.isNaN(timeout) || timeout < 1) timeout = 300;
      continue;
    }
    if ((arg === "-bd" || arg === "--biz-domain") && args[i + 1]) {
      businessDomain = args[++i];
      continue;
    }
    if (arg === "--pretty") {
      pretty = true;
      continue;
    }
    if (!arg.startsWith("-") && !dsId) {
      dsId = arg;
    }
  }

  const tables = tablesStr ? tablesStr.split(",").map((s) => s.trim()).filter(Boolean) : [];
  if (!dsId || !name) {
    throw new Error("Usage: kweaver bkn create-from-ds <ds-id> --name X [options]");
  }
  if (!businessDomain) businessDomain = resolveBusinessDomain();
  return { dsId, name, tables, build, timeout, businessDomain, pretty };
}

/** Sanitize a table name into a BKN-safe ID (alphanumeric + underscore). */
function sanitizeBknId(name: string): string {
  return name.replace(/[^a-zA-Z0-9_]/g, "_").replace(/^(\d)/, "_$1");
}

/** Generate a BKN ObjectType YAML markdown file for a table. */
export function generateObjectTypeBkn(
  tableName: string,
  dvId: string,
  pk: string,
  dk: string,
  columns: Array<{ name: string; type: string }>,
): string {
  const safeId = sanitizeBknId(tableName);
  const header = `## ObjectType: ${safeId}\n\n**${tableName}**\n`;

  const dsTable = `### Data Source\n\n| Type | ID | Name |\n|------|-----|------|\n| data_view | ${dvId} | ${tableName} |\n`;

  const dpHeader = `### Data Properties\n\n| Property | Display Name | Type | Primary Key | Display Key |\n|----------|-------------|------|-------------|-------------|\n`;
  const dpRows = columns.map((c) => {
    const isPk = c.name === pk ? "yes" : "no";
    const isDk = c.name === dk ? "yes" : "no";
    return `| ${c.name} | ${c.name} | string | ${isPk} | ${isDk} |`;
  }).join("\n");

  const frontmatter = `---\ntype: object_type\nid: ${safeId}\nname: ${tableName}\n---\n\n`;
  return `${frontmatter}${header}\n${dsTable}\n${dpHeader}${dpRows}\n`;
}

export async function runKnCreateFromDsCommand(
  args: string[],
  sampleRows?: Record<string, Array<Record<string, string | null>>>,
): Promise<number> {
  let options: ReturnType<typeof parseKnCreateFromDsArgs>;
  try {
    options = parseKnCreateFromDsArgs(args);
  } catch (error) {
    if (error instanceof Error && error.message === "help") {
      console.log(KN_CREATE_FROM_DS_HELP);
      return 0;
    }
    console.error(formatHttpError(error));
    return 1;
  }

  try {
    const token = await ensureValidToken();
    const base = {
      baseUrl: token.baseUrl,
      accessToken: token.accessToken,
      businessDomain: options.businessDomain,
    };

    const tablesBody = await listTablesWithColumns({ ...base, id: options.dsId });
    const allTables = JSON.parse(tablesBody) as Array<{
      name: string;
      columns: Array<{ name: string; type: string }>;
    }>;

    const targetTables = options.tables.length > 0
      ? allTables.filter((t) => options.tables.includes(t.name))
      : allTables;

    if (targetTables.length === 0) {
      console.error("No tables available");
      return 1;
    }

    // Phase 1: Create DataViews for each table
    console.error(`Creating data views for ${targetTables.length} table(s) ...`);
    const viewMap: Record<string, string> = {};
    for (const t of targetTables) {
      const found = await findDataView({
        ...base,
        name: t.name,
        datasourceId: options.dsId,
        exact: true,
        wait: true,
      });
      const dvId =
        found[0]?.id ??
        (await createDataView({
          ...base,
          name: t.name,
          datasourceId: options.dsId,
          table: t.name,
          fields: t.columns.map((c) => ({ name: c.name, type: c.type })),
        }));
      viewMap[t.name] = dvId;
    }

    // Phase 2: Create the KN record
    const knBody = JSON.stringify({
      name: options.name,
      branch: "main",
      base_branch: "",
    });
    const knResponse = await createKnowledgeNetwork({
      ...base,
      body: knBody,
    });
    const knParsed = JSON.parse(knResponse) as Record<string, unknown> | Array<Record<string, unknown>>;
    const knItem = Array.isArray(knParsed) ? knParsed[0] : knParsed;
    const knId = String(knItem?.id ?? "");
    console.error(`Knowledge network created: ${knId}`);

    // Phase 3: Create object types via REST API
    console.error(`Creating ${targetTables.length} object type(s) ...`);
    const otResults: Array<{ name: string; id: string; field_count: number }> = [];
    for (const t of targetTables) {
      const pk = detectPrimaryKey(t, sampleRows?.[t.name]);
      const dk = detectDisplayKey(t, pk);
      const uniqueProps = [pk, dk].filter((x, i, a) => a.indexOf(x) === i);
      const entry = {
        branch: "main",
        name: t.name,
        data_source: { type: "data_view", id: viewMap[t.name] },
        primary_keys: [pk],
        display_key: dk,
        data_properties: t.columns.map((c) => ({
          name: c.name,
          display_name: c.name,
          type: "string",
          mapped_field: { name: c.name, type: c.type || "varchar" },
        })),
      };
      const otBody = JSON.stringify({ entries: [entry] });
      const otResponse = await createObjectTypes({
        ...base,
        knId,
        body: otBody,
      });
      const otParsed = JSON.parse(otResponse) as { entries?: Array<{ id?: string; name?: string }> };
      const otItem = otParsed.entries?.[0];
      otResults.push({
        name: t.name,
        id: otItem?.id ?? "",
        field_count: t.columns.length,
      });
      console.error(`  Created: ${t.name} (${t.columns.length} fields, pk=${pk}, dk=${dk})`);
    }

    if (otResults.length === 0) {
      const errorOutput = {
        kn_id: knId,
        kn_name: options.name,
        error: "No object types were created",
      };
      console.log(JSON.stringify(errorOutput, null, options.pretty ? 2 : 0));
      return 1;
    }

    let statusStr = "skipped";
    if (options.build) {
      console.error("Building ...");
      await buildKnowledgeNetwork({ ...base, knId });
      const TERMINAL = ["completed", "failed", "success"];
      try {
        statusStr = await pollWithBackoff({
          fn: async () => {
            const statusBody = await getBuildStatus({ ...base, knId });
            const statusParsed = JSON.parse(statusBody) as
              | Array<{ state?: string }>
              | { entries?: Array<{ state?: string }> };
            const jobs = Array.isArray(statusParsed) ? statusParsed : (statusParsed.entries ?? []);
            const state = (jobs[0]?.state ?? "running").toLowerCase();
            if (TERMINAL.includes(state)) return { done: true, value: state };
            return { done: false, value: "running" };
          },
          interval: 2000,
          timeout: options.timeout * 1000,
        });
      } catch {
        // timeout — statusStr remains "skipped"
      }
    }

    const output = {
      kn_id: knId,
      kn_name: options.name,
      object_types: otResults,
      status: statusStr,
    };
    console.log(JSON.stringify(output, null, options.pretty ? 2 : 0));
    return 0;
  } catch (error) {
    console.error(formatHttpError(error));
    return 1;
  }
}

// ── Create from CSV ─────────────────────────────────────────────────────────

const KN_CREATE_FROM_CSV_HELP = `kweaver bkn create-from-csv <ds-id> --files <glob> --name X [options]

Import CSV files into datasource, then create a knowledge network.

Options:
  --files <s>          CSV file paths (comma-separated or glob, required)
  --name <s>           Knowledge network name (required)
  --table-prefix <s>   Table name prefix (default: none)
  --batch-size <n>     Rows per batch (default: 500)
  --tables <a,b>       Tables to include in KN (default: all imported)
  --build (default)    Build after creation
  --no-build           Skip build
  --timeout <n>        Build timeout in seconds (default: 300)
  -bd, --biz-domain    Business domain (default: bd_public)`;

export function parseKnCreateFromCsvArgs(args: string[]): {
  dsId: string;
  files: string;
  name: string;
  tablePrefix: string;
  batchSize: number;
  tables: string[];
  build: boolean;
  timeout: number;
  businessDomain: string;
} {
  let dsId = "";
  let files = "";
  let name = "";
  let tablePrefix = "";
  let batchSize = 500;
  let tablesStr = "";
  let build = true;
  let timeout = 300;
  let businessDomain = "";

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === "--help" || arg === "-h") throw new Error("help");
    if (arg === "--files" && args[i + 1]) {
      files = args[++i];
      continue;
    }
    if (arg === "--name" && args[i + 1]) {
      name = args[++i];
      continue;
    }
    if (arg === "--table-prefix" && args[i + 1]) {
      tablePrefix = args[++i];
      continue;
    }
    if (arg === "--batch-size" && args[i + 1]) {
      batchSize = parseInt(args[++i], 10);
      if (Number.isNaN(batchSize) || batchSize < 1) batchSize = 500;
      continue;
    }
    if (arg === "--tables" && args[i + 1]) {
      tablesStr = args[++i];
      continue;
    }
    if (arg === "--build") {
      build = true;
      continue;
    }
    if (arg === "--no-build") {
      build = false;
      continue;
    }
    if (arg === "--timeout" && args[i + 1]) {
      timeout = parseInt(args[++i], 10);
      if (Number.isNaN(timeout) || timeout < 1) timeout = 300;
      continue;
    }
    if ((arg === "-bd" || arg === "--biz-domain") && args[i + 1]) {
      businessDomain = args[++i];
      continue;
    }
    if (!arg.startsWith("-") && !dsId) {
      dsId = arg;
    }
  }

  const tables = tablesStr ? tablesStr.split(",").map((s) => s.trim()).filter(Boolean) : [];
  if (!dsId || !files || !name) {
    throw new Error("Usage: kweaver bkn create-from-csv <ds-id> --files <glob> --name X [options]");
  }
  if (!businessDomain) businessDomain = resolveBusinessDomain();
  return { dsId, files, name, tablePrefix, batchSize, tables, build, timeout, businessDomain };
}

export async function runKnCreateFromCsvCommand(args: string[]): Promise<number> {
  let options: ReturnType<typeof parseKnCreateFromCsvArgs>;
  try {
    options = parseKnCreateFromCsvArgs(args);
  } catch (error) {
    if (error instanceof Error && error.message === "help") {
      console.log(KN_CREATE_FROM_CSV_HELP);
      return 0;
    }
    console.error(formatHttpError(error));
    return 1;
  }

  // Phase 1: Import CSVs
  console.error("Phase 1: Importing CSVs ...");
  const importArgs = [
    options.dsId,
    "--files", options.files,
    "--table-prefix", options.tablePrefix,
    "--batch-size", String(options.batchSize),
    "-bd", options.businessDomain,
  ];
  const importResult = await runDsImportCsv(importArgs);
  if (importResult.code !== 0) {
    console.error("CSV import failed — aborting KN creation");
    return importResult.code;
  }

  // Phase 1.5: Scan datasource metadata so platform discovers newly imported tables
  console.error("Scanning datasource metadata ...");
  try {
    const token = await ensureValidToken();
    const dsBody = await getDatasource({
      baseUrl: token.baseUrl,
      accessToken: token.accessToken,
      id: options.dsId,
      businessDomain: options.businessDomain,
    });
    const dsParsed = JSON.parse(dsBody) as { type?: string };
    await scanMetadata({
      baseUrl: token.baseUrl,
      accessToken: token.accessToken,
      id: options.dsId,
      dsType: dsParsed.type ?? "mysql",
      businessDomain: options.businessDomain,
    });
  } catch (err) {
    console.error(`Scan warning (continuing): ${String(err)}`);
  }

  // Phase 2: Create KN from datasource
  console.error("Phase 2: Creating knowledge network ...");
  const tableNames = options.tables.length > 0 ? options.tables : importResult.tables;
  if (tableNames.length === 0) {
    console.error("No tables available for KN creation — aborting");
    return 1;
  }
  const knArgs = [
    options.dsId,
    "--name", options.name,
    "--tables", tableNames.join(","),
    options.build ? "--build" : "--no-build",
    "--timeout", String(options.timeout),
    "-bd", options.businessDomain,
  ];
  return runKnCreateFromDsCommand(knArgs, importResult.sampleRows);
}

// ── Action Schedule ──────────────────────────────────────────────────────────

export interface ActionScheduleParsed {
  action: string;
  knId: string;
  itemId: string;
  body: string;
  extra: string;
  yes: boolean;
  pretty: boolean;
  businessDomain: string;
}

export function parseActionScheduleArgs(args: string[]): ActionScheduleParsed {
  const [action, ...rest] = args;
  if (!action || action === "--help" || action === "-h") throw new Error("help");

  let pretty = true;
  let businessDomain = "";
  let yes = false;
  const positional: string[] = [];

  for (let i = 0; i < rest.length; i += 1) {
    const arg = rest[i];
    if (arg === "--help" || arg === "-h") throw new Error("help");
    if (arg === "--pretty") { pretty = true; continue; }
    if ((arg === "-bd" || arg === "--biz-domain") && rest[i + 1]) { businessDomain = rest[++i]; continue; }
    if (arg === "-y" || arg === "--yes") { yes = true; continue; }
    positional.push(arg);
  }

  const [knId, itemId, extra] = positional;
  if (!knId) throw new Error("Missing kn-id. Usage: kweaver bkn action-schedule <action> <kn-id> ...");
  if (!businessDomain) businessDomain = resolveBusinessDomain();

  return { action, knId, itemId: itemId || "", body: itemId || "", extra: extra || "", yes, pretty, businessDomain };
}

export async function runKnActionScheduleCommand(args: string[]): Promise<number> {
  let parsed: ActionScheduleParsed;
  try {
    parsed = parseActionScheduleArgs(args);
  } catch (error) {
    if (error instanceof Error && error.message === "help") {
      console.log(`kweaver bkn action-schedule <action> <kn-id> [args] [--pretty] [-bd value]

Actions:
  list <kn-id>                                    List action schedules
  get <kn-id> <schedule-id>                       Get schedule details
  create <kn-id> '<json>'                         Create schedule
  update <kn-id> <schedule-id> '<json>'           Update schedule
  set-status <kn-id> <schedule-id> <status>       Enable/disable schedule (enabled|disabled)
  delete <kn-id> <schedule-ids> [-y]              Delete schedule(s) (comma-separated)`);
      return 0;
    }
    console.error(formatHttpError(error));
    return 1;
  }

  const { action, knId, itemId, body, extra, yes, pretty, businessDomain } = parsed;
  const token = await ensureValidToken();
  const base = { baseUrl: token.baseUrl, accessToken: token.accessToken, businessDomain };

  if (action === "list") {
    const result = await listActionSchedules({ ...base, knId });
    console.log(formatCallOutput(result, pretty));
    return 0;
  }
  if (action === "get") {
    if (!itemId) { console.error("Missing schedule-id"); return 1; }
    const result = await getActionSchedule({ ...base, knId, scheduleId: itemId });
    console.log(formatCallOutput(result, pretty));
    return 0;
  }
  if (action === "create") {
    if (!itemId) { console.error("Missing JSON body"); return 1; }
    const result = await createActionSchedule({ ...base, knId, body });
    console.log(formatCallOutput(result, pretty));
    return 0;
  }
  if (action === "update") {
    if (!itemId || !extra) { console.error("Missing schedule-id or JSON body"); return 1; }
    const result = await updateActionSchedule({ ...base, knId, scheduleId: itemId, body: extra });
    console.log(formatCallOutput(result, pretty));
    return 0;
  }
  if (action === "set-status") {
    if (!itemId || !extra) { console.error("Missing schedule-id or status"); return 1; }
    const result = await setActionScheduleStatus({ ...base, knId, scheduleId: itemId, body: JSON.stringify({ status: extra }) });
    console.log(formatCallOutput(result, pretty));
    return 0;
  }
  if (action === "delete") {
    if (!itemId) { console.error("Missing schedule-ids"); return 1; }
    if (!yes) {
      const confirmed = await confirmYes(`Delete action schedule(s) ${itemId}?`);
      if (!confirmed) { console.log("Cancelled."); return 0; }
    }
    const result = await deleteActionSchedules({ ...base, knId, scheduleIds: itemId });
    console.log(formatCallOutput(result, pretty));
    return 0;
  }

  console.error(`Unknown action-schedule action: ${action}`);
  return 1;
}
