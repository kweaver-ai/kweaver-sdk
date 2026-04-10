import { createInterface } from "node:readline";
import { readFileSync } from "node:fs";
import { ensureValidToken, formatHttpError, with401RefreshRetry } from "../auth/oauth.js";
import {
  listKnowledgeNetworks,
  getKnowledgeNetwork,
  createKnowledgeNetwork,
  updateKnowledgeNetwork,
  deleteKnowledgeNetwork,
} from "../api/knowledge-networks.js";
import { formatCallOutput } from "./call.js";
import { resolveBusinessDomain } from "../config/store.js";
import {
  runKnObjectTypeCommand,
  runKnRelationTypeCommand,
  runKnActionTypeCommand,
  runKnConceptGroupCommand,
} from "./bkn-schema.js";
import {
  runKnSubgraphCommand,
  runKnActionExecutionCommand,
  runKnActionLogCommand,
  runKnSearchCommand,
  runKnRelationTypePathsCommand,
  runKnResourcesCommand,
} from "./bkn-query.js";
import {
  runKnBuildCommand,
  runKnValidateCommand,
  runKnPushCommand,
  runKnPullCommand,
  runKnCreateFromDsCommand,
  runKnCreateFromCsvCommand,
  runKnActionScheduleCommand,
  runKnJobCommand,
} from "./bkn-ops.js";
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
  finalizeObjectTypeCreateFromDataview,
  ensureMappedFieldOnDataProperty,
  normalizeAdpFieldType,
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
  parseConceptGroupArgs,
} from "./bkn-schema.js";
export type {
  KnObjectTypeQueryOptions,
  KnActionTypeExecuteOptions,
  ObjectTypeMergeFields,
  ObjectTypeUpdateParsed,
  ObjectTypeCreateParsed,
} from "./bkn-schema.js";

// Re-export query parse functions for backward compatibility (tests import from bkn.js)
export { parseKnSearchArgs } from "./bkn-query.js";

// Re-export ops types and parse functions for backward compatibility (tests import from bkn.js)
export {
  parseKnBuildArgs,
  parseKnPushArgs,
  parseKnPullArgs,
  packDirectoryToTar,
  extractTarToDirectory,
  parseActionScheduleArgs,
  parseJobArgs,
} from "./bkn-ops.js";
export type { KnPushOptions, KnPullOptions } from "./bkn-ops.js";

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
  relation-type update <kn-id> <rt-id> --source <ot-id> --target <ot-id> [--name X] [--type direct|data_view] [--mapping src:tgt ...]   Update relation type
  relation-type delete <kn-id> <rt-ids> [-y]   Delete relation type(s)
  subgraph <kn-id> '<json>'   Query subgraph
  action-type list <kn-id>   List action types (schema)
  action-type get <kn-id> <at-id>   Get action type details
  action-type create <kn-id> '<json>'   Create action type
  action-type update <kn-id> <at-id> '<json>'   Update action type
  action-type delete <kn-id> <at-ids> [-y]   Delete action type(s)
  action-type query <kn-id> <at-id> '<json>'   Query action info
  action-type execute <kn-id> <at-id> '<json>'   Execute action (has side effects)
  action-execution get <kn-id> <execution-id>   Get execution status
  action-log list <kn-id> [options]   List action execution logs
  action-log get <kn-id> <log-id>   Get single execution log
  action-log cancel <kn-id> <log-id>   Cancel running execution (has side effects)
  concept-group list|get|create|update|delete|add-members|remove-members <kn-id> ...
  action-schedule list|get|create|update|set-status|delete <kn-id> ...
  job list|get|tasks|delete <kn-id> ...
  relation-type-paths <kn-id> '<json>'   Query relation type paths between OTs
  resources                              List available resources

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
    if (subcommand === "concept-group") return runKnConceptGroupCommand(rest);
    if (subcommand === "action-schedule") return runKnActionScheduleCommand(rest);
    if (subcommand === "job") return runKnJobCommand(rest);
    if (subcommand === "relation-type-paths") return runKnRelationTypePathsCommand(rest);
    if (subcommand === "resources") return runKnResourcesCommand(rest);
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








