import { createInterface } from "node:readline";
import { execSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { loadNetwork, allObjects, allRelations, allActions, generateChecksum, validateNetwork } from "@kweaver-ai/bkn";
import {
  prepareBknDirectoryForImport,
  stripBknEncodingCliArgs,
  type BknEncodingImportOptions,
} from "../utils/bkn-encoding.js";
import { ensureValidToken, formatHttpError, with401RefreshRetry } from "../auth/oauth.js";
import {
  listKnowledgeNetworks,
  getKnowledgeNetwork,
  createKnowledgeNetwork,
  updateKnowledgeNetwork,
  deleteKnowledgeNetwork,
  createObjectTypes,
  buildKnowledgeNetwork,
  getBuildStatus,
} from "../api/knowledge-networks.js";
import {
  subgraph,
  actionExecutionGet,
  actionLogsList,
  actionLogGet,
  actionLogCancel,
} from "../api/ontology-query.js";
import { semanticSearch } from "../api/semantic-search.js";
import { listTablesWithColumns, scanMetadata, getDatasource } from "../api/datasources.js";
import { createDataView, findDataView } from "../api/dataviews.js"; // used by runKnCreateFromDsCommand
import { downloadBkn, uploadBkn } from "../api/bkn-backend.js";
import { formatCallOutput } from "./call.js";
import { resolveBusinessDomain } from "../config/store.js";
import { runDsImportCsv } from "./ds.js";
import {
  runKnObjectTypeCommand,
  runKnRelationTypeCommand,
  runKnActionTypeCommand,
} from "./bkn-schema.js";
import {
  pollWithBackoff,
  parseOntologyQueryFlags,
  parseJsonObject,
  parseSearchAfterArray,
  confirmYes,
  DISPLAY_HINTS,
  detectPrimaryKey,
  detectDisplayKey,
} from "./bkn-utils.js";

// Re-export shared utils for backward compatibility (tests import from bkn.js)
export {
  pollWithBackoff,
  parseOntologyQueryFlags,
  parseJsonObject,
  parseSearchAfterArray,
  confirmYes,
  DISPLAY_HINTS,
  detectPrimaryKey,
  detectDisplayKey,
} from "./bkn-utils.js";
export type { PollOptions } from "./bkn-utils.js";

// Re-export schema types and parse functions for backward compatibility
export {
  parseObjectTypeCreateArgs,
  parseKnObjectTypeQueryArgs,
  parseKnActionTypeExecuteArgs,
  parseRelationTypeCreateArgs,
  applyObjectTypeMerge,
  stripObjectTypeForPut,
  parseObjectTypeUpdateArgs,
  parseObjectTypeDeleteArgs,
  parseRelationTypeUpdateArgs,
  parseRelationTypeDeleteArgs,
  runKnObjectTypeCommand,
  runKnRelationTypeCommand,
  runKnActionTypeCommand,
} from "./bkn-schema.js";
export type {
  KnObjectTypeQueryOptions,
  KnActionTypeExecuteOptions,
  ObjectTypeMergeFields,
  ObjectTypeUpdateParsed,
} from "./bkn-schema.js";

export interface KnListOptions {
  offset: number;
  limit: number;
  sort: string;
  direction: "asc" | "desc";
  businessDomain: string;
  detail: boolean;
  pretty: boolean;
  verbose: boolean;
  name_pattern?: string;
  tag?: string;
}

interface SimpleListItem {
  name: string;
  id: string;
  description: string;
  detail?: string;
}

export function formatSimpleKnList(text: string, pretty: boolean, includeDetail = false): string {
  const parsed = JSON.parse(text) as { entries?: Array<Record<string, unknown>> };
  const entries = Array.isArray(parsed.entries) ? parsed.entries : [];
  const simplified: SimpleListItem[] = entries.map((entry) => ({
    name: typeof entry.name === "string" ? entry.name : "",
    id: typeof entry.id === "string" ? entry.id : "",
    description: typeof entry.comment === "string" ? entry.comment : "",
    ...(includeDetail && { detail: typeof entry.detail === "string" ? entry.detail : "" }),
  }));
  return JSON.stringify(simplified, null, pretty ? 2 : 0);
}

export function parseKnListArgs(args: string[]): KnListOptions {
  let offset = 0;
  let limit = 30;
  let sort = "update_time";
  let direction: "asc" | "desc" = "desc";
  let businessDomain = "";
  let detail = false;
  let pretty = true;
  let verbose = false;
  let name_pattern: string | undefined;
  let tag: string | undefined;

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];

    if (arg === "--help" || arg === "-h") {
      throw new Error("help");
    }

    if (arg === "--offset") {
      offset = parseInt(args[i + 1] ?? "0", 10);
      if (Number.isNaN(offset) || offset < 0) offset = 0;
      i += 1;
      continue;
    }

    if (arg === "--limit") {
      limit = parseInt(args[i + 1] ?? "30", 10);
      if (Number.isNaN(limit) || limit < 1) limit = 30;
      i += 1;
      continue;
    }

    if (arg === "--sort") {
      sort = args[i + 1] ?? "update_time";
      i += 1;
      continue;
    }

    if (arg === "--direction") {
      const d = (args[i + 1] ?? "desc").toLowerCase();
      direction = d === "asc" ? "asc" : "desc";
      i += 1;
      continue;
    }

    if (arg === "--name-pattern") {
      name_pattern = args[i + 1] ?? "";
      i += 1;
      continue;
    }

    if (arg === "--tag") {
      tag = args[i + 1] ?? "";
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

    if (arg === "--detail") {
      detail = true;
      continue;
    }

    if (arg === "--verbose" || arg === "-v") {
      verbose = true;
      continue;
    }

    if (arg === "--simple") {
      continue;
    }

    throw new Error(`Unsupported kn list argument: ${arg}`);
  }

  if (!businessDomain) businessDomain = resolveBusinessDomain();
  return { offset, limit, sort, direction, businessDomain, detail, pretty, verbose, name_pattern, tag };
}

export interface KnGetOptions {
  knId: string;
  stats: boolean;
  export: boolean;
  businessDomain: string;
  pretty: boolean;
}

export function parseKnGetArgs(args: string[]): KnGetOptions {
  let knId = "";
  let stats = false;
  let exportMode = false;
  let businessDomain = "";
  let pretty = true;

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];

    if (arg === "--help" || arg === "-h") {
      throw new Error("help");
    }

    if (arg === "--stats") {
      stats = true;
      continue;
    }

    if (arg === "--export") {
      exportMode = true;
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

    if (!arg.startsWith("-") && !knId) {
      knId = arg;
      continue;
    }

    throw new Error(`Unsupported kn get argument: ${arg}`);
  }

  if (!knId) {
    throw new Error("Missing kn-id. Usage: kweaver bkn get <kn-id> [options]");
  }

  if (!businessDomain) businessDomain = resolveBusinessDomain();
  return { knId, stats, export: exportMode, businessDomain, pretty };
}

export interface KnCreateOptions {
  body: string;
  import_mode?: "normal" | "ignore" | "overwrite";
  validate_dependency?: boolean;
  businessDomain: string;
  pretty: boolean;
}

const BODY_FILE_FLAGS = [
  "--name",
  "--comment",
  "--tags",
  "--icon",
  "--color",
  "--branch",
  "--base-branch",
];

export function parseKnCreateArgs(args: string[]): KnCreateOptions {
  let bodyFile: string | undefined;
  let import_mode: "normal" | "ignore" | "overwrite" | undefined;
  let validate_dependency: boolean | undefined;
  let businessDomain = "";
  let pretty = true;

  const flags: Record<string, string> = {};
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];

    if (arg === "--help" || arg === "-h") {
      throw new Error("help");
    }

    if (arg === "--body-file") {
      bodyFile = args[i + 1];
      if (!bodyFile || bodyFile.startsWith("-")) {
        throw new Error("Missing value for --body-file");
      }
      i += 1;
      continue;
    }

    if (arg === "--import-mode") {
      const m = (args[i + 1] ?? "normal").toLowerCase();
      if (m !== "normal" && m !== "ignore" && m !== "overwrite") {
        throw new Error("--import-mode must be normal, ignore, or overwrite");
      }
      import_mode = m;
      i += 1;
      continue;
    }

    if (arg === "--validate-dependency") {
      const v = (args[i + 1] ?? "true").toLowerCase();
      validate_dependency = v === "true" || v === "1";
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

    if (BODY_FILE_FLAGS.includes(arg)) {
      const key = arg.replace(/^--/, "").replace(/-/g, "_");
      flags[key] = args[i + 1] ?? "";
      i += 1;
      continue;
    }

    throw new Error(`Unsupported kn create argument: ${arg}`);
  }

  let body: string;
  if (bodyFile) {
    if (Object.keys(flags).length > 0) {
      throw new Error("Cannot use --body-file together with --name, --comment, --tags, etc.");
    }
    body = readFileSync(bodyFile, "utf8");
  } else {
    const name = flags.name;
    if (!name) {
      throw new Error("--name is required when not using --body-file");
    }
    const payload: Record<string, unknown> = {
      name: flags.name,
      branch: flags.branch || "main",
      base_branch: flags.base_branch ?? "",
    };
    if (flags.comment) payload.comment = flags.comment;
    if (flags.tags) payload.tags = flags.tags.split(",").map((s) => s.trim()).filter(Boolean);
    if (flags.icon) payload.icon = flags.icon;
    if (flags.color) payload.color = flags.color;
    body = JSON.stringify(payload);
  }

  if (!businessDomain) businessDomain = resolveBusinessDomain();
  return { body, import_mode, validate_dependency, businessDomain, pretty };
}

export interface KnUpdateOptions {
  knId: string;
  body: string;
  businessDomain: string;
  pretty: boolean;
}

export function parseKnUpdateArgs(args: string[]): KnUpdateOptions {
  let knId = "";
  let bodyFile: string | undefined;
  let businessDomain = "";
  let pretty = true;

  const flags: Record<string, string> = {};
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];

    if (arg === "--help" || arg === "-h") {
      throw new Error("help");
    }

    if (arg === "--body-file") {
      bodyFile = args[i + 1];
      if (!bodyFile || bodyFile.startsWith("-")) {
        throw new Error("Missing value for --body-file");
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

    if (BODY_FILE_FLAGS.includes(arg)) {
      const key = arg.replace(/^--/, "").replace(/-/g, "_");
      flags[key] = args[i + 1] ?? "";
      i += 1;
      continue;
    }

    if (!arg.startsWith("-") && !knId) {
      knId = arg;
      continue;
    }

    throw new Error(`Unsupported kn update argument: ${arg}`);
  }

  if (!knId) {
    throw new Error("Missing kn-id. Usage: kweaver bkn update <kn-id> [options]");
  }

  let body: string;
  if (bodyFile) {
    if (Object.keys(flags).length > 0) {
      throw new Error("Cannot use --body-file together with --name, --comment, --tags, etc.");
    }
    body = readFileSync(bodyFile, "utf8");
  } else {
    const name = flags.name;
    if (!name) {
      throw new Error("--name is required when not using --body-file");
    }
    const payload: Record<string, unknown> = {
      name: flags.name,
      branch: flags.branch || "main",
      base_branch: flags.base_branch ?? "",
    };
    if (flags.comment) payload.comment = flags.comment;
    if (flags.tags) payload.tags = flags.tags.split(",").map((s) => s.trim()).filter(Boolean);
    if (flags.icon) payload.icon = flags.icon;
    if (flags.color) payload.color = flags.color;
    body = JSON.stringify(payload);
  }

  if (!businessDomain) businessDomain = resolveBusinessDomain();
  return { knId, body, businessDomain, pretty };
}

export interface KnDeleteOptions {
  knId: string;
  businessDomain: string;
  yes: boolean;
}

export function parseKnDeleteArgs(args: string[]): KnDeleteOptions {
  let knId = "";
  let businessDomain = "";
  let yes = false;

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];

    if (arg === "--help" || arg === "-h") {
      throw new Error("help");
    }

    if (arg === "--yes" || arg === "-y") {
      yes = true;
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

    if (!arg.startsWith("-") && !knId) {
      knId = arg;
      continue;
    }

    throw new Error(`Unsupported kn delete argument: ${arg}`);
  }

  if (!knId) {
    throw new Error("Missing kn-id. Usage: kweaver bkn delete <kn-id>");
  }

  if (!businessDomain) businessDomain = resolveBusinessDomain();
  return { knId, businessDomain, yes };
}

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


const KN_HELP = `kweaver bkn

Subcommands:
  list [options]       List business knowledge networks
  get <kn-id> [options]   Get knowledge network detail (use --stats or --export)
  create [options]     Create a knowledge network (empty or from --body-file)
  create-from-ds <ds-id> --name X [--tables a,b] [--build]   Create KN from datasource
  create-from-csv <ds-id> --files <glob> --name X [--table-prefix P] [--build]
    Import CSVs then create knowledge network
  update <kn-id> [options]  Update a knowledge network
  delete <kn-id>       Delete a knowledge network
  build <kn-id> [--wait|--no-wait] [--timeout n]   Trigger full build
  validate <directory> [--detect-encoding|--no-detect-encoding] [--source-encoding n]   Validate local BKN (no upload)
  push <directory> [--branch main] [--detect-encoding|--no-detect-encoding] [--source-encoding n]   Upload BKN as tar
  pull <kn-id> [<directory>] [--branch main]   Download BKN tar and extract
  export <kn-id>       Export knowledge network (alias for get --export)
  stats <kn-id>        Get statistics (alias for get --stats)
  search <kn-id> <query> [options]   Semantic search within a knowledge network
  object-type list <kn-id>   List object types (schema)
  object-type get <kn-id> <ot-id>   Get object type details
  object-type create <kn-id> [options]   Create object type (--name --dataview-id --primary-key --display-key)
  object-type update <kn-id> <ot-id> [options]   Update object type
  object-type delete <kn-id> <ot-ids> [-y]   Delete object type(s)
  object-type query <kn-id> <ot-id> ['<json>']   Query object instances (ontology-query; supports --limit/--search-after)
  object-type properties <kn-id> <ot-id> '<json>'   Query instance properties (json: {"_instance_identities":[{pk:val}],"properties":[...]})
  relation-type list <kn-id>   List relation types (schema)
  relation-type get <kn-id> <rt-id>   Get relation type details
  relation-type create <kn-id> [options]   Create relation type (--name --source --target [--mapping src:tgt])
  relation-type update <kn-id> <rt-id> [options]   Update relation type
  relation-type delete <kn-id> <rt-ids> [-y]   Delete relation type(s)
  subgraph <kn-id> '<json>'   Query subgraph
  action-type list <kn-id>   List action types (schema)
  action-type query <kn-id> <at-id> '<json>'   Query action info
  action-type execute <kn-id> <at-id> '<json>'   Execute action (has side effects)
  action-execution get <kn-id> <execution-id>   Get execution status
  action-log list <kn-id> [options]   List action execution logs
  action-log get <kn-id> <log-id>   Get single execution log
  action-log cancel <kn-id> <log-id>   Cancel running execution (has side effects)

Use 'kweaver bkn <subcommand> --help' for subcommand options.`;

export async function runKnCommand(args: string[]): Promise<number> {
  const [subcommand, ...rest] = args;

  if (!subcommand || subcommand === "--help" || subcommand === "-h") {
    console.log(KN_HELP);
    return 0;
  }

  const dispatch = (): Promise<number> => {
    if (subcommand === "list") return runKnListCommand(rest);
    if (subcommand === "get") return runKnGetCommand(rest);
    if (subcommand === "create") return runKnCreateCommand(rest);
    if (subcommand === "create-from-ds") return runKnCreateFromDsCommand(rest);
    if (subcommand === "create-from-csv") return runKnCreateFromCsvCommand(rest);
    if (subcommand === "update") return runKnUpdateCommand(rest);
    if (subcommand === "delete") return runKnDeleteCommand(rest);
    if (subcommand === "build") return runKnBuildCommand(rest);
    if (subcommand === "validate") return runKnValidateCommand(rest);
    if (subcommand === "push") return runKnPushCommand(rest);
    if (subcommand === "pull") return runKnPullCommand(rest);
    if (subcommand === "export")
      return runKnGetCommand([...(rest[0] ? [rest[0]] : []), "--export", ...rest.slice(1)]);
    if (subcommand === "stats")
      return runKnGetCommand([...(rest[0] ? [rest[0]] : []), "--stats", ...rest.slice(1)]);
    if (subcommand === "search") return runKnSearchCommand(rest);
    if (subcommand === "object-type") return runKnObjectTypeCommand(rest);
    if (subcommand === "relation-type") return runKnRelationTypeCommand(rest);
    if (subcommand === "subgraph") return runKnSubgraphCommand(rest);
    if (subcommand === "action-type") return runKnActionTypeCommand(rest);
    if (subcommand === "action-execution") return runKnActionExecutionCommand(rest);
    if (subcommand === "action-log") return runKnActionLogCommand(rest);
    return Promise.resolve(-1);
  };

  try {
    return await with401RefreshRetry(async () => {
      const code = await dispatch();
      if (code === -1) {
        console.error(`Unknown bkn subcommand: ${subcommand}`);
        return 1;
      }
      return code;
    });
  } catch (error) {
    console.error(formatHttpError(error));
    return 1;
  }
}


async function runKnSubgraphCommand(args: string[]): Promise<number> {
  let filteredArgs: string[];
  let pretty: boolean;
  let businessDomain: string;
  try {
    const parsed = parseOntologyQueryFlags(args);
    filteredArgs = parsed.filteredArgs;
    pretty = parsed.pretty;
    businessDomain = parsed.businessDomain;
  } catch (error) {
    if (error instanceof Error && error.message === "help") {
      console.log(`kweaver bkn subgraph <kn-id> '<json>' [--pretty] [-bd value]

Query subgraph via ontology-query API. JSON body format see references/json-formats.md#subgraph.`);
      return 0;
    }
    throw error;
  }

  const [knId, body] = filteredArgs;
  if (!knId || !body) {
    console.error("Usage: kweaver bkn subgraph <kn-id> '<json>' [options]");
    return 1;
  }

  try {
    // Auto-detect query_type=relation_path when body contains source_object_type_id
    let queryType: "" | "relation_path" | undefined;
    try {
      const parsedBody = JSON.parse(body) as Record<string, unknown>;
      if (parsedBody.source_object_type_id) {
        queryType = "relation_path";
      }
    } catch {
      // Not valid JSON — let the API return the error
    }

    const token = await ensureValidToken();
    const result = await subgraph({
      baseUrl: token.baseUrl,
      accessToken: token.accessToken,
      knId,
      body,
      businessDomain,
      queryType,
    });
    if (result.length > 100_000) {
      console.error(
        `[warn] Response is ${(result.length / 1024).toFixed(0)}KB. Consider narrowing the subgraph query.`
      );
    }
    console.log(formatCallOutput(result, pretty));
    return 0;
  } catch (error) {
    console.error(formatHttpError(error));
    return 1;
  }
}

async function runKnActionExecutionCommand(args: string[]): Promise<number> {
  let filteredArgs: string[];
  let pretty: boolean;
  let businessDomain: string;
  try {
    const parsed = parseOntologyQueryFlags(args);
    filteredArgs = parsed.filteredArgs;
    pretty = parsed.pretty;
    businessDomain = parsed.businessDomain;
  } catch (error) {
    if (error instanceof Error && error.message === "help") {
      console.log(`kweaver bkn action-execution get <kn-id> <execution-id> [--pretty] [-bd value]

Get action execution status.`);
      return 0;
    }
    throw error;
  }

  const [subAction, knId, executionId] = filteredArgs;
  if (subAction !== "get" || !knId || !executionId) {
    console.error("Usage: kweaver bkn action-execution get <kn-id> <execution-id> [options]");
    return 1;
  }

  try {
    const token = await ensureValidToken();
    const result = await actionExecutionGet({
      baseUrl: token.baseUrl,
      accessToken: token.accessToken,
      knId,
      executionId,
      businessDomain,
    });
    console.log(formatCallOutput(result, pretty));
    return 0;
  } catch (error) {
    console.error(formatHttpError(error));
    return 1;
  }
}

async function runKnActionLogCommand(args: string[]): Promise<number> {
  const [action, ...rest] = args;
  if (!action || action === "--help" || action === "-h") {
    console.log(`kweaver bkn action-log list <kn-id> [options]
kweaver bkn action-log get <kn-id> <log-id> [options]
kweaver bkn action-log cancel <kn-id> <log-id> [options]

List/get execution logs. cancel has side effects - only use when explicitly requested.
Options for list: --limit, --need-total, --action-type-id, --status, --trigger-type, --search-after`);
    return 0;
  }

  let pretty = true;
  let businessDomain = "";
  let limit = 30;
  let needTotal: boolean | undefined;
  let actionTypeId: string | undefined;
  let status: string | undefined;
  let triggerType: string | undefined;
  let searchAfter: string | undefined;

  const filteredArgs: string[] = [];
  for (let i = 0; i < rest.length; i += 1) {
    const arg = rest[i];
    if (arg === "--help" || arg === "-h") {
      throw new Error("help");
    }
    if (arg === "--pretty") {
      pretty = true;
      continue;
    }
    if ((arg === "-bd" || arg === "--biz-domain") && rest[i + 1]) {
      businessDomain = rest[i + 1];
      i += 1;
      continue;
    }
    if (arg === "--limit" && rest[i + 1]) {
      limit = parseInt(rest[i + 1], 10);
      i += 1;
      continue;
    }
    if (arg === "--need-total" && rest[i + 1]) {
      needTotal = rest[i + 1].toLowerCase() === "true";
      i += 1;
      continue;
    }
    if (arg === "--action-type-id" && rest[i + 1]) {
      actionTypeId = rest[i + 1];
      i += 1;
      continue;
    }
    if (arg === "--status" && rest[i + 1]) {
      status = rest[i + 1];
      i += 1;
      continue;
    }
    if (arg === "--trigger-type" && rest[i + 1]) {
      triggerType = rest[i + 1];
      i += 1;
      continue;
    }
    if (arg === "--search-after" && rest[i + 1]) {
      searchAfter = rest[i + 1];
      i += 1;
      continue;
    }
    filteredArgs.push(arg);
  }

  if (!businessDomain) businessDomain = resolveBusinessDomain();

  try {
    const token = await ensureValidToken();
    const base = {
      baseUrl: token.baseUrl,
      accessToken: token.accessToken,
      businessDomain,
    };

    if (action === "list") {
      const [knId] = filteredArgs;
      if (!knId) {
        console.error("Usage: kweaver bkn action-log list <kn-id> [options]");
        return 1;
      }
      const result = await actionLogsList({
        ...base,
        knId,
        limit,
        needTotal,
        actionTypeId,
        status,
        triggerType,
        searchAfter,
      });
      console.log(formatCallOutput(result, pretty));
      return 0;
    }

    if (action === "get") {
      const [knId, logId] = filteredArgs;
      if (!knId || !logId) {
        console.error("Usage: kweaver bkn action-log get <kn-id> <log-id> [options]");
        return 1;
      }
      const result = await actionLogGet({ ...base, knId, logId });
      console.log(formatCallOutput(result, pretty));
      return 0;
    }

    if (action === "cancel") {
      const [knId, logId] = filteredArgs;
      if (!knId || !logId) {
        console.error("Usage: kweaver bkn action-log cancel <kn-id> <log-id> [options]");
        return 1;
      }
      const result = await actionLogCancel({ ...base, knId, logId });
      console.log(formatCallOutput(result, pretty));
      return 0;
    }

    console.error(`Unknown action-log action: ${action}. Use list, get, or cancel.`);
    return 1;
  } catch (error) {
    console.error(formatHttpError(error));
    return 1;
  }
}

async function runKnListCommand(args: string[]): Promise<number> {
  let options: KnListOptions;
  try {
    options = parseKnListArgs(args);
  } catch (error) {
    if (error instanceof Error && error.message === "help") {
      console.log(KN_LIST_HELP);
      return 0;
    }
    console.error(formatHttpError(error));
    return 1;
  }

  try {
    const token = await ensureValidToken();
    const body = await listKnowledgeNetworks({
      baseUrl: token.baseUrl,
      accessToken: token.accessToken,
      businessDomain: options.businessDomain,
      offset: options.offset,
      limit: options.limit,
      sort: options.sort,
      direction: options.direction,
      name_pattern: options.name_pattern,
      tag: options.tag,
    });

    if (body) {
      console.log(
        options.verbose
          ? formatCallOutput(body, options.pretty)
          : formatSimpleKnList(body, options.pretty, options.detail)
      );
    }
    return 0;
  } catch (error) {
    console.error(formatHttpError(error));
    return 1;
  }
}

const KN_LIST_HELP = `kweaver bkn list [options]

List business knowledge networks from the ontology-manager API.

Options:
  --offset <n>       Offset (default: 0)
  --limit <n>        Limit (default: 30)
  --sort <key>       Sort field (default: update_time)
  --direction <asc|desc>  Sort direction (default: desc)
  --name-pattern <s> Filter by name pattern
  --tag <s>          Filter by tag
  --detail           Include the detail field in simplified output
  --verbose, -v      Show full JSON response
  -bd, --biz-domain <value>  Business domain (default: bd_public)
  --pretty           Pretty-print JSON output (applies to both modes)`;

const KN_GET_HELP = `kweaver bkn get <kn-id> [options]

Get knowledge network detail.

Options:
  --stats            Include statistics
  --export           Export mode (include sub-types)
  -bd, --biz-domain <value>  Business domain (default: bd_public)
  --pretty           Pretty-print JSON output`;

const KN_CREATE_HELP = `kweaver bkn create [options]

Create a knowledge network.

Options:
  --name <s>         Name (required unless --body-file)
  --comment <s>      Comment
  --tags <t1,t2>     Comma-separated tags
  --icon <s>         Icon
  --color <s>        Color
  --branch <s>       Branch (default: main)
  --base-branch <s>  Base branch (default: empty for main)
  --body-file <path> Read full JSON body from file (cannot combine with flags above)
  --import-mode <normal|ignore|overwrite>  Import mode (default: normal)
  --validate-dependency <true|false>  Validate dependency (default: true)
  -bd, --biz-domain <value>  Business domain (default: bd_public)
  --pretty           Pretty-print JSON output`;

const KN_UPDATE_HELP = `kweaver bkn update <kn-id> [options]

Update a knowledge network.

Options:
  --name <s>         Name (required unless --body-file)
  --comment <s>      Comment
  --tags <t1,t2>     Comma-separated tags
  --icon <s>         Icon
  --color <s>        Color
  --branch <s>       Branch (default: main)
  --base-branch <s>  Base branch (default: empty for main)
  --body-file <path> Read full JSON body from file (cannot combine with flags above)
  -bd, --biz-domain <value>  Business domain (default: bd_public)
  --pretty           Pretty-print JSON output`;

const KN_DELETE_HELP = `kweaver bkn delete <kn-id>

Delete a knowledge network and its object types, relation types, action types, and concept groups.

Options:
  --yes, -y          Skip confirmation prompt
  -bd, --biz-domain <value>  Business domain (default: bd_public)`;

async function runKnGetCommand(args: string[]): Promise<number> {
  let options: KnGetOptions;
  try {
    options = parseKnGetArgs(args);
  } catch (error) {
    if (error instanceof Error && error.message === "help") {
      console.log(KN_GET_HELP);
      return 0;
    }
    console.error(formatHttpError(error));
    return 1;
  }

  try {
    const token = await ensureValidToken();
    const body = await getKnowledgeNetwork({
      baseUrl: token.baseUrl,
      accessToken: token.accessToken,
      knId: options.knId,
      businessDomain: options.businessDomain,
      mode: options.export ? "export" : undefined,
      include_statistics: options.stats ? true : undefined,
    });

    if (body) {
      console.log(formatCallOutput(body, options.pretty));
    }
    return 0;
  } catch (error) {
    console.error(formatHttpError(error));
    return 1;
  }
}

async function runKnCreateCommand(args: string[]): Promise<number> {
  let options: KnCreateOptions;
  try {
    options = parseKnCreateArgs(args);
  } catch (error) {
    if (error instanceof Error && error.message === "help") {
      console.log(KN_CREATE_HELP);
      return 0;
    }
    console.error(formatHttpError(error));
    return 1;
  }

  try {
    const token = await ensureValidToken();
    const body = await createKnowledgeNetwork({
      baseUrl: token.baseUrl,
      accessToken: token.accessToken,
      body: options.body,
      businessDomain: options.businessDomain,
      import_mode: options.import_mode,
      validate_dependency: options.validate_dependency,
    });

    if (body) {
      console.log(formatCallOutput(body, options.pretty));
    }
    return 0;
  } catch (error) {
    console.error(formatHttpError(error));
    return 1;
  }
}

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

function parseKnCreateFromDsArgs(args: string[]): {
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
function generateObjectTypeBkn(
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

async function runKnCreateFromDsCommand(
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

async function runKnUpdateCommand(args: string[]): Promise<number> {
  let options: KnUpdateOptions;
  try {
    options = parseKnUpdateArgs(args);
  } catch (error) {
    if (error instanceof Error && error.message === "help") {
      console.log(KN_UPDATE_HELP);
      return 0;
    }
    console.error(formatHttpError(error));
    return 1;
  }

  try {
    const token = await ensureValidToken();
    const body = await updateKnowledgeNetwork({
      baseUrl: token.baseUrl,
      accessToken: token.accessToken,
      knId: options.knId,
      body: options.body,
      businessDomain: options.businessDomain,
    });

    if (body) {
      console.log(formatCallOutput(body, options.pretty));
    }
    return 0;
  } catch (error) {
    console.error(formatHttpError(error));
    return 1;
  }
}

function confirmDelete(knId: string): Promise<boolean> {
  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    rl.question(`Delete knowledge network ${knId}? [y/N] `, (answer) => {
      rl.close();
      const trimmed = answer.trim().toLowerCase();
      resolve(trimmed === "y" || trimmed === "yes");
    });
  });
}

async function runKnDeleteCommand(args: string[]): Promise<number> {
  let options: KnDeleteOptions;
  try {
    options = parseKnDeleteArgs(args);
  } catch (error) {
    if (error instanceof Error && error.message === "help") {
      console.log(KN_DELETE_HELP);
      return 0;
    }
    console.error(formatHttpError(error));
    return 1;
  }

  if (!options.yes) {
    const confirmed = await confirmDelete(options.knId);
    if (!confirmed) {
      console.error("Aborted.");
      return 1;
    }
  }

  try {
    const token = await ensureValidToken();
    await deleteKnowledgeNetwork({
      baseUrl: token.baseUrl,
      accessToken: token.accessToken,
      knId: options.knId,
      businessDomain: options.businessDomain,
    });
    return 0;
  } catch (error) {
    console.error(formatHttpError(error));
    return 1;
  }
}

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

async function runKnBuildCommand(args: string[]): Promise<number> {
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

// ── push / pull (BKN tar import/export) ──────────────────────────────────────

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

async function runKnValidateCommand(args: string[]): Promise<number> {
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

async function runKnPushCommand(args: string[]): Promise<number> {
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

async function runKnPullCommand(args: string[]): Promise<number> {
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

// ── search ──────────────────────────────────────────────────────────────────

const KN_SEARCH_HELP = `kweaver bkn search <kn-id> <query> [--max-concepts <n>] [--mode <mode>] [--pretty] [-bd value]

Semantic search within a knowledge network via agent-retrieval API.
Returns matched concepts (object types, relation types, action types).

Options:
  --max-concepts <n>   Max concepts to return (default: 10)
  --mode <mode>        Search mode (default: keyword_vector_retrieval)
  --pretty             Pretty-print JSON output
  -bd, --biz-domain    Override x-business-domain`;

export function parseKnSearchArgs(args: string[]): {
  knId: string;
  query: string;
  maxConcepts: number;
  mode: string;
  pretty: boolean;
  businessDomain: string;
} {
  let knId = "";
  let query = "";
  let maxConcepts = 10;
  let mode = "keyword_vector_retrieval";
  let pretty = false;
  let businessDomain = process.env.KWEAVER_BUSINESS_DOMAIN ?? "";

  const positional: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    if (arg === "--max-concepts") {
      maxConcepts = Number(args[++i]);
    } else if (arg === "--mode") {
      mode = args[++i]!;
    } else if (arg === "--pretty") {
      pretty = true;
    } else if (arg === "-bd" || arg === "--biz-domain") {
      businessDomain = args[++i]!;
    } else if (arg === "--help" || arg === "-h") {
      throw Object.assign(new Error("help"), { isHelp: true });
    } else if (arg.startsWith("-")) {
      throw new Error(`Unknown flag: ${arg}`);
    } else {
      positional.push(arg);
    }
  }

  knId = positional[0] ?? "";
  query = positional.slice(1).join(" ");

  if (!knId || !query) {
    throw new Error("Usage: kweaver bkn search <kn-id> <query> [options]");
  }

  if (!businessDomain) businessDomain = resolveBusinessDomain();
  return { knId, query, maxConcepts, mode, pretty, businessDomain };
}

async function runKnSearchCommand(args: string[]): Promise<number> {
  let options: ReturnType<typeof parseKnSearchArgs>;
  try {
    options = parseKnSearchArgs(args);
  } catch (error) {
    if (error instanceof Error && (error as { isHelp?: boolean }).isHelp) {
      console.log(KN_SEARCH_HELP);
      return 0;
    }
    console.error(error instanceof Error ? error.message : String(error));
    return 1;
  }

  try {
    const token = await ensureValidToken();
    const result = await semanticSearch({
      baseUrl: token.baseUrl,
      accessToken: token.accessToken,
      knId: options.knId,
      query: options.query,
      businessDomain: options.businessDomain,
      maxConcepts: options.maxConcepts,
      mode: options.mode,
    });
    console.log(formatCallOutput(result, options.pretty));
    return 0;
  } catch (error) {
    console.error(formatHttpError(error));
    return 1;
  }
}

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

function parseKnCreateFromCsvArgs(args: string[]): {
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

async function runKnCreateFromCsvCommand(args: string[]): Promise<number> {
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
