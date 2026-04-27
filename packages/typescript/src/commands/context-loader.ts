import { ensureValidToken, formatHttpError, resolveActivePlatform, with401RefreshRetry } from "../auth/oauth.js";
import type { ConditionSpec, RelationTypePath, SearchSchemaScope } from "../api/context-loader.js";
import {
  callTool,
  searchSchema,
  queryObjectInstance,
  queryInstanceSubgraph,
  getLogicPropertiesValues,
  getActionInfo,
  findSkills,
  listTools,
  listResources,
  readResource,
  listResourceTemplates,
  listPrompts,
  getPrompt,
} from "../api/context-loader.js";
import { knSearchHttp, semanticSearch } from "../api/semantic-search.js";
import {
  addContextLoaderEntry,
  getCurrentContextLoaderKn,
  loadContextLoaderConfig,
  removeContextLoaderEntry,
  resolveBusinessDomain,
  setCurrentContextLoader,
} from "../config/store.js";
import { assertNotStatelessForWrite } from "../config/stateless.js";

const CONTEXT_LOADER_CONFIG_DEPRECATION =
  "[deprecated] `kweaver context-loader config ...` will be removed in a future release. " +
  "Pass <kn-id> as the first positional to runtime subcommands instead, e.g. " +
  "`kweaver context-loader tools <kn-id>` (or use the `--kn-id <id>` flag).";

const MCP_NOT_CONFIGURED =
  "Context-loader MCP is not configured. Run: kweaver context-loader config set --kn-id <kn-id>";

const MCP_PATH = "/api/agent-retrieval/v1/mcp";

function ensureContextLoaderConfig(knIdOverride?: string): {
  baseUrl: string;
  mcpUrl: string;
  knId: string;
  accessToken: string;
  businessDomain: string;
} {
  const active = resolveActivePlatform();
  if (!active) {
    throw new Error(
      "No platform selected. Set KWEAVER_BASE_URL or run: kweaver auth <platform-url>",
    );
  }

  // Override path (positional <kn-id> or --kn-id flag): derive MCP URL from
  // the active platform; do not touch the deprecated saved config.
  if (knIdOverride) {
    return {
      baseUrl: active.url,
      mcpUrl: active.url.replace(/\/+$/, "") + MCP_PATH,
      knId: knIdOverride,
      accessToken: "",
      businessDomain: resolveBusinessDomain(active.url),
    };
  }

  const kn = getCurrentContextLoaderKn();
  if (!kn) {
    throw new Error(MCP_NOT_CONFIGURED);
  }

  return {
    baseUrl: active.url,
    mcpUrl: kn.mcpUrl,
    knId: kn.knId,
    accessToken: "", // filled by caller after ensureValidToken
    businessDomain: resolveBusinessDomain(active.url),
  };
}

// Subcommands that consult `ensureContextLoaderConfig`. The number is the
// minimum non-flag positional count expected by the handler itself (after
// kn-id is extracted). When the leading non-flag positional count exceeds
// this minimum, the first one is treated as <kn-id>.
const RUNTIME_MIN_POSITIONALS: Record<string, number> = {
  tools: 0,
  resources: 0,
  templates: 0,
  prompts: 0,
  prompt: 1,
  resource: 1,
  "search-schema": 1,
  "tool-call": 1,
  "kn-search": 1,
  "kn-schema-search": 1,
  "query-object-instance": 1,
  "query-instance-subgraph": 1,
  "get-logic-properties": 1,
  "get-action-info": 1,
  "find-skills": 1,
};

function extractKnIdOverride(subcommand: string, rest: string[]): string | undefined {
  // 1) Explicit flag wins. `--kn-id <id>` / `-k <id>` is allowed for every
  //    runtime subcommand and is consumed before the handler sees `rest`.
  for (let i = 0; i < rest.length; i += 1) {
    if ((rest[i] === "--kn-id" || rest[i] === "-k") && rest[i + 1]) {
      const id = rest[i + 1];
      rest.splice(i, 2);
      return id;
    }
  }

  // 2) Positional <kn-id> as the first non-flag arg, when leading non-flag
  //    positional count exceeds what the handler itself requires.
  const min = RUNTIME_MIN_POSITIONALS[subcommand];
  if (min === undefined) return undefined;
  let cut = 0;
  while (cut < rest.length && !rest[cut].startsWith("-")) cut += 1;
  if (cut > min) {
    return rest.shift();
  }
  return undefined;
}

function formatOutput(value: unknown, pretty: boolean): string {
  const json = JSON.stringify(value, null, pretty ? 2 : 0);
  return json;
}

export async function runContextLoaderCommand(args: string[]): Promise<number> {
  const [subcommand, ...rest] = args;

  if (!subcommand || subcommand === "--help" || subcommand === "-h") {
    console.log(`kweaver context-loader

KN selection (for runtime subcommands below):
  Pass <kn-id> as the FIRST positional, e.g. \`kweaver context-loader tools <kn-id>\`,
  or use the global \`--kn-id <id>\` / \`-k <id>\` flag. When omitted, falls back to
  the deprecated saved config managed by \`kweaver context-loader config\`.

Subcommands:
  config set --kn-id <id> [--name n]   [deprecated] Add or update kn config
  config use <name>                    [deprecated] Switch current config
  config list                          [deprecated] List all configs and current
  config remove <name>                 [deprecated] Remove a config
  config show                          [deprecated] Show current config (knId + mcpUrl)
  tools <kn-id>                        tools/list - list available tools
  resources <kn-id>                    resources/list - list resources
  resource <kn-id> <uri>               resources/read - read resource by URI
  templates <kn-id>                    resources/templates/list - list resource templates
  prompts <kn-id>                      prompts/list - list prompts
  prompt <kn-id> <name> [--args json]  prompts/get - get prompt by name
  search-schema <kn-id> <query> [opts] MCP search_schema (object/relation/action/metric)
  tool-call <kn-id> <name> --args '<json>'  MCP tools/call for any server tool
  kn-search <kn-id> <query> [--only-schema]  Compatibility: HTTP kn_search
  kn-schema-search <kn-id> <query> [--max N] Compatibility: HTTP semantic-search
  query-object-instance <kn-id> <json>       Layer 2: Query instances
  query-instance-subgraph <kn-id> <json>     Layer 2: Query subgraph
  get-logic-properties <kn-id> <json>        Layer 3: Get logic property values
  get-action-info <kn-id> <json>             Layer 3: Get action info
  find-skills <kn-id> <ot_id> [options]      Layer 3: Recall skills for an object type

Examples:
  kweaver context-loader tools d5iv6c9818p72mpje8pg
  kweaver context-loader search-schema d5iv6c9818p72mpje8pg "利润率" --scope object,metric --max 5
  kweaver context-loader tool-call d5iv6c9818p72mpje8pg search_schema --args '{"query":"利润率"}'
  kweaver context-loader kn-search d5iv6c9818p72mpje8pg "高血压 治疗 药品" --only-schema --pretty`);
    return 0;
  }

  if (subcommand === "config") {
    return runConfigCommand(rest);
  }

  let pretty = true;
  const prettyIdx = rest.indexOf("--pretty");
  if (prettyIdx !== -1) {
    pretty = true;
    rest.splice(prettyIdx, 1);
  }

  // Extract `<kn-id>` (positional or --kn-id/-k flag) before per-subcommand
  // arg parsing. When provided it bypasses the deprecated saved config.
  const knIdOverride = extractKnIdOverride(subcommand, rest);

  const dispatch = async (): Promise<number> => {
    const token = await ensureValidToken();
    const base = ensureContextLoaderConfig(knIdOverride);
    const options = { ...base, accessToken: token.accessToken };

    if (subcommand === "tools") return runListTools(options, rest, pretty);
    if (subcommand === "resources") return runListResources(options, rest, pretty);
    if (subcommand === "resource") return runReadResource(options, rest, pretty);
    if (subcommand === "templates") return runListTemplates(options, rest, pretty);
    if (subcommand === "prompts") return runListPrompts(options, rest, pretty);
    if (subcommand === "prompt") return runGetPrompt(options, rest, pretty);
    if (subcommand === "search-schema") return runSearchSchema(options, rest, pretty);
    if (subcommand === "tool-call") return runToolCall(options, rest, pretty);
    if (subcommand === "kn-search") return runKnSearch(options, rest, pretty);
    if (subcommand === "kn-schema-search") return runKnSchemaSearch(options, rest, pretty);
    if (subcommand === "query-object-instance") return runQueryObjectInstance(options, rest, pretty);
    if (subcommand === "query-instance-subgraph") return runQueryInstanceSubgraph(options, rest, pretty);
    if (subcommand === "get-logic-properties") return runGetLogicProperties(options, rest, pretty);
    if (subcommand === "get-action-info") return runGetActionInfo(options, rest, pretty);
    if (subcommand === "find-skills") return runFindSkills(options, rest, pretty);
    return -1;
  };

  try {
    return await with401RefreshRetry(async () => {
      const code = await dispatch();
      if (code === -1) {
        console.error(`Unknown context-loader subcommand: ${subcommand}`);
        return 1;
      }
      return code;
    });
  } catch (error) {
    console.error(formatHttpError(error));
    return 1;
  }
}

async function runConfigCommand(args: string[]): Promise<number> {
  const [action, ...rest] = args;

  if (!action || action === "--help" || action === "-h") {
    console.log(`kweaver context-loader config  [deprecated]

Subcommands:
  set --kn-id <id> [--name <name>]   Add or update kn config (default name: default)
  use <name>                         Switch current config
  list                               List all configs and current
  remove <name>                      Remove a config
  show                               Show current config (knId + mcpUrl)

Note: this command group is deprecated and will be removed in a future release.
      It is disabled entirely in stateless mode (\`--token\`).`);
    return 0;
  }

  // Stateless mode (`--token`) does not support any context-loader config
  // operations; the saved config lives under `~/.kweaver/` and is foreign
  // to the stateless paradigm.
  try {
    assertNotStatelessForWrite(`context-loader config ${action}`);
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    return 1;
  }
  console.warn(CONTEXT_LOADER_CONFIG_DEPRECATION);

  const active = resolveActivePlatform();
  if (!active) {
    console.error(
      "No platform selected. Set KWEAVER_BASE_URL or run: kweaver auth <platform-url>",
    );
    return 1;
  }
  const platform = active.url;

  if (action === "show") {
    const kn = getCurrentContextLoaderKn();
    if (!kn) {
      console.log("Context-loader MCP is not configured.");
      console.log(MCP_NOT_CONFIGURED);
      return 0;
    }
    console.log(JSON.stringify({ mcpUrl: kn.mcpUrl, knId: kn.knId }, null, 2));
    return 0;
  }

  if (action === "list") {
    const config = loadContextLoaderConfig();
    if (!config || config.configs.length === 0) {
      console.log("Context-loader MCP is not configured.");
      console.log(MCP_NOT_CONFIGURED);
      return 0;
    }
    for (const entry of config.configs) {
      const mark = entry.name === config.current ? " (current)" : "";
      console.log(`  ${entry.name}: ${entry.knId}${mark}`);
    }
    return 0;
  }

  if (action === "set") {
    let knId: string | undefined;
    let name = "default";

    for (let i = 0; i < rest.length; i += 1) {
      const arg = rest[i];
      if ((arg === "--kn-id" || arg === "-k") && rest[i + 1]) {
        knId = rest[i + 1];
        i += 1;
      } else if ((arg === "--name" || arg === "-n") && rest[i + 1]) {
        name = rest[i + 1];
        i += 1;
      }
    }

    if (!knId) {
      console.error("Usage: kweaver context-loader config set --kn-id <id> [--name <name>]");
      return 1;
    }

    addContextLoaderEntry(platform, name, knId);
    console.log(`Context-loader config '${name}' saved.`);
    return 0;
  }

  if (action === "use") {
    const name = rest[0];
    if (!name) {
      console.error("Usage: kweaver context-loader config use <name>");
      return 1;
    }
    try {
      setCurrentContextLoader(platform, name);
      console.log(`Switched to context-loader config '${name}'.`);
      return 0;
    } catch (error) {
      console.error(error instanceof Error ? error.message : String(error));
      return 1;
    }
  }

  if (action === "remove") {
    const name = rest[0];
    if (!name) {
      console.error("Usage: kweaver context-loader config remove <name>");
      return 1;
    }
    removeContextLoaderEntry(platform, name);
    console.log(`Removed context-loader config '${name}'.`);
    return 0;
  }

  console.error(`Unknown config subcommand: ${action}`);
  return 1;
}

async function runListTools(
  options: { mcpUrl: string; knId: string; accessToken: string },
  args: string[],
  pretty: boolean
): Promise<number> {
  let cursor: string | undefined;
  for (let i = 0; i < args.length; i += 1) {
    if ((args[i] === "--cursor" || args[i] === "-c") && args[i + 1]) {
      cursor = args[i + 1];
      i += 1;
    }
  }
  const result = await listTools(options, cursor ? { cursor } : undefined);
  console.log(formatOutput(result, pretty));
  return 0;
}

async function runListResources(
  options: { mcpUrl: string; knId: string; accessToken: string },
  args: string[],
  pretty: boolean
): Promise<number> {
  let cursor: string | undefined;
  for (let i = 0; i < args.length; i += 1) {
    if ((args[i] === "--cursor" || args[i] === "-c") && args[i + 1]) {
      cursor = args[i + 1];
      i += 1;
    }
  }
  const result = await listResources(options, cursor ? { cursor } : undefined);
  console.log(formatOutput(result, pretty));
  return 0;
}

async function runReadResource(
  options: { mcpUrl: string; knId: string; accessToken: string },
  args: string[],
  pretty: boolean
): Promise<number> {
  const uri = args.find((a) => !a.startsWith("-"));
  if (!uri) {
    console.error("Usage: kweaver context-loader resource <uri>");
    return 1;
  }
  const result = await readResource(options, uri);
  console.log(formatOutput(result, pretty));
  return 0;
}

async function runListTemplates(
  options: { mcpUrl: string; knId: string; accessToken: string },
  args: string[],
  pretty: boolean
): Promise<number> {
  let cursor: string | undefined;
  for (let i = 0; i < args.length; i += 1) {
    if ((args[i] === "--cursor" || args[i] === "-c") && args[i + 1]) {
      cursor = args[i + 1];
      i += 1;
    }
  }
  const result = await listResourceTemplates(options, cursor ? { cursor } : undefined);
  console.log(formatOutput(result, pretty));
  return 0;
}

async function runListPrompts(
  options: { mcpUrl: string; knId: string; accessToken: string },
  args: string[],
  pretty: boolean
): Promise<number> {
  let cursor: string | undefined;
  for (let i = 0; i < args.length; i += 1) {
    if ((args[i] === "--cursor" || args[i] === "-c") && args[i + 1]) {
      cursor = args[i + 1];
      i += 1;
    }
  }
  const result = await listPrompts(options, cursor ? { cursor } : undefined);
  console.log(formatOutput(result, pretty));
  return 0;
}

async function runGetPrompt(
  options: { mcpUrl: string; knId: string; accessToken: string },
  args: string[],
  pretty: boolean
): Promise<number> {
  const name = args.find((a) => !a.startsWith("-"));
  if (!name) {
    console.error("Usage: kweaver context-loader prompt <name> [--args json]");
    return 1;
  }
  let promptArgs: Record<string, unknown> | undefined;
  for (let i = 0; i < args.length; i += 1) {
    if ((args[i] === "--args" || args[i] === "-a") && args[i + 1]) {
      try {
        promptArgs = JSON.parse(args[i + 1]) as Record<string, unknown>;
      } catch {
        console.error("Invalid --args JSON");
        return 1;
      }
      i += 1;
    }
  }
  const result = await getPrompt(options, name, promptArgs);
  console.log(formatOutput(result, pretty));
  return 0;
}

function parseResponseText(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return { raw: text };
  }
}

function parseSearchSchemaScope(raw: string): SearchSchemaScope {
  const scope: Required<SearchSchemaScope> = {
    include_object_types: false,
    include_relation_types: false,
    include_action_types: false,
    include_metric_types: false,
  };
  const aliases: Record<string, keyof SearchSchemaScope> = {
    object: "include_object_types",
    objects: "include_object_types",
    object_type: "include_object_types",
    object_types: "include_object_types",
    relation: "include_relation_types",
    relations: "include_relation_types",
    relation_type: "include_relation_types",
    relation_types: "include_relation_types",
    action: "include_action_types",
    actions: "include_action_types",
    action_type: "include_action_types",
    action_types: "include_action_types",
    metric: "include_metric_types",
    metrics: "include_metric_types",
    metric_type: "include_metric_types",
    metric_types: "include_metric_types",
  };

  for (const item of raw.split(",")) {
    const key = item.trim().toLowerCase();
    if (!key) continue;
    const field = aliases[key];
    if (!field) {
      throw new Error(`Invalid --scope value: ${item}`);
    }
    scope[field] = true;
  }
  return scope;
}

async function runSearchSchema(
  options: { mcpUrl: string; knId: string; accessToken: string },
  args: string[],
  pretty: boolean
): Promise<number> {
  let query: string | undefined;
  let responseFormat: "json" | "toon" | undefined;
  let searchScope: SearchSchemaScope | undefined;
  let maxConcepts: number | undefined;
  let schemaBrief: boolean | undefined;
  let enableRerank: boolean | undefined;

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if ((arg === "--format" || arg === "-f") && args[i + 1]) {
      const value = args[i + 1];
      if (value !== "json" && value !== "toon") {
        console.error("Usage: kweaver context-loader search-schema <query> [--format json|toon] [--scope object,relation,action,metric] [--max N] [--brief] [--no-rerank]");
        return 1;
      }
      responseFormat = value;
      i += 1;
    } else if ((arg === "--scope" || arg === "-s") && args[i + 1]) {
      try {
        searchScope = parseSearchSchemaScope(args[i + 1]);
      } catch (error) {
        console.error(error instanceof Error ? error.message : String(error));
        return 1;
      }
      i += 1;
    } else if ((arg === "--max" || arg === "-n") && args[i + 1]) {
      maxConcepts = parseInt(args[i + 1], 10);
      if (!Number.isFinite(maxConcepts)) {
        console.error("Usage: kweaver context-loader search-schema <query> [--max N]");
        return 1;
      }
      i += 1;
    } else if (arg === "--brief") {
      schemaBrief = true;
    } else if (arg === "--no-rerank") {
      enableRerank = false;
    } else if (!arg.startsWith("-") && !query) {
      query = arg;
    }
  }

  if (!query) {
    console.error("Usage: kweaver context-loader search-schema <query> [--format json|toon] [--scope object,relation,action,metric] [--max N] [--brief] [--no-rerank]");
    return 1;
  }

  const result = await searchSchema(options, {
    query,
    response_format: responseFormat,
    search_scope: searchScope,
    max_concepts: maxConcepts,
    schema_brief: schemaBrief,
    enable_rerank: enableRerank,
  });
  console.log(formatOutput(result, pretty));
  return 0;
}

async function runToolCall(
  options: { mcpUrl: string; knId: string; accessToken: string },
  args: string[],
  pretty: boolean
): Promise<number> {
  let toolName: string | undefined;
  let rawArgs: string | undefined;

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if ((arg === "--args" || arg === "-a") && args[i + 1]) {
      rawArgs = args[i + 1];
      i += 1;
    } else if (!arg.startsWith("-") && !toolName) {
      toolName = arg;
    }
  }

  if (!toolName || rawArgs === undefined) {
    console.error("Usage: kweaver context-loader tool-call <name> --args '<json>'");
    return 1;
  }

  let parsedArgs: unknown;
  try {
    parsedArgs = JSON.parse(rawArgs) as unknown;
  } catch {
    console.error("Invalid --args JSON");
    return 1;
  }
  if (parsedArgs === null || typeof parsedArgs !== "object" || Array.isArray(parsedArgs)) {
    console.error("--args must be a JSON object");
    return 1;
  }

  const result = await callTool(options, toolName, parsedArgs as Record<string, unknown>);
  console.log(formatOutput(result, pretty));
  return 0;
}

async function runKnSearch(
  options: { baseUrl: string; knId: string; accessToken: string; businessDomain: string },
  args: string[],
  pretty: boolean
): Promise<number> {
  let query: string | undefined;
  let onlySchema = false;

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === "--only-schema") {
      onlySchema = true;
    } else if (!arg.startsWith("-") && !query) {
      query = arg;
    }
  }

  if (!query) {
    console.error("Usage: kweaver context-loader kn-search <kn-id> <query> [--only-schema]");
    return 1;
  }

  const raw = await knSearchHttp({
    baseUrl: options.baseUrl,
    accessToken: options.accessToken,
    businessDomain: options.businessDomain,
    knId: options.knId,
    query,
    onlySchema,
  });
  const result = parseResponseText(raw);
  console.log(formatOutput(result, pretty));
  return 0;
}

async function runKnSchemaSearch(
  options: { baseUrl: string; knId: string; accessToken: string; businessDomain: string },
  args: string[],
  pretty: boolean
): Promise<number> {
  let query: string | undefined;
  let maxConcepts: number | undefined;

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if ((arg === "--max" || arg === "-n") && args[i + 1]) {
      maxConcepts = parseInt(args[i + 1], 10);
      i += 1;
    } else if (!arg.startsWith("-") && !query) {
      query = arg;
    }
  }

  if (!query) {
    console.error("Usage: kweaver context-loader kn-schema-search <query> [--max N]");
    return 1;
  }

  const raw = await semanticSearch({
    baseUrl: options.baseUrl,
    accessToken: options.accessToken,
    businessDomain: options.businessDomain,
    knId: options.knId,
    query,
    maxConcepts,
  });
  const result = parseResponseText(raw);
  console.log(formatOutput(result, pretty));
  return 0;
}

function parseJsonArg(args: string[]): unknown {
  const raw = args.join(" ").trim();
  if (!raw) {
    throw new Error("Missing JSON argument");
  }
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    throw new Error("Invalid JSON argument");
  }
}

async function runQueryObjectInstance(
  options: { mcpUrl: string; knId: string; accessToken: string },
  args: string[],
  pretty: boolean
): Promise<number> {
  const body = parseJsonArg(args) as { ot_id: string; limit?: number; condition: ConditionSpec };
  if (!body.ot_id || !body.condition) {
    console.error("JSON must include ot_id and condition. See references/json-formats.md#context-loader");
    return 1;
  }
  const result = await queryObjectInstance(options, {
    ot_id: body.ot_id,
    limit: body.limit,
    condition: body.condition,
  });
  console.log(formatOutput(result, pretty));
  return 0;
}

async function runQueryInstanceSubgraph(
  options: { mcpUrl: string; knId: string; accessToken: string },
  args: string[],
  pretty: boolean
): Promise<number> {
  const body = parseJsonArg(args) as { relation_type_paths: RelationTypePath[] };
  if (!Array.isArray(body.relation_type_paths)) {
    console.error("JSON must include relation_type_paths array. See references/json-formats.md#context-loader");
    return 1;
  }
  const result = await queryInstanceSubgraph(options, body);
  console.log(formatOutput(result, pretty));
  return 0;
}

async function runGetLogicProperties(
  options: { mcpUrl: string; knId: string; accessToken: string },
  args: string[],
  pretty: boolean
): Promise<number> {
  const body = parseJsonArg(args) as {
    ot_id: string;
    query: string;
    _instance_identities: Record<string, string>[];
    properties: string[];
    additional_context?: string;
  };
  if (!body.ot_id || !body.query || !body._instance_identities || !body.properties) {
    console.error(
      "JSON must include ot_id, query, _instance_identities, properties. See references/json-formats.md#context-loader"
    );
    return 1;
  }
  const result = await getLogicPropertiesValues(options, body);
  console.log(formatOutput(result, pretty));
  return 0;
}

async function runGetActionInfo(
  options: { mcpUrl: string; knId: string; accessToken: string },
  args: string[],
  pretty: boolean
): Promise<number> {
  const body = parseJsonArg(args) as { at_id: string; _instance_identity: Record<string, string> };
  if (!body.at_id || !body._instance_identity) {
    console.error("JSON must include at_id and _instance_identity. See references/json-formats.md#context-loader");
    return 1;
  }
  const result = await getActionInfo(options, body);
  console.log(formatOutput(result, pretty));
  return 0;
}

async function runFindSkills(
  options: { mcpUrl: string; knId: string; accessToken: string },
  args: string[],
  pretty: boolean
): Promise<number> {
  const usage =
    "Usage: kweaver context-loader find-skills <object_type_id> " +
    "[--query <text>] [--top-k N] [--instance-identities <json>] [--format json|toon]";

  let objectTypeId: string | undefined;
  let skillQuery: string | undefined;
  let topK: number | undefined;
  let instanceIdentities: Record<string, unknown>[] | undefined;
  let responseFormat: "json" | "toon" | undefined;

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if ((arg === "--query" || arg === "-q") && args[i + 1]) {
      skillQuery = args[i + 1];
      i += 1;
    } else if ((arg === "--top-k" || arg === "-n") && args[i + 1]) {
      topK = parseInt(args[i + 1], 10);
      if (!Number.isFinite(topK)) {
        console.error(usage);
        return 1;
      }
      i += 1;
    } else if ((arg === "--instance-identities" || arg === "-i") && args[i + 1]) {
      try {
        const parsed = JSON.parse(args[i + 1]) as unknown;
        if (!Array.isArray(parsed)) {
          throw new Error("--instance-identities must be a JSON array");
        }
        instanceIdentities = parsed as Record<string, unknown>[];
      } catch (error) {
        console.error(error instanceof Error ? error.message : String(error));
        return 1;
      }
      i += 1;
    } else if ((arg === "--format" || arg === "-f") && args[i + 1]) {
      const value = args[i + 1];
      if (value !== "json" && value !== "toon") {
        console.error(usage);
        return 1;
      }
      responseFormat = value;
      i += 1;
    } else if (!arg.startsWith("-") && !objectTypeId) {
      objectTypeId = arg;
    }
  }

  if (!objectTypeId) {
    console.error(usage);
    return 1;
  }

  const result = await findSkills(options, {
    object_type_id: objectTypeId,
    skill_query: skillQuery,
    top_k: topK,
    instance_identities: instanceIdentities,
    response_format: responseFormat,
  });
  console.log(formatOutput(result, pretty));
  return 0;
}
