import { createInterface } from "node:readline";
import { ensureValidToken, formatHttpError, with401RefreshRetry } from "../auth/oauth.js";
import {
  testDatasource,
  createDatasource,
  listDatasources,
  getDatasource,
  deleteDatasource,
  listTables,
  listTablesWithColumns,
} from "../api/datasources.js";
import { formatCallOutput } from "./call.js";
import { resolveBusinessDomain } from "../config/store.js";

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
    Test connectivity, register datasource, and discover tables.`);
    return 0;
  }

  const dispatch = (): Promise<number> => {
    if (subcommand === "list") return runDsListCommand(rest);
    if (subcommand === "get") return runDsGetCommand(rest);
    if (subcommand === "delete") return runDsDeleteCommand(rest);
    if (subcommand === "tables") return runDsTablesCommand(rest);
    if (subcommand === "connect") return runDsConnectCommand(rest);
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

async function runDsConnectCommand(args: string[]): Promise<number> {
  let dbType = "";
  let host = "";
  let port = 0;
  let database = "";
  let account = "";
  let password = "";
  let schema: string | undefined;
  let name: string | undefined;

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
    if (!arg.startsWith("-")) {
      if (!dbType) dbType = arg;
      else if (!host) host = arg;
      else if (port === 0) port = parseInt(arg, 10);
      else if (!database) database = arg;
    }
  }

  if (!dbType || !host || !database || !account || !password) {
    console.error(
      "Usage: kweaver ds connect <db_type> <host> <port> <database> --account X --password Y [--schema Z] [--name N]"
    );
    return 1;
  }
  if (Number.isNaN(port) || port < 1) {
    console.error("Invalid port");
    return 1;
  }

  const token = await ensureValidToken();
  const base = { baseUrl: token.baseUrl, accessToken: token.accessToken };

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

  const dsName = name ?? database;
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

  const dsId = extractDatasourceId(createBody);
  if (!dsId) {
    console.error("Failed to get datasource ID from create response");
    return 1;
  }

  const tablesBody = await listTablesWithColumns({
    ...base,
    id: dsId,
  });

  const tables = JSON.parse(tablesBody) as Array<{ name: string; columns: Array<{ name: string; type: string; comment?: string }> }>;
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
