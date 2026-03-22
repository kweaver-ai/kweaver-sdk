import { createInterface } from "node:readline";
import { execSync, spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, readdirSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { loadNetwork, allObjects, allRelations, allActions, generateChecksum, validateNetwork } from "@kweaver-ai/bkn";
import { ensureValidToken, formatHttpError, with401RefreshRetry } from "../auth/oauth.js";
import {
  listKnowledgeNetworks,
  getKnowledgeNetwork,
  createKnowledgeNetwork,
  updateKnowledgeNetwork,
  deleteKnowledgeNetwork,
  listObjectTypes,
  listRelationTypes,
  listActionTypes,
  getObjectType,
  createObjectTypes,
  updateObjectType,
  deleteObjectTypes,
  getRelationType,
  createRelationTypes,
  updateRelationType,
  deleteRelationTypes,
  buildKnowledgeNetwork,
  getBuildStatus,
} from "../api/knowledge-networks.js";
import {
  objectTypeQuery,
  objectTypeProperties,
  subgraph,
  actionTypeQuery,
  actionTypeExecute,
  actionExecutionGet,
  actionLogsList,
  actionLogGet,
  actionLogCancel,
} from "../api/ontology-query.js";
import { semanticSearch } from "../api/semantic-search.js";
import { listTablesWithColumns } from "../api/datasources.js";
import { createDataView } from "../api/dataviews.js";
import { downloadBkn, uploadBkn } from "../api/bkn-backend.js";
import { formatCallOutput } from "./call.js";
import { resolveBusinessDomain } from "../config/store.js";

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
  let limit = 50;
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
      limit = parseInt(args[i + 1] ?? "50", 10);
      if (Number.isNaN(limit) || limit < 1) limit = 50;
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
}

export function parseKnPushArgs(args: string[]): KnPushOptions {
  let directory = "";
  let branch = "main";
  let businessDomain = "";
  let pretty = true;

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
  return { directory, branch, businessDomain, pretty };
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

export interface KnObjectTypeQueryOptions {
  knId: string;
  otId: string;
  body: string;
  pretty: boolean;
  businessDomain: string;
}

function parseJsonObject(text: string, errorMessage: string): Record<string, unknown> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error(errorMessage);
  }

  if (!parsed || Array.isArray(parsed) || typeof parsed !== "object") {
    throw new Error(errorMessage);
  }

  return parsed as Record<string, unknown>;
}

function parseSearchAfterArray(text: string): unknown[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error("Invalid value for --search-after. Expected a JSON array string.");
  }

  if (!Array.isArray(parsed)) {
    throw new Error("Invalid value for --search-after. Expected a JSON array string.");
  }

  return parsed;
}

export function parseKnObjectTypeQueryArgs(args: string[]): KnObjectTypeQueryOptions {
  let pretty = true;
  let businessDomain = "";
  let limit: number | undefined;
  let searchAfter: unknown[] | undefined;
  const positionalArgs: string[] = [];

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];

    if (arg === "--help" || arg === "-h") {
      throw new Error("help");
    }

    if (arg === "--pretty") {
      pretty = true;
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

    if (arg === "--limit") {
      const rawLimit = args[i + 1];
      const parsedLimit = parseInt(rawLimit ?? "", 10);
      if (!rawLimit || rawLimit.startsWith("-") || Number.isNaN(parsedLimit) || parsedLimit < 1) {
        throw new Error("Invalid value for --limit. Expected a positive integer.");
      }
      limit = parsedLimit;
      i += 1;
      continue;
    }

    if (arg === "--search-after") {
      const rawSearchAfter = args[i + 1];
      if (!rawSearchAfter) {
        throw new Error("Missing value for --search-after. Expected a JSON array string.");
      }
      searchAfter = parseSearchAfterArray(rawSearchAfter);
      i += 1;
      continue;
    }

    positionalArgs.push(arg);
  }

  const [knId, otId, bodyText = "{}"] = positionalArgs;
  if (!knId || !otId) {
    throw new Error(
      "Usage: kweaver bkn object-type query <kn-id> <ot-id> ['<json>'] [--limit <n>] [--search-after '<json-array>'] [--pretty] [-bd value]"
    );
  }
  if (positionalArgs.length > 3) {
    throw new Error(
      "Usage: kweaver bkn object-type query <kn-id> <ot-id> ['<json>'] [--limit <n>] [--search-after '<json-array>'] [--pretty] [-bd value]"
    );
  }

  const body = parseJsonObject(bodyText, "object-type query body must be a JSON object.");
  if (limit !== undefined) {
    body.limit = limit;
  }
  if (searchAfter !== undefined) {
    body.search_after = searchAfter;
  }
  if (typeof body.limit !== "number" || !Number.isFinite(body.limit) || body.limit < 1) {
    body.limit = 30;
  }

  if (!businessDomain) businessDomain = resolveBusinessDomain();
  return {
    knId,
    otId,
    body: JSON.stringify(body),
    pretty,
    businessDomain,
  };
}

const KN_HELP = `kweaver bkn

Subcommands:
  list [options]       List business knowledge networks
  get <kn-id> [options]   Get knowledge network detail (use --stats or --export)
  create [options]     Create a knowledge network (empty or from --body-file)
  create-from-ds <ds-id> --name X [--tables a,b] [--build]   Create KN from datasource
  update <kn-id> [options]  Update a knowledge network
  delete <kn-id>       Delete a knowledge network
  build <kn-id> [--wait|--no-wait] [--timeout n]   Trigger full build
  validate <directory>   Validate a local BKN directory (no upload)
  push <directory> [--branch main]   Upload BKN directory as tar
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

/** Parse object-type create args: --name --dataview-id --primary-key --display-key [--property '<json>' ...] */
function parseObjectTypeCreateArgs(args: string[]): {
  knId: string;
  body: string;
  businessDomain: string;
  branch: string;
  pretty: boolean;
} {
  let name = "";
  let dataviewId = "";
  let primaryKey = "";
  let displayKey = "";
  let businessDomain = "";
  let branch = "main";
  let pretty = true;
  const properties: string[] = [];
  const positional: string[] = [];

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === "--help" || arg === "-h") throw new Error("help");
    if (arg === "--name" && args[i + 1]) {
      name = args[++i];
      continue;
    }
    if (arg === "--dataview-id" && args[i + 1]) {
      dataviewId = args[++i];
      continue;
    }
    if (arg === "--primary-key" && args[i + 1]) {
      primaryKey = args[++i];
      continue;
    }
    if (arg === "--display-key" && args[i + 1]) {
      displayKey = args[++i];
      continue;
    }
    if (arg === "--property" && args[i + 1]) {
      properties.push(args[++i]);
      continue;
    }
    if ((arg === "-bd" || arg === "--biz-domain") && args[i + 1]) {
      businessDomain = args[++i];
      continue;
    }
    if (arg === "--branch" && args[i + 1]) {
      branch = args[++i];
      continue;
    }
    if (arg === "--pretty") {
      pretty = true;
      continue;
    }
    if (!arg.startsWith("-")) positional.push(arg);
  }

  const knId = positional[0];
  if (!knId || !name || !dataviewId || !primaryKey || !displayKey) {
    throw new Error(
      "Usage: kweaver bkn object-type create <kn-id> --name X --dataview-id Y --primary-key Z --display-key W"
    );
  }

  const entry: Record<string, unknown> = {
    name,
    data_source: { type: "data_view", id: dataviewId },
    primary_keys: [primaryKey],
    display_key: displayKey,
  };
  if (properties.length > 0) {
    entry.data_properties = properties.map((p) => JSON.parse(p));
  } else {
    const autoProps = new Set([primaryKey, displayKey]);
    entry.data_properties = Array.from(autoProps).map((n) => ({
      name: n,
      display_name: n,
      type: "string",
    }));
  }
  const body = JSON.stringify({ entries: [entry], branch });

  if (!businessDomain) businessDomain = resolveBusinessDomain();
  return { knId, body, businessDomain, branch, pretty };
}

/** Parse object-type update args: --name X [--display-key Y] */
function parseObjectTypeUpdateArgs(args: string[]): {
  knId: string;
  otId: string;
  body: string;
  businessDomain: string;
  pretty: boolean;
} {
  let name: string | undefined;
  let displayKey: string | undefined;
  let businessDomain = "";
  let pretty = true;
  const positional: string[] = [];

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === "--help" || arg === "-h") throw new Error("help");
    if (arg === "--name" && args[i + 1]) {
      name = args[++i];
      continue;
    }
    if (arg === "--display-key" && args[i + 1]) {
      displayKey = args[++i];
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
    if (!arg.startsWith("-")) positional.push(arg);
  }

  const [knId, otId] = positional;
  if (!knId || !otId) {
    throw new Error("Usage: kweaver bkn object-type update <kn-id> <ot-id> [--name X] [--display-key Y]");
  }
  const payload: Record<string, string> = {};
  if (name !== undefined) payload.name = name;
  if (displayKey !== undefined) payload.display_key = displayKey;
  if (Object.keys(payload).length === 0) {
    throw new Error("No update fields. Use --name or --display-key.");
  }
  if (!businessDomain) businessDomain = resolveBusinessDomain();
  return { knId, otId, body: JSON.stringify(payload), businessDomain, pretty };
}

/** Parse object-type delete args: <kn-id> <ot-ids> [-y] */
function parseObjectTypeDeleteArgs(args: string[]): {
  knId: string;
  otIds: string;
  businessDomain: string;
  yes: boolean;
} {
  let businessDomain = "";
  let yes = false;
  const positional: string[] = [];

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === "--help" || arg === "-h") throw new Error("help");
    if (arg === "--yes" || arg === "-y") {
      yes = true;
      continue;
    }
    if ((arg === "-bd" || arg === "--biz-domain") && args[i + 1]) {
      businessDomain = args[++i];
      continue;
    }
    if (!arg.startsWith("-")) positional.push(arg);
  }

  const [knId, otIds] = positional;
  if (!knId || !otIds) {
    throw new Error("Usage: kweaver bkn object-type delete <kn-id> <ot-ids> [-y]");
  }
  if (!businessDomain) businessDomain = resolveBusinessDomain();
  return { knId, otIds, businessDomain, yes };
}

/** Parse common flags for ontology-query subcommands; returns { filteredArgs, pretty, businessDomain } */
function parseOntologyQueryFlags(args: string[]): {
  filteredArgs: string[];
  pretty: boolean;
  businessDomain: string;
} {
  let pretty = true;
  let businessDomain = "";
  const filteredArgs: string[] = [];

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === "--help" || arg === "-h") {
      throw new Error("help");
    }
    if (arg === "--pretty") {
      pretty = true;
      continue;
    }
    if ((arg === "-bd" || arg === "--biz-domain") && args[i + 1]) {
      businessDomain = args[i + 1];
      i += 1;
      continue;
    }
    filteredArgs.push(arg);
  }
  if (!businessDomain) businessDomain = resolveBusinessDomain();
  return { filteredArgs, pretty, businessDomain };
}

export interface KnActionTypeExecuteOptions {
  knId: string;
  atId: string;
  body: string;
  pretty: boolean;
  businessDomain: string;
  wait: boolean;
  timeout: number;
}

export function parseKnActionTypeExecuteArgs(args: string[]): KnActionTypeExecuteOptions {
  let pretty = true;
  let businessDomain = "";
  let wait = true;
  let timeout = 300;
  const positional: string[] = [];

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === "--help" || arg === "-h") {
      throw new Error("help");
    }
    if (arg === "--pretty") {
      pretty = true;
      continue;
    }
    if ((arg === "-bd" || arg === "--biz-domain") && args[i + 1]) {
      businessDomain = args[i + 1];
      i += 1;
      continue;
    }
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
    positional.push(arg);
  }

  const [knId, atId, body] = positional;
  if (!knId || !atId || !body) {
    throw new Error("Missing kn-id, at-id, or body. Usage: kweaver bkn action-type execute <kn-id> <at-id> '<json>' [options]");
  }

  if (!businessDomain) businessDomain = resolveBusinessDomain();
  return {
    knId,
    atId,
    body,
    pretty,
    businessDomain,
    wait,
    timeout,
  };
}

const PK_CANDIDATES = new Set(["id", "pk", "key"]);
const PK_TYPES = new Set(["integer", "unsigned integer", "string", "varchar", "bigint", "int"]);
const DISPLAY_HINTS = ["name", "title", "label", "display_name", "description"];

function detectPrimaryKey(table: { name: string; columns: Array<{ name: string; type: string }> }): string {
  for (const col of table.columns) {
    if (PK_CANDIDATES.has(col.name.toLowerCase()) && PK_TYPES.has(col.type.toLowerCase())) {
      return col.name;
    }
  }
  for (const col of table.columns) {
    if (PK_TYPES.has(col.type.toLowerCase())) {
      return col.name;
    }
  }
  return table.columns[0]?.name ?? "id";
}

function detectDisplayKey(
  table: { name: string; columns: Array<{ name: string; type: string }> },
  primaryKey: string
): string {
  for (const col of table.columns) {
    if (DISPLAY_HINTS.some((h) => col.name.toLowerCase().includes(h))) {
      return col.name;
    }
  }
  return primaryKey;
}

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

async function runKnObjectTypeCommand(args: string[]): Promise<number> {
  const [action, ...rest] = args;
  if (!action || action === "--help" || action === "-h") {
    console.log(`kweaver bkn object-type list <kn-id> [--pretty] [-bd value]
kweaver bkn object-type get <kn-id> <ot-id> [--pretty] [-bd value]
kweaver bkn object-type create <kn-id> --name X --dataview-id Y --primary-key Z --display-key W [--property '<json>' ...]
kweaver bkn object-type update <kn-id> <ot-id> [--name X] [--display-key Y]
kweaver bkn object-type delete <kn-id> <ot-ids> [-y]
kweaver bkn object-type query <kn-id> <ot-id> ['<json>'] [--limit <n>] [--search-after '<json-array>'] [--pretty] [-bd value]
kweaver bkn object-type properties <kn-id> <ot-id> '<json>' [--pretty] [-bd value]

list: List object types (schema) from ontology-manager.
get: Get single object type details.
create/update/delete: Schema CRUD (create requires dataview-id).
query: Query via ontology-query API. Default limit is 30 if not specified. Use --search-after for pagination.
properties: Query instance properties by primary key.

properties JSON format: {"_instance_identities":[{"<primary-key>":"<value>"}],"properties":["prop1","prop2"]}`);
    return 0;
  }

  try {
    if (action === "get") {
      const parsed = parseOntologyQueryFlags(rest);
      const [knId, otId] = parsed.filteredArgs;
      if (!knId || !otId) {
        console.error("Usage: kweaver bkn object-type get <kn-id> <ot-id> [options]");
        return 1;
      }
      const token = await ensureValidToken();
      const body = await getObjectType({
        baseUrl: token.baseUrl,
        accessToken: token.accessToken,
        knId,
        otId,
        businessDomain: parsed.businessDomain,
      });
      console.log(formatCallOutput(body, parsed.pretty));
      return 0;
    }

    if (action === "create") {
      const opts = parseObjectTypeCreateArgs(rest);
      const token = await ensureValidToken();
      const body = await createObjectTypes({
        baseUrl: token.baseUrl,
        accessToken: token.accessToken,
        knId: opts.knId,
        body: opts.body,
        businessDomain: opts.businessDomain,
        branch: opts.branch,
      });
      console.log(formatCallOutput(body, opts.pretty));
      return 0;
    }

    if (action === "update") {
      const opts = parseObjectTypeUpdateArgs(rest);
      const token = await ensureValidToken();
      const body = await updateObjectType({
        baseUrl: token.baseUrl,
        accessToken: token.accessToken,
        knId: opts.knId,
        otId: opts.otId,
        body: opts.body,
        businessDomain: opts.businessDomain,
      });
      console.log(formatCallOutput(body, opts.pretty));
      return 0;
    }

    if (action === "delete") {
      const opts = parseObjectTypeDeleteArgs(rest);
      if (!opts.yes) {
        const confirmed = await confirmYes(`Delete object type(s) ${opts.otIds}?`);
        if (!confirmed) {
          console.error("Aborted.");
          return 1;
        }
      }
      const token = await ensureValidToken();
      await deleteObjectTypes({
        baseUrl: token.baseUrl,
        accessToken: token.accessToken,
        knId: opts.knId,
        otIds: opts.otIds,
        businessDomain: opts.businessDomain,
      });
      console.log(`Deleted ${opts.otIds}`);
      return 0;
    }

    if (action === "list") {
      const parsed = parseOntologyQueryFlags(rest);
      const [knId] = parsed.filteredArgs;
      if (!knId) {
        console.error("Usage: kweaver bkn object-type list <kn-id> [options]");
        return 1;
      }
      const token = await ensureValidToken();
      const body = await listObjectTypes({
        baseUrl: token.baseUrl,
        accessToken: token.accessToken,
        knId,
        businessDomain: parsed.businessDomain,
      });
      console.log(formatCallOutput(body, parsed.pretty));
      return 0;
    }

    if (action === "query") {
      const options = parseKnObjectTypeQueryArgs(rest);
      const token = await ensureValidToken();
      const result = await objectTypeQuery({
        baseUrl: token.baseUrl,
        accessToken: token.accessToken,
        knId: options.knId,
        otId: options.otId,
        body: options.body,
        businessDomain: options.businessDomain,
      });
      const OUTPUT_WARN_BYTES = 100_000;
      if (result.length > OUTPUT_WARN_BYTES) {
        console.error(
          `[warn] Response is ${(result.length / 1024).toFixed(0)}KB. Use a smaller --limit or --search-after to paginate.`
        );
      }
      console.log(formatCallOutput(result, options.pretty));
      return 0;
    }

    if (action === "properties") {
      const parsed = parseOntologyQueryFlags(rest);
      const [knId, otId, body] = parsed.filteredArgs;
      if (!knId || !otId || !body) {
        console.error(`Usage: kweaver bkn object-type properties <kn-id> <ot-id> '<json>' [options]
JSON: {"_instance_identities":[{"<primary-key>":"<value>"}],"properties":["prop1","prop2"]}`);
        return 1;
      }

      const token = await ensureValidToken();
      const result = await objectTypeProperties({
        baseUrl: token.baseUrl,
        accessToken: token.accessToken,
        knId,
        otId,
        body,
        businessDomain: parsed.businessDomain,
      });
      console.log(formatCallOutput(result, parsed.pretty));
      return 0;
    }

    console.error(`Unknown object-type action: ${action}. Use list, get, create, update, delete, query, or properties.`);
    return 1;
  } catch (error) {
    if (error instanceof Error && error.message === "help") {
      console.log(`kweaver bkn object-type create <kn-id> --name X --dataview-id Y --primary-key Z --display-key W [--property '<json>' ...]
kweaver bkn object-type update <kn-id> <ot-id> [--name X] [--display-key Y]
kweaver bkn object-type delete <kn-id> <ot-ids> [-y]`);
      return 0;
    }
    console.error(formatHttpError(error));
    return 1;
  }
}

/** Parse relation-type create args: --name --source --target [--mapping src:tgt ...] */
function parseRelationTypeCreateArgs(args: string[]): {
  knId: string;
  body: string;
  businessDomain: string;
  branch: string;
  pretty: boolean;
} {
  let name = "";
  let source = "";
  let target = "";
  let businessDomain = "";
  let branch = "main";
  let pretty = true;
  const mappings: Array<[string, string]> = [];
  const positional: string[] = [];

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === "--help" || arg === "-h") throw new Error("help");
    if (arg === "--name" && args[i + 1]) {
      name = args[++i];
      continue;
    }
    if (arg === "--source" && args[i + 1]) {
      source = args[++i];
      continue;
    }
    if (arg === "--target" && args[i + 1]) {
      target = args[++i];
      continue;
    }
    if (arg === "--mapping" && args[i + 1]) {
      const m = args[++i];
      if (!m.includes(":")) {
        throw new Error(`Invalid mapping format '${m}'. Expected source_prop:target_prop.`);
      }
      const [s, t] = m.split(":", 2);
      mappings.push([s, t]);
      continue;
    }
    if ((arg === "-bd" || arg === "--biz-domain") && args[i + 1]) {
      businessDomain = args[++i];
      continue;
    }
    if (arg === "--branch" && args[i + 1]) {
      branch = args[++i];
      continue;
    }
    if (arg === "--pretty") {
      pretty = true;
      continue;
    }
    if (!arg.startsWith("-")) positional.push(arg);
  }

  const knId = positional[0];
  if (!knId || !name || !source || !target) {
    throw new Error(
      "Usage: kweaver bkn relation-type create <kn-id> --name X --source <ot-id> --target <ot-id> [--mapping src:tgt ...]"
    );
  }

  const entry: Record<string, unknown> = {
    name,
    source_object_type_id: source,
    target_object_type_id: target,
    type: "direct",
    mapping_rules: mappings.map(([s, t]) => ({
      source_property: { name: s },
      target_property: { name: t },
    })),
  };
  const body = JSON.stringify({ entries: [entry], branch });

  if (!businessDomain) businessDomain = resolveBusinessDomain();
  return { knId, body, businessDomain, branch, pretty };
}

/** Parse relation-type update args: [--name X] */
function parseRelationTypeUpdateArgs(args: string[]): {
  knId: string;
  rtId: string;
  body: string;
  businessDomain: string;
  pretty: boolean;
} {
  let name: string | undefined;
  let businessDomain = "";
  let pretty = true;
  const positional: string[] = [];

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === "--help" || arg === "-h") throw new Error("help");
    if (arg === "--name" && args[i + 1]) {
      name = args[++i];
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
    if (!arg.startsWith("-")) positional.push(arg);
  }

  const [knId, rtId] = positional;
  if (!knId || !rtId) {
    throw new Error("Usage: kweaver bkn relation-type update <kn-id> <rt-id> [--name X]");
  }
  if (name === undefined) {
    throw new Error("No update fields. Use --name.");
  }
  if (!businessDomain) businessDomain = resolveBusinessDomain();
  return { knId, rtId, body: JSON.stringify({ name }), businessDomain, pretty };
}

/** Parse relation-type delete args: <kn-id> <rt-ids> [-y] */
function parseRelationTypeDeleteArgs(args: string[]): {
  knId: string;
  rtIds: string;
  businessDomain: string;
  yes: boolean;
} {
  let businessDomain = "";
  let yes = false;
  const positional: string[] = [];

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === "--help" || arg === "-h") throw new Error("help");
    if (arg === "--yes" || arg === "-y") {
      yes = true;
      continue;
    }
    if ((arg === "-bd" || arg === "--biz-domain") && args[i + 1]) {
      businessDomain = args[++i];
      continue;
    }
    if (!arg.startsWith("-")) positional.push(arg);
  }

  const [knId, rtIds] = positional;
  if (!knId || !rtIds) {
    throw new Error("Usage: kweaver bkn relation-type delete <kn-id> <rt-ids> [-y]");
  }
  if (!businessDomain) businessDomain = resolveBusinessDomain();
  return { knId, rtIds, businessDomain, yes };
}

async function runKnRelationTypeCommand(args: string[]): Promise<number> {
  const [action, ...rest] = args;
  if (!action || action === "--help" || action === "-h") {
    console.log(`kweaver bkn relation-type list <kn-id> [--pretty] [-bd value]
kweaver bkn relation-type get <kn-id> <rt-id> [--pretty] [-bd value]
kweaver bkn relation-type create <kn-id> --name X --source <ot-id> --target <ot-id> [--mapping src:tgt ...]
kweaver bkn relation-type update <kn-id> <rt-id> [--name X]
kweaver bkn relation-type delete <kn-id> <rt-ids> [-y]

list: List relation types (schema) from ontology-manager.
get: Get single relation type details.
create/update/delete: Schema CRUD.`);
    return 0;
  }

  try {
    if (action === "get") {
      const parsed = parseOntologyQueryFlags(rest);
      const [knId, rtId] = parsed.filteredArgs;
      if (!knId || !rtId) {
        console.error("Usage: kweaver bkn relation-type get <kn-id> <rt-id> [options]");
        return 1;
      }
      const token = await ensureValidToken();
      const body = await getRelationType({
        baseUrl: token.baseUrl,
        accessToken: token.accessToken,
        knId,
        rtId,
        businessDomain: parsed.businessDomain,
      });
      console.log(formatCallOutput(body, parsed.pretty));
      return 0;
    }

    if (action === "create") {
      const opts = parseRelationTypeCreateArgs(rest);
      const token = await ensureValidToken();
      const body = await createRelationTypes({
        baseUrl: token.baseUrl,
        accessToken: token.accessToken,
        knId: opts.knId,
        body: opts.body,
        businessDomain: opts.businessDomain,
        branch: opts.branch,
      });
      console.log(formatCallOutput(body, opts.pretty));
      return 0;
    }

    if (action === "update") {
      const opts = parseRelationTypeUpdateArgs(rest);
      const token = await ensureValidToken();
      const body = await updateRelationType({
        baseUrl: token.baseUrl,
        accessToken: token.accessToken,
        knId: opts.knId,
        rtId: opts.rtId,
        body: opts.body,
        businessDomain: opts.businessDomain,
      });
      console.log(formatCallOutput(body, opts.pretty));
      return 0;
    }

    if (action === "delete") {
      const opts = parseRelationTypeDeleteArgs(rest);
      if (!opts.yes) {
        const confirmed = await confirmYes(`Delete relation type(s) ${opts.rtIds}?`);
        if (!confirmed) {
          console.error("Aborted.");
          return 1;
        }
      }
      const token = await ensureValidToken();
      await deleteRelationTypes({
        baseUrl: token.baseUrl,
        accessToken: token.accessToken,
        knId: opts.knId,
        rtIds: opts.rtIds,
        businessDomain: opts.businessDomain,
      });
      console.log(`Deleted ${opts.rtIds}`);
      return 0;
    }

    if (action === "list") {
      const parsed = parseOntologyQueryFlags(rest);
      const [knId] = parsed.filteredArgs;
      if (!knId) {
        console.error("Usage: kweaver bkn relation-type list <kn-id> [options]");
        return 1;
      }
      const token = await ensureValidToken();
      const body = await listRelationTypes({
        baseUrl: token.baseUrl,
        accessToken: token.accessToken,
        knId,
        businessDomain: parsed.businessDomain,
      });
      console.log(formatCallOutput(body, parsed.pretty));
      return 0;
    }

    console.error(`Unknown relation-type action: ${action}. Use list, get, create, update, or delete.`);
    return 1;
  } catch (error) {
    if (error instanceof Error && error.message === "help") {
      console.log(`kweaver bkn relation-type create <kn-id> --name X --source <ot-id> --target <ot-id> [--mapping src:tgt ...]
kweaver bkn relation-type update <kn-id> <rt-id> [--name X]
kweaver bkn relation-type delete <kn-id> <rt-ids> [-y]`);
      return 0;
    }
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

const TERMINAL_STATUSES = ["SUCCESS", "FAILED", "CANCELLED"];

function extractExecutionId(body: string): string | null {
  try {
    const data = JSON.parse(body) as Record<string, unknown>;
    const id = data.execution_id ?? data.id;
    return typeof id === "string" ? id : null;
  } catch {
    return null;
  }
}

function extractStatus(body: string): string {
  try {
    const data = JSON.parse(body) as Record<string, unknown>;
    const status = data.status;
    return typeof status === "string" ? status : "";
  } catch {
    return "";
  }
}

async function runKnActionTypeCommand(args: string[]): Promise<number> {
  const [action, ...rest] = args;
  if (!action || action === "--help" || action === "-h") {
    console.log(`kweaver bkn action-type list <kn-id> [--pretty] [-bd value]
kweaver bkn action-type query <kn-id> <at-id> '<json>' [--pretty] [-bd value]
kweaver bkn action-type execute <kn-id> <at-id> '<json>' [--pretty] [-bd value] [--wait|--no-wait] [--timeout n]

list: List action types (schema) from ontology-manager.
query/execute: Query or execute actions. execute has side effects - only use when explicitly requested.
  --wait (default)    Poll until execution completes
  --no-wait           Return immediately after starting execution
  --timeout <seconds> Max wait time when --wait (default: 300)`);
    return 0;
  }

  if (action === "list") {
    try {
      const parsed = parseOntologyQueryFlags(rest);
      const [knId] = parsed.filteredArgs;
      if (!knId) {
        console.error("Usage: kweaver bkn action-type list <kn-id> [options]");
        return 1;
      }
      const token = await ensureValidToken();
      const body = await listActionTypes({
        baseUrl: token.baseUrl,
        accessToken: token.accessToken,
        knId,
        businessDomain: parsed.businessDomain,
      });
      console.log(formatCallOutput(body, parsed.pretty));
      return 0;
    } catch (error) {
      console.error(formatHttpError(error));
      return 1;
    }
  }

  if (action === "query") {
    let filteredArgs: string[];
    let pretty: boolean;
    let businessDomain: string;
    try {
      const parsed = parseOntologyQueryFlags(rest);
      filteredArgs = parsed.filteredArgs;
      pretty = parsed.pretty;
      businessDomain = parsed.businessDomain;
    } catch (error) {
      if (error instanceof Error && error.message === "help") return 0;
      throw error;
    }
    const [knId, atId, body] = filteredArgs;
    if (!knId || !atId || !body) {
      console.error("Usage: kweaver bkn action-type query <kn-id> <at-id> '<json>' [options]");
      return 1;
    }
    try {
      const token = await ensureValidToken();
      const result = await actionTypeQuery({
        baseUrl: token.baseUrl,
        accessToken: token.accessToken,
        knId,
        atId,
        body,
        businessDomain,
      });
      console.log(formatCallOutput(result, pretty));
      return 0;
    } catch (error) {
      console.error(formatHttpError(error));
      return 1;
    }
  }

  if (action === "execute") {
    let options: KnActionTypeExecuteOptions;
    try {
      options = parseKnActionTypeExecuteArgs(rest);
    } catch (error) {
      if (error instanceof Error && error.message === "help") return 0;
      console.error(formatHttpError(error));
      return 1;
    }
    try {
      const token = await ensureValidToken();
      const base = {
        baseUrl: token.baseUrl,
        accessToken: token.accessToken,
        knId: options.knId,
        atId: options.atId,
        body: options.body,
        businessDomain: options.businessDomain,
      };
      const result = await actionTypeExecute(base);
      if (!options.wait) {
        console.log(formatCallOutput(result, options.pretty));
        return 0;
      }
      const executionId = extractExecutionId(result);
      if (!executionId) {
        console.log(formatCallOutput(result, options.pretty));
        return 0;
      }
      const deadline = Date.now() + options.timeout * 1000;
      let lastBody = result;
      while (Date.now() < deadline) {
        const status = extractStatus(lastBody);
        if (TERMINAL_STATUSES.includes(status.toUpperCase())) {
          console.log(formatCallOutput(lastBody, options.pretty));
          return status.toUpperCase() === "SUCCESS" ? 0 : 1;
        }
        await new Promise((r) => setTimeout(r, 2000));
        lastBody = await actionExecutionGet({
          baseUrl: token.baseUrl,
          accessToken: token.accessToken,
          knId: options.knId,
          executionId,
          businessDomain: options.businessDomain,
        });
      }
      console.error(`Action execution did not complete within ${options.timeout}s`);
      console.log(formatCallOutput(lastBody, options.pretty));
      return 1;
    } catch (error) {
      console.error(formatHttpError(error));
      return 1;
    }
  }

  console.error(`Unknown action-type action: ${action}. Use list, query, or execute.`);
  return 1;
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
  let limit: number | undefined;
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
  --limit <n>        Limit (default: 50)
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

async function runKnCreateFromDsCommand(args: string[]): Promise<number> {
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

    const viewMap: Record<string, string> = {};
    for (const t of targetTables) {
      const dvId = await createDataView({
        ...base,
        name: t.name,
        datasourceId: options.dsId,
        table: t.name,
        fields: t.columns.map((c) => ({ name: c.name, type: c.type })),
      });
      viewMap[t.name] = dvId;
    }

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

    const otResults: Array<{ name: string; id: string; field_count: number }> = [];
    for (const t of targetTables) {
      const pk = detectPrimaryKey(t);
      const dk = detectDisplayKey(t, pk);
      const entry = {
        name: t.name,
        data_source: { type: "data_view", id: viewMap[t.name] },
        primary_keys: [pk],
        display_key: dk,
        data_properties: [pk, dk].filter((x, i, a) => a.indexOf(x) === i).map((n) => ({
          name: n,
          display_name: n,
          type: "string",
        })),
      };
      const otBody = JSON.stringify({ entries: [entry], branch: "main" });
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
    }

    let statusStr = "skipped";
    if (options.build) {
      console.error("Building ...");
      await buildKnowledgeNetwork({ ...base, knId });
      const deadline = Date.now() + options.timeout * 1000;
      const TERMINAL = ["completed", "failed", "success"];
      while (Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 2000));
        const statusBody = await getBuildStatus({ ...base, knId });
        const statusParsed = JSON.parse(statusBody) as
          | Array<{ state?: string }>
          | { entries?: Array<{ state?: string }> };
        const jobs = Array.isArray(statusParsed) ? statusParsed : (statusParsed.entries ?? []);
        const state = (jobs[0]?.state ?? "running").toLowerCase();
        if (TERMINAL.includes(state)) {
          statusStr = state;
          break;
        }
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
    const deadline = Date.now() + options.timeout * 1000;

    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 2000));
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
      const state = (job?.state ?? "running").toLowerCase();
      const detail = job?.state_detail;

      if (TERMINAL_STATES.includes(state)) {
        console.log(state);
        if (detail) {
          console.log(`Detail: ${detail}`);
        }
        return state === "failed" ? 1 : 0;
      }
    }

    console.error(`Build did not complete within ${options.timeout}s`);
    return 1;
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
  if (result.error) throw result.error;
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
  --pretty           Pretty-print JSON output`;

const KN_PULL_HELP = `kweaver bkn pull <kn-id> [<directory>] [options]

Download a BKN tar from a knowledge network and extract to a local directory.

Options:
  <directory>        Output directory (default: <kn-id>)
  --branch <s>       Branch name (default: main)
  -bd, --biz-domain  Business domain (default: bd_public)`;

async function runKnValidateCommand(args: string[]): Promise<number> {
  if (args.includes("--help") || args.includes("-h")) {
    console.log("Usage: kweaver bkn validate <directory>\n\nValidate a local BKN directory without uploading.");
    return 0;
  }
  const directory = args.find((a) => !a.startsWith("-"));
  if (!directory) {
    console.error("Missing directory. Usage: kweaver bkn validate <directory>");
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

  try {
    const network = await loadNetwork(absDir);
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

  try {
    const network = await loadNetwork(absDir);
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
    await generateChecksum(absDir);
    console.error("Checksum generated");
  } catch (error) {
    console.error(`Checksum generation failed: ${error instanceof Error ? error.message : String(error)}`);
    return 1;
  }

  try {
    const tarBuffer = packDirectoryToTar(absDir);
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
