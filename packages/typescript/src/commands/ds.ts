import { createInterface } from "node:readline";
import { statSync } from "node:fs";
import { glob } from "node:fs/promises";
import { resolve as resolvePath } from "node:path";
import { ensureValidToken, formatHttpError, with401RefreshRetry } from "../auth/oauth.js";
import {
  testDatasource,
  createDatasource,
  listDatasources,
  getDatasource,
  deleteDatasource,
  listTables,
  listTablesWithColumns,
  scanMetadata,
} from "../api/datasources.js";
import { formatCallOutput } from "./call.js";
import { resolveBusinessDomain } from "../config/store.js";
import {
  parseCsvFile,
  buildTableName,
  splitBatches,
  buildFieldMappings,
  buildDagBody,
} from "./import-csv.js";
import { executeDataflow } from "../api/dataflow.js";

function confirmYes(prompt: string): Promise<boolean> {
  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    rl.question(`${prompt} [y/N] `, (answer) => {
      rl.close();
      const trimmed = answer.trim().toLowerCase();
      resolve(trimmed === "y" || trimmed === "yes");
    });
  });
}

function extractDatasourceId(body: string): string {
  const parsed = JSON.parse(body) as Record<string, unknown> | Array<Record<string, unknown>>;
  const item = Array.isArray(parsed) ? parsed[0] : parsed;
  if (!item || typeof item !== "object") return "";
  const id = item.id ?? item.ds_id;
  return id != null ? String(id) : "";
}

export async function runDsCommand(args: string[]): Promise<number> {
  const [subcommand, ...rest] = args;

  if (!subcommand || subcommand === "--help" || subcommand === "-h") {
    console.log(`kweaver ds

Subcommands:
  list [--keyword X] [--type Y]     List datasources
  get <id>                          Get datasource details
  delete <id> [-y]                  Delete a datasource
  tables <id> [--keyword X]         List tables with columns
  connect <db_type> <host> <port> <database> --account X --password Y [--schema Z] [--name N]
                                              [--reuse-existing|--force-new]
    Test connectivity, register datasource, and discover tables.
    By default reuses an existing ds with the same (type, host, port, database, account)
    instead of creating a duplicate. --force-new always creates a new entry.
  import-csv <ds-id> --files <glob_or_list> [--table-prefix X] [--batch-size N]
    Import CSV files into datasource tables via dataflow API.`);
    return 0;
  }

  const dispatch = (): Promise<number> => {
    if (subcommand === "list") return runDsListCommand(rest);
    if (subcommand === "get") return runDsGetCommand(rest);
    if (subcommand === "delete") return runDsDeleteCommand(rest);
    if (subcommand === "tables") return runDsTablesCommand(rest);
    if (subcommand === "connect") return runDsConnectCommand(rest);
    if (subcommand === "import-csv") return runDsImportCsvCommand(rest);
    return Promise.resolve(-1);
  };

  try {
    return await with401RefreshRetry(async () => {
      const code = await dispatch();
      if (code === -1) {
        console.error(`Unknown ds subcommand: ${subcommand}`);
        return 1;
      }
      return code;
    });
  } catch (error) {
    console.error(formatHttpError(error));
    return 1;
  }
}

export function parseDsListArgs(args: string[]): {
  keyword?: string;
  type?: string;
  businessDomain: string;
  pretty: boolean;
} {
  let keyword: string | undefined;
  let type: string | undefined;
  let businessDomain = "";
  let pretty = true;

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === "--help" || arg === "-h") throw new Error("help");
    if (arg === "--keyword" && args[i + 1]) {
      keyword = args[++i];
      continue;
    }
    if (arg === "--type" && args[i + 1]) {
      type = args[++i];
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
  }
  if (!businessDomain) businessDomain = resolveBusinessDomain();
  return { keyword, type, businessDomain, pretty };
}

async function runDsListCommand(args: string[]): Promise<number> {
  try {
    const opts = parseDsListArgs(args);
    const token = await ensureValidToken();
    const body = await listDatasources({
      baseUrl: token.baseUrl,
      accessToken: token.accessToken,
      keyword: opts.keyword,
      type: opts.type,
      businessDomain: opts.businessDomain,
    });
    console.log(formatCallOutput(body, opts.pretty));
    return 0;
  } catch (error) {
    if (error instanceof Error && error.message === "help") {
      console.log(`kweaver ds list [options]

Options:
  --keyword <s>   Filter by keyword
  --type <s>      Filter by database type
  -bd, --biz-domain  Business domain (default: bd_public)
  --pretty         Pretty-print JSON (default)`);
      return 0;
    }
    throw error;
  }
}

async function runDsGetCommand(args: string[]): Promise<number> {
  const id = args.find((a) => !a.startsWith("-"));
  if (!id) {
    console.error("Usage: kweaver ds get <id>");
    return 1;
  }

  const token = await ensureValidToken();
  const body = await getDatasource({
    baseUrl: token.baseUrl,
    accessToken: token.accessToken,
    id,
  });
  console.log(formatCallOutput(body, true));
  return 0;
}

async function runDsDeleteCommand(args: string[]): Promise<number> {
  let id = "";
  let yes = false;
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === "--yes" || arg === "-y") yes = true;
    else if (!arg.startsWith("-")) id = arg;
  }
  if (!id) {
    console.error("Usage: kweaver ds delete <id> [-y]");
    return 1;
  }

  if (!yes) {
    const confirmed = await confirmYes("Are you sure you want to delete this datasource?");
    if (!confirmed) {
      console.error("Aborted.");
      return 1;
    }
  }

  const token = await ensureValidToken();
  await deleteDatasource({
    baseUrl: token.baseUrl,
    accessToken: token.accessToken,
    id,
  });
  console.error(`Deleted ${id}`);
  return 0;
}

async function runDsTablesCommand(args: string[]): Promise<number> {
  let id = "";
  let keyword: string | undefined;
  let pretty = true;

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === "--keyword" && args[i + 1]) {
      keyword = args[++i];
      continue;
    }
    if (arg === "--pretty") {
      pretty = true;
      continue;
    }
    if (!arg.startsWith("-")) id = arg;
  }
  if (!id) {
    console.error("Usage: kweaver ds tables <id> [--keyword X]");
    return 1;
  }

  const token = await ensureValidToken();
  const body = await listTablesWithColumns({
    baseUrl: token.baseUrl,
    accessToken: token.accessToken,
    id,
    keyword,
  });
  console.log(formatCallOutput(body, pretty));
  return 0;
}

/**
 * Match candidate signature against a list response (the kind returned by
 * `listDatasources`). Connection metadata lives under `bin_data` — host,
 * port, account, plus type-specific fields (`database_name` for MySQL etc.).
 *
 * Exported for unit testing.
 */
export interface DsMatchSignature {
  type: string;
  host: string;
  port: number;
  database: string;
  account: string;
  name?: string;
}

export interface DsMatchHit {
  id: string;
  name: string;
  matchedByName: boolean;
  matchedByTuple: boolean;
}

interface DsListEntry {
  id?: string;
  name?: string;
  type?: string;
  bin_data?: {
    host?: string;
    port?: number;
    account?: string;
    database_name?: string;
    schema_name?: string;
  };
}

export function findExistingDatasource(
  listBody: string,
  sig: DsMatchSignature,
): DsMatchHit | undefined {
  const parsed = JSON.parse(listBody) as { entries?: DsListEntry[] } | DsListEntry[];
  const entries = Array.isArray(parsed) ? parsed : (parsed.entries ?? []);
  const tupleMatch = entries.find(
    (e) =>
      e.id &&
      e.type === sig.type &&
      e.bin_data?.host === sig.host &&
      Number(e.bin_data?.port) === Number(sig.port) &&
      e.bin_data?.database_name === sig.database &&
      e.bin_data?.account === sig.account,
  );
  if (tupleMatch) {
    return {
      id: String(tupleMatch.id),
      name: String(tupleMatch.name ?? ""),
      matchedByName: tupleMatch.name === sig.name,
      matchedByTuple: true,
    };
  }
  if (sig.name) {
    const nameMatch = entries.find((e) => e.id && e.name === sig.name);
    if (nameMatch) {
      return {
        id: String(nameMatch.id),
        name: String(nameMatch.name),
        matchedByName: true,
        matchedByTuple: false,
      };
    }
  }
  return undefined;
}

export function findDatasourceIdByName(listBody: string, name: string): string | undefined {
  const parsed = JSON.parse(listBody) as { entries?: DsListEntry[] } | DsListEntry[];
  const entries = Array.isArray(parsed) ? parsed : (parsed.entries ?? []);
  const hit = entries.find((e) => e.id && e.name === name);
  return hit?.id ? String(hit.id) : undefined;
}

function isDuplicateNameError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  // HttpError.message is just "HTTP 400 ..."; the description lives in body.
  const status = "status" in err ? Number((err as { status: unknown }).status) : NaN;
  const body = "body" in err ? String((err as { body: unknown }).body) : "";
  if (status !== 400) return false;
  return /数据源名称已存在|datasource name.*exist|already exists/i.test(body);
}

async function runDsConnectCommand(args: string[]): Promise<number> {
  let dbType = "";
  let host = "";
  let port = 0;
  let database = "";
  let account = "";
  let password = "";
  let schema: string | undefined;
  let name: string | undefined;
  let forceNew = false;

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === "--account" && args[i + 1]) {
      account = args[++i];
      continue;
    }
    if (arg === "--password" && args[i + 1]) {
      password = args[++i];
      continue;
    }
    if (arg === "--schema" && args[i + 1]) {
      schema = args[++i];
      continue;
    }
    if (arg === "--name" && args[i + 1]) {
      name = args[++i];
      continue;
    }
    if (arg === "--force-new") {
      forceNew = true;
      continue;
    }
    if (arg === "--reuse-existing") {
      forceNew = false;
      continue;
    }
    if (!arg.startsWith("-")) {
      if (!dbType) dbType = arg;
      else if (!host) host = arg;
      else if (port === 0) port = parseInt(arg, 10);
      else if (!database) database = arg;
    }
  }

  if (!dbType || !host || !database || !account || !password) {
    console.error(
      "Usage: kweaver ds connect <db_type> <host> <port> <database> --account X --password Y [--schema Z] [--name N] [--reuse-existing|--force-new]"
    );
    return 1;
  }
  if (Number.isNaN(port) || port < 1) {
    console.error("Invalid port");
    return 1;
  }

  const token = await ensureValidToken();
  const base = { baseUrl: token.baseUrl, accessToken: token.accessToken };
  const dsName = name ?? database;

  // Pre-flight dedup: connection-tuple match is the silent-orphan vector.
  // Backend already rejects duplicate names with 400, but won't notice
  // tuple collisions, so we own that check.
  if (!forceNew) {
    const listBody = await listDatasources({ ...base });
    const hit = findExistingDatasource(listBody, {
      type: dbType,
      host,
      port,
      database,
      account,
      name: dsName,
    });
    if (hit) {
      const why = hit.matchedByTuple
        ? "matched by (type,host,port,database,account)"
        : "matched by --name";
      console.error(
        `Reusing existing datasource ${hit.id} (${hit.name}); ${why}. Use --force-new to override.`,
      );
      return printDsConnectOutput(base, hit.id);
    }
  }

  console.error("Testing connectivity ...");
  await testDatasource({
    ...base,
    type: dbType,
    host,
    port,
    database,
    account,
    password,
    schema,
  });

  let dsId = "";
  try {
    const createBody = await createDatasource({
      ...base,
      name: dsName,
      type: dbType,
      host,
      port,
      database,
      account,
      password,
      schema,
    });
    dsId = extractDatasourceId(createBody);
  } catch (err) {
    // Backend checks name uniqueness but not tuple. If we raced another caller
    // (or tuple match got disabled by --force-new and the name still collides),
    // turn the raw 400 into a useful pointer to the existing id.
    if (isDuplicateNameError(err)) {
      // Backend rejected the name; look it up specifically (not by tuple —
      // sibling ds sharing the same connection would mislead the pointer).
      const listBody = await listDatasources({ ...base });
      const existingId = findDatasourceIdByName(listBody, dsName);
      if (existingId) {
        console.error(
          `Datasource name '${dsName}' already exists as ${existingId}. Re-run without --force-new to reuse it, or pick a different --name.`,
        );
        return 1;
      }
    }
    throw err;
  }
  if (!dsId) {
    console.error("Failed to get datasource ID from create response");
    return 1;
  }

  return printDsConnectOutput(base, dsId);
}

async function printDsConnectOutput(
  base: { baseUrl: string; accessToken: string },
  dsId: string,
): Promise<number> {
  const tablesBody = await listTablesWithColumns({ ...base, id: dsId });
  const tables = JSON.parse(tablesBody) as Array<{
    name: string;
    columns: Array<{ name: string; type: string; comment?: string }>;
  }>;
  const output = {
    datasource_id: dsId,
    tables: tables.map((t) => ({
      name: t.name,
      columns: t.columns.map((c) => ({ name: c.name, type: c.type, comment: c.comment })),
    })),
  };
  console.log(JSON.stringify(output, null, 2));
  return 0;
}

// ── import-csv ────────────────────────────────────────────────────────────────

const IMPORT_CSV_HELP = `kweaver ds import-csv <ds-id> --files <glob_or_list> [options]

Import CSV files into datasource tables via dataflow API.

Options:
  --files <s>          CSV file paths (comma-separated or glob pattern, required)
  --table-prefix <s>   Table name prefix (default: none)
  --batch-size <n>     Rows per batch (default: 500, range: 1-10000)
  -bd, --biz-domain    Business domain (default: bd_public)`;

export function parseImportCsvArgs(args: string[]): {
  datasourceId: string;
  files: string;
  tablePrefix: string;
  batchSize: number;
  businessDomain: string;
} {
  let datasourceId = "";
  let files = "";
  let tablePrefix = "";
  let batchSize = 500;
  let businessDomain = "";

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === "--help" || arg === "-h") throw new Error("help");
    if (arg === "--files" && args[i + 1]) {
      files = args[++i];
      continue;
    }
    if (arg === "--table-prefix" && args[i + 1]) {
      tablePrefix = args[++i];
      continue;
    }
    if (arg === "--batch-size" && args[i + 1]) {
      const n = parseInt(args[++i], 10);
      if (Number.isNaN(n) || n < 1 || n > 10000) {
        throw new Error("--batch-size must be between 1 and 10000");
      }
      batchSize = n;
      continue;
    }
    if ((arg === "-bd" || arg === "--biz-domain") && args[i + 1]) {
      businessDomain = args[++i];
      continue;
    }
    if (!arg.startsWith("-") && !datasourceId) {
      datasourceId = arg;
    }
  }

  if (!businessDomain) businessDomain = resolveBusinessDomain();
  return { datasourceId, files, tablePrefix, batchSize, businessDomain };
}

export async function resolveFiles(pattern: string): Promise<string[]> {
  const parts = pattern.split(",").map((p) => p.trim()).filter(Boolean);
  const result: string[] = [];

  for (const part of parts) {
    if (part.includes("*") || part.includes("?")) {
      const matched: string[] = [];
      for await (const entry of glob(part)) {
        const p = String(entry);
        if (/\.csv$/i.test(p)) {
          matched.push(resolvePath(p));
        }
      }
      result.push(...matched);
    } else {
      const abs = resolvePath(part);
      statSync(abs); // throws if file does not exist
      result.push(abs);
    }
  }

  if (result.length === 0) {
    throw new Error(`No CSV files matched: ${pattern}`);
  }

  return result;
}

export interface ImportCsvResult {
  code: number;
  tables: string[]; // successfully imported table names
  failed: string[]; // failed table names
  tableColumns: Record<string, string[]>; // tableName → column names
  sampleRows: Record<string, Array<Record<string, string | null>>>; // tableName → first 100 rows
}

export async function runDsImportCsv(args: string[]): Promise<ImportCsvResult> {
  let options: ReturnType<typeof parseImportCsvArgs>;
  try {
    options = parseImportCsvArgs(args);
  } catch (error) {
    if (error instanceof Error && error.message === "help") {
      console.log(IMPORT_CSV_HELP);
      return { code: 0, tables: [], failed: [], tableColumns: {}, sampleRows: {} };
    }
    throw error;
  }

  if (!options.datasourceId) {
    console.error("Usage: kweaver ds import-csv <ds-id> --files <glob_or_list> [options]");
    return { code: 1, tables: [], failed: [], tableColumns: {}, sampleRows: {} };
  }
  if (!options.files) {
    console.error("Error: --files is required");
    return { code: 1, tables: [], failed: [], tableColumns: {}, sampleRows: {} };
  }

  // 1. Get credentials
  const token = await ensureValidToken();
  const base = { baseUrl: token.baseUrl, accessToken: token.accessToken };

  // 2. Resolve glob / file list
  const filePaths = await resolveFiles(options.files);

  // 3. Get datasource type
  const dsBody = await getDatasource({ ...base, id: options.datasourceId, businessDomain: options.businessDomain });
  const dsData = JSON.parse(dsBody) as Record<string, unknown>;
  const datasourceType =
    String(dsData.type ?? dsData.ds_type ?? dsData.data_type ?? "mysql");

  // Phase 1: Parse all CSV files upfront
  interface ParsedFile {
    filePath: string;
    tableName: string;
    headers: string[];
    rows: Array<Record<string, string | null>>;
  }
  const parsed: ParsedFile[] = [];

  for (const filePath of filePaths) {
    const tableName = buildTableName(filePath, options.tablePrefix);
    let csvData: Awaited<ReturnType<typeof parseCsvFile>>;
    try {
      csvData = await parseCsvFile(filePath);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[${tableName}] skipping — parse error: ${msg}`);
      continue;
    }
    if (csvData.headers.length === 0) {
      console.error(`[${tableName}] skipping — no headers`);
      continue;
    }
    if (csvData.rows.length === 0) {
      console.error(`[${tableName}] skipping — no rows`);
      continue;
    }
    parsed.push({ filePath, tableName, headers: csvData.headers, rows: csvData.rows });
  }

  if (parsed.length === 0) {
    console.error("All files were skipped — nothing to import");
    return { code: 1, tables: [], failed: [], tableColumns: {}, sampleRows: {} };
  }

  // Phase 2: Import each file in batches
  const succeeded: string[] = [];
  const failed: string[] = [];
  const tableColumns: Record<string, string[]> = {};
  const sampleRows: Record<string, Array<Record<string, string | null>>> = {};

  for (const { tableName, headers, rows } of parsed) {
    const batches = splitBatches(rows, options.batchSize);
    const fieldMappings = buildFieldMappings(headers);
    let batchFailed = false;

    for (let bIdx = 0; bIdx < batches.length; bIdx += 1) {
      const batch = batches[bIdx];
      const tableExist = bIdx > 0;
      const batchLabel = `${bIdx + 1}/${batches.length}`;
      const rowCount = batch.length;

      const dagBody = buildDagBody({
        datasourceId: options.datasourceId,
        datasourceType,
        tableName,
        tableExist,
        data: batch,
        fieldMappings,
      });

      const t0 = Date.now();
      process.stderr.write(`[${tableName}] batch ${batchLabel} (${rowCount} rows)... `);

      try {
        await executeDataflow({
          ...base,
          businessDomain: options.businessDomain,
          body: dagBody,
        });
        const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
        process.stderr.write(`${elapsed}s\n`);
      } catch (err) {
        const msg = formatHttpError(err);
        process.stderr.write(`FAILED\n`);
        console.error(`[${tableName}] batch ${batchLabel} error: ${msg}`);
        batchFailed = true;
        break;
      }
    }

    if (batchFailed) {
      failed.push(tableName);
    } else {
      succeeded.push(tableName);
      tableColumns[tableName] = headers;
      sampleRows[tableName] = parsed.find((p) => p.tableName === tableName)?.rows.slice(0, 100) ?? [];
    }
  }

  // Summary
  console.error(
    `\nImport complete: ${succeeded.length} succeeded, ${failed.length} failed.`
  );
  if (failed.length > 0) {
    console.error(`Failed tables: ${failed.join(", ")}`);
  }

  // Refresh the platform metadata catalog so the freshly imported tables
  // are visible to ds tables / bkn create-from-ds without manual scan.
  // Best-effort: scan failures shouldn't mask a successful import.
  if (succeeded.length > 0) {
    process.stderr.write("Scanning datasource metadata ...\n");
    try {
      await scanMetadata({
        ...base,
        id: options.datasourceId,
        dsType: datasourceType,
        businessDomain: options.businessDomain,
      });
    } catch (err) {
      console.error(`Scan warning (continuing): ${formatHttpError(err)}`);
    }
  }

  return { code: failed.length > 0 ? 1 : 0, tables: succeeded, failed, tableColumns, sampleRows };
}

export async function runDsImportCsvCommand(args: string[]): Promise<number> {
  const result = await runDsImportCsv(args);
  console.log(
    JSON.stringify(
      {
        tables: result.tables,
        failed: result.failed,
        summary: { succeeded: result.tables.length, failed: result.failed.length },
      },
      null,
      2
    )
  );
  return result.code;
}
