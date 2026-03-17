import { createInterface } from "node:readline";
import { readFileSync } from "node:fs";
import { ensureValidToken, formatHttpError } from "../auth/oauth.js";
import {
  listKnowledgeNetworks,
  getKnowledgeNetwork,
  createKnowledgeNetwork,
  updateKnowledgeNetwork,
  deleteKnowledgeNetwork,
  listObjectTypes,
  listRelationTypes,
  listActionTypes,
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
import { formatCallOutput } from "./call.js";

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
  let businessDomain = "bd_public";
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
  let businessDomain = "bd_public";
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
  let businessDomain = "bd_public";
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
  let businessDomain = "bd_public";
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

  return { knId, body, businessDomain, pretty };
}

export interface KnDeleteOptions {
  knId: string;
  businessDomain: string;
  yes: boolean;
}

export function parseKnDeleteArgs(args: string[]): KnDeleteOptions {
  let knId = "";
  let businessDomain = "bd_public";
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

  return { knId, businessDomain, yes };
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
  let businessDomain = "bd_public";
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
    throw new Error("Missing limit. Provide it in body JSON or via --limit <n>.");
  }

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
  create [options]     Create a knowledge network
  update <kn-id> [options]  Update a knowledge network
  delete <kn-id>       Delete a knowledge network
  export <kn-id>       Export knowledge network (alias for get --export)
  stats <kn-id>        Get statistics (alias for get --stats)
  search <kn-id> <query> [options]   Semantic search within a knowledge network
  object-type list <kn-id>   List object types (schema)
  object-type query <kn-id> <ot-id> ['<json>']   Query object instances (ontology-query; supports --limit/--search-after)
  object-type properties <kn-id> <ot-id> '<json>'   Query object properties
  relation-type list <kn-id>   List relation types (schema)
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

  if (subcommand === "list") {
    return runKnListCommand(rest);
  }

  if (subcommand === "get") {
    return runKnGetCommand(rest);
  }

  if (subcommand === "create") {
    return runKnCreateCommand(rest);
  }

  if (subcommand === "update") {
    return runKnUpdateCommand(rest);
  }

  if (subcommand === "delete") {
    return runKnDeleteCommand(rest);
  }

  if (subcommand === "export") {
    return runKnGetCommand([...(rest[0] ? [rest[0]] : []), "--export", ...rest.slice(1)]);
  }

  if (subcommand === "stats") {
    return runKnGetCommand([...(rest[0] ? [rest[0]] : []), "--stats", ...rest.slice(1)]);
  }

  if (subcommand === "search") {
    return runKnSearchCommand(rest);
  }

  if (subcommand === "object-type") {
    return runKnObjectTypeCommand(rest);
  }

  if (subcommand === "relation-type") {
    return runKnRelationTypeCommand(rest);
  }

  if (subcommand === "subgraph") {
    return runKnSubgraphCommand(rest);
  }

  if (subcommand === "action-type") {
    return runKnActionTypeCommand(rest);
  }

  if (subcommand === "action-execution") {
    return runKnActionExecutionCommand(rest);
  }

  if (subcommand === "action-log") {
    return runKnActionLogCommand(rest);
  }

  console.error(`Unknown bkn subcommand: ${subcommand}`);
  return 1;
}

/** Parse common flags for ontology-query subcommands; returns { filteredArgs, pretty, businessDomain } */
function parseOntologyQueryFlags(args: string[]): {
  filteredArgs: string[];
  pretty: boolean;
  businessDomain: string;
} {
  let pretty = true;
  let businessDomain = "bd_public";
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
  let businessDomain = "bd_public";
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

async function runKnObjectTypeCommand(args: string[]): Promise<number> {
  const [action, ...rest] = args;
  if (!action || action === "--help" || action === "-h") {
    console.log(`kweaver bkn object-type list <kn-id> [--pretty] [-bd value]
kweaver bkn object-type query <kn-id> <ot-id> ['<json>'] [--limit <n>] [--search-after '<json-array>'] [--pretty] [-bd value]
kweaver bkn object-type properties <kn-id> <ot-id> '<json>' [--pretty] [-bd value]

list: List object types (schema) from ontology-manager.
query/properties: Query via ontology-query API. For query, --limit and --search-after are merged into the JSON body.`);
    return 0;
  }

  try {
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
      console.log(formatCallOutput(result, options.pretty));
      return 0;
    }

    if (action === "properties") {
      const parsed = parseOntologyQueryFlags(rest);
      const [knId, otId, body] = parsed.filteredArgs;
      if (!knId || !otId || !body) {
        console.error("Usage: kweaver bkn object-type properties <kn-id> <ot-id> '<json>' [options]");
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

    console.error(`Unknown object-type action: ${action}. Use list, query, or properties.`);
    return 1;
  } catch (error) {
    console.error(formatHttpError(error));
    return 1;
  }
}

async function runKnRelationTypeCommand(args: string[]): Promise<number> {
  const [action, ...rest] = args;
  if (!action || action === "--help" || action === "-h") {
    console.log(`kweaver bkn relation-type list <kn-id> [--pretty] [-bd value]

List relation types (schema) from ontology-manager.`);
    return 0;
  }

  if (action !== "list") {
    console.error(`Unknown relation-type action: ${action}. Use list.`);
    return 1;
  }

  try {
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

Query subgraph via ontology-query API. JSON body format see ref/ontology/ontology-query.yaml.`);
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
    const token = await ensureValidToken();
    const result = await subgraph({
      baseUrl: token.baseUrl,
      accessToken: token.accessToken,
      knId,
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
  let businessDomain = "bd_public";
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
  let businessDomain = process.env.KWEAVER_BUSINESS_DOMAIN ?? "bd_public";

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
