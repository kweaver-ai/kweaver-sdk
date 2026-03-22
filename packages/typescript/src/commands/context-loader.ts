import { ensureValidToken, formatHttpError, with401RefreshRetry } from "../auth/oauth.js";
import type { ConditionSpec, RelationTypePath } from "../api/context-loader.js";
import {
  knSearch,
  knSchemaSearch,
  queryObjectInstance,
  queryInstanceSubgraph,
  getLogicPropertiesValues,
  getActionInfo,
  listTools,
  listResources,
  readResource,
  listResourceTemplates,
  listPrompts,
  getPrompt,
} from "../api/context-loader.js";
import {
  addContextLoaderEntry,
  getCurrentContextLoaderKn,
  getCurrentPlatform,
  loadContextLoaderConfig,
  removeContextLoaderEntry,
  setCurrentContextLoader,
} from "../config/store.js";

const MCP_NOT_CONFIGURED =
  "Context-loader MCP is not configured. Run: kweaver context-loader config set --kn-id <kn-id>";

function ensureContextLoaderConfig(): {
  mcpUrl: string;
  knId: string;
  accessToken: string;
} {
  const platform = getCurrentPlatform();
  if (!platform) {
    throw new Error("No platform selected. Run: kweaver auth <platform-url>");
  }

  const kn = getCurrentContextLoaderKn();
  if (!kn) {
    throw new Error(MCP_NOT_CONFIGURED);
  }

  return {
    mcpUrl: kn.mcpUrl,
    knId: kn.knId,
    accessToken: "", // filled by caller after ensureValidToken
  };
}

function formatOutput(value: unknown, pretty: boolean): string {
  const json = JSON.stringify(value, null, pretty ? 2 : 0);
  return json;
}

export async function runContextLoaderCommand(args: string[]): Promise<number> {
  const [subcommand, ...rest] = args;

  if (!subcommand || subcommand === "--help" || subcommand === "-h") {
    console.log(`kweaver context-loader

Subcommands:
  config set --kn-id <id> [--name n]   Add or update kn config (MCP URL derived from platform)
  config use <name>                    Switch current config
  config list                         List all configs and current
  config remove <name>                 Remove a config
  config show                         Show current config (knId + mcpUrl)
  tools                               tools/list - list available tools
  resources                           resources/list - list resources
  resource <uri>                      resources/read - read resource by URI
  templates                           resources/templates/list - list resource templates
  prompts                             prompts/list - list prompts
  prompt <name> [--args json]          prompts/get - get prompt by name
  kn-search <query> [--only-schema]    Layer 1: Search schema (object_types, relation_types, action_types)
  kn-schema-search <query> [--max N]   Layer 1: Discover candidate concepts
  query-object-instance <json>         Layer 2: Query instances (args as JSON)
  query-instance-subgraph <json>       Layer 2: Query subgraph (args as JSON)
  get-logic-properties <json>          Layer 3: Get logic property values (args as JSON)
  get-action-info <json>               Layer 3: Get action info (args as JSON)

Examples:
  kweaver context-loader config set --kn-id d5iv6c9818p72mpje8pg
  kweaver context-loader config set --kn-id xyz123 --name project-a
  kweaver context-loader kn-search "高血压 治疗 药品" --only-schema --pretty`);
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

  const dispatch = async (): Promise<number> => {
    const token = await ensureValidToken();
    const base = ensureContextLoaderConfig();
    const options = { ...base, accessToken: token.accessToken };

    if (subcommand === "tools") return runListTools(options, rest, pretty);
    if (subcommand === "resources") return runListResources(options, rest, pretty);
    if (subcommand === "resource") return runReadResource(options, rest, pretty);
    if (subcommand === "templates") return runListTemplates(options, rest, pretty);
    if (subcommand === "prompts") return runListPrompts(options, rest, pretty);
    if (subcommand === "prompt") return runGetPrompt(options, rest, pretty);
    if (subcommand === "kn-search") return runKnSearch(options, rest, pretty);
    if (subcommand === "kn-schema-search") return runKnSchemaSearch(options, rest, pretty);
    if (subcommand === "query-object-instance") return runQueryObjectInstance(options, rest, pretty);
    if (subcommand === "query-instance-subgraph") return runQueryInstanceSubgraph(options, rest, pretty);
    if (subcommand === "get-logic-properties") return runGetLogicProperties(options, rest, pretty);
    if (subcommand === "get-action-info") return runGetActionInfo(options, rest, pretty);
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
    console.log(`kweaver context-loader config

Subcommands:
  set --kn-id <id> [--name <name>]   Add or update kn config (default name: default)
  use <name>                         Switch current config
  list                               List all configs and current
  remove <name>                      Remove a config
  show                               Show current config (knId + mcpUrl)`);
    return 0;
  }

  const platform = getCurrentPlatform();
  if (!platform) {
    console.error("No platform selected. Run: kweaver auth <platform-url>");
    return 1;
  }

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

async function runKnSearch(
  options: { mcpUrl: string; knId: string; accessToken: string },
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
    console.error("Usage: kweaver context-loader kn-search <query> [--only-schema]");
    return 1;
  }

  const result = await knSearch(options, { query, only_schema: onlySchema });
  console.log(formatOutput(result, pretty));
  return 0;
}

async function runKnSchemaSearch(
  options: { mcpUrl: string; knId: string; accessToken: string },
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

  const result = await knSchemaSearch(options, {
    query,
    max_concepts: maxConcepts,
  });
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
