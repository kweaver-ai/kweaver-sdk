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
import { renderHelp } from "../help/format.js";

const CONTEXT_LOADER_CONFIG_DEPRECATION =
  "[deprecated] `kweaver context-loader config ...` will be removed in a future release. " +
  "Pass <kn-id> as the first positional to runtime subcommands instead, e.g. " +
  "`kweaver context-loader tools <kn-id>` (or use the `--kn-id <id>` flag).";

const MCP_NOT_CONFIGURED =
  "Context-loader MCP is not configured. Run: kweaver context-loader config set --kn-id <kn-id>";

const MCP_PATH = "/api/agent-retrieval/v1/mcp";

const DEPRECATED_KN_SEARCH_MESSAGE =
  "[deprecated] context-loader kn-search is deprecated. Use context-loader search-schema instead.";
const DEPRECATED_KN_SCHEMA_SEARCH_MESSAGE =
  "[deprecated] context-loader kn-schema-search is deprecated. Use context-loader search-schema instead.";

const CONTEXT_LOADER_HELP = renderHelp({
  tagline: "MCP / HTTP context-loader — schema discovery, instance query, action info, skill recall",
  usage: [
    "kweaver context-loader <subcommand> [flags]",
    "kweaver context-loader help <subcommand>",
  ],
  sections: [
    {
      title: "RECOMMENDED FLOW",
      items: [
        { name: "1. search-schema", desc: "Discover schema concepts" },
        { name: "2. query-*", desc: "Query instances using discovered schema IDs" },
        { name: "3. get-* / find-skills", desc: "Enrich instances or inspect actions" },
        { name: "—  tool-call", desc: "Raw MCP debugging or unsupported tools only" },
      ],
    },
    {
      title: "SCHEMA DISCOVERY",
      items: [
        { name: "search-schema", desc: "Search object/relation/action/metric schemas" },
        { name: "kn-search", desc: "[deprecated] Use search-schema" },
        { name: "kn-schema-search", desc: "[deprecated] Use search-schema" },
      ],
    },
    {
      title: "INSTANCE QUERY",
      items: [
        { name: "query-object-instance", desc: "Query object instances" },
        { name: "query-instance-subgraph", desc: "Query instance subgraphs" },
      ],
    },
    {
      title: "INSTANCE ENRICHMENT / ACTION",
      items: [
        { name: "get-logic-properties", desc: "Get calculated logic-property values" },
        { name: "get-action-info", desc: "Get action metadata and executable info" },
        { name: "find-skills", desc: "Recall skills for an object type" },
      ],
    },
    {
      title: "ADVANCED MCP",
      items: [
        { name: "tools", desc: "List MCP tools" },
        { name: "resources", desc: "List MCP resources" },
        { name: "resource", desc: "Read an MCP resource by URI" },
        { name: "templates", desc: "List MCP resource templates" },
        { name: "prompts", desc: "List MCP prompts" },
        { name: "prompt", desc: "Get an MCP prompt by name" },
        { name: "tool-call", desc: "Call any MCP tool directly" },
      ],
    },
    {
      title: "DEPRECATED",
      items: [{ name: "config", desc: "Manage legacy saved KN selection (set/use/list/remove/show)" }],
    },
  ],
  flags: [
    { name: "-k, --kn-id <id>", desc: "KN selector for runtime subcommands" },
    { name: "--pretty", desc: "Pretty-print JSON output" },
    { name: "--compact", desc: "Compact JSON output" },
  ],
  inheritedFlags: "--base-url, --token, --user, --help",
  examples: [
    "kweaver context-loader search-schema <id> 'customer churn'",
    "kweaver context-loader query-object-instance <id> --object-type-id <ot> --limit 10",
    "kweaver context-loader find-skills <id> <ot-id>",
  ],
  learnMore: [
    "Alias: `kweaver context ...`",
    "Use `kweaver context-loader <subcommand> --help` for arguments, JSON shapes, examples",
    "Most runtime subcommands require a KN — first positional or --kn-id / -k",
  ],
});

const CONTEXT_LOADER_CONFIG_HELP = renderHelp({
  tagline: "[deprecated] Manage the saved context-loader KN selection",
  usage: [
    "kweaver context-loader config set --kn-id <id> [--name <name>]",
    "kweaver context-loader config use <name>",
    "kweaver context-loader config list",
    "kweaver context-loader config remove <name>",
    "kweaver context-loader config show",
  ],
  flags: [
    { name: "--kn-id <id>", desc: "KN id to save (for `config set`)" },
    { name: "--name <name>", desc: "Saved config name (for `config set`; default: default)" },
  ],
  inheritedFlags: "--base-url, --token, --user, --help",
  examples: [
    "kweaver context-loader tools d5iv6c9818p72mpje8pg",
    "kweaver context-loader tools --kn-id d5iv6c9818p72mpje8pg",
  ],
  learnMore: [
    "Deprecated: runtime commands should pass <kn-id> as the first positional or use --kn-id/-k",
    "Disabled in stateless mode (--token); will be removed in a future release",
  ],
});

const CONTEXT_LOADER_SUBCOMMAND_HELP: Record<string, string> = {
  tools: `kweaver context-loader tools

Usage:
  kweaver context-loader tools <kn-id> [--cursor <cursor>] [--pretty]
  kweaver context-loader tools --kn-id <kn-id> [--cursor <cursor>] [--pretty]

Description:
  List MCP tools exposed by the context-loader server for the selected KN.

Arguments:
  <kn-id>             KN ID. Prefer the first positional argument.

Options:
  --kn-id <kn-id>, -k <kn-id>   Alternative KN selector.
  --cursor <cursor>, -c <cursor>
                              Cursor returned by a previous page.
  --pretty                     Pretty-print JSON output. This is the default.
  --help, -h                   Show this help and exit before auth/config/network checks.

Output shape:
  MCP tools/list response, usually { "tools": [...], "nextCursor": "..." }.

Examples:
  kweaver context-loader tools d5iv6c9818p72mpje8pg
  kweaver context-loader tools --kn-id d5iv6c9818p72mpje8pg --cursor next-page`,

  resources: `kweaver context-loader resources

Usage:
  kweaver context-loader resources <kn-id> [--cursor <cursor>] [--pretty]

Description:
  List context-loader MCP resources for the selected KN.

Arguments:
  <kn-id>             KN ID. Prefer the first positional argument.

Options:
  --kn-id <kn-id>, -k <kn-id>   Alternative KN selector.
  --cursor <cursor>, -c <cursor>
                              Cursor returned by a previous page.
  --pretty                     Pretty-print JSON output. This is the default.
  --help, -h                   Show this help and exit before auth/config/network checks.

Output shape:
  MCP resources/list response, usually { "resources": [...], "nextCursor": "..." }.

Examples:
  kweaver context-loader resources d5iv6c9818p72mpje8pg`,

  resource: `kweaver context-loader resource

Usage:
  kweaver context-loader resource <kn-id> <uri> [--pretty]

Description:
  Read one context-loader MCP resource by URI.

Arguments:
  <kn-id>             KN ID. Prefer the first positional argument.
  <uri>               MCP resource URI returned by resources/list.

Options:
  --kn-id <kn-id>, -k <kn-id>   Alternative KN selector.
  --pretty                     Pretty-print JSON output. This is the default.
  --help, -h                   Show this help and exit before auth/config/network checks.

Output shape:
  MCP resources/read response for the requested URI.

Examples:
  kweaver context-loader resource d5iv6c9818p72mpje8pg kweaver://resource/example`,

  templates: `kweaver context-loader templates

Usage:
  kweaver context-loader templates <kn-id> [--cursor <cursor>] [--pretty]

Description:
  List MCP resource templates exposed by context-loader.

Arguments:
  <kn-id>             KN ID. Prefer the first positional argument.

Options:
  --kn-id <kn-id>, -k <kn-id>   Alternative KN selector.
  --cursor <cursor>, -c <cursor>
                              Cursor returned by a previous page.
  --pretty                     Pretty-print JSON output. This is the default.
  --help, -h                   Show this help and exit before auth/config/network checks.

Output shape:
  MCP resources/templates/list response.

Examples:
  kweaver context-loader templates d5iv6c9818p72mpje8pg`,

  prompts: `kweaver context-loader prompts

Usage:
  kweaver context-loader prompts <kn-id> [--cursor <cursor>] [--pretty]

Description:
  List MCP prompts exposed by context-loader.

Arguments:
  <kn-id>             KN ID. Prefer the first positional argument.

Options:
  --kn-id <kn-id>, -k <kn-id>   Alternative KN selector.
  --cursor <cursor>, -c <cursor>
                              Cursor returned by a previous page.
  --pretty                     Pretty-print JSON output. This is the default.
  --help, -h                   Show this help and exit before auth/config/network checks.

Output shape:
  MCP prompts/list response.

Examples:
  kweaver context-loader prompts d5iv6c9818p72mpje8pg`,

  prompt: `kweaver context-loader prompt

Usage:
  kweaver context-loader prompt <kn-id> <name> [--args '<json>'] [--pretty]

Description:
  Get a named MCP prompt from context-loader.

Arguments:
  <kn-id>             KN ID. Prefer the first positional argument.
  <name>              Prompt name.

Options:
  --kn-id <kn-id>, -k <kn-id>   Alternative KN selector.
  --args '<json>', -a '<json>'  Optional prompt arguments as a JSON object.
  --pretty                     Pretty-print JSON output. This is the default.
  --help, -h                   Show this help and exit before auth/config/network checks.

Input JSON shape:
  --args must be a JSON object, for example {"topic":"profit margin"}.

Output shape:
  MCP prompts/get response.

Examples:
  kweaver context-loader prompt d5iv6c9818p72mpje8pg explain --args '{"topic":"利润率"}'`,

  "search-schema": `kweaver context-loader search-schema

Usage:
  kweaver context-loader search-schema <kn-id> <query> [options]
  kweaver context-loader search-schema --kn-id <kn-id> <query> [options]

Description:
  Call the context-loader MCP search_schema tool. Use it to search schema concepts
  such as object types, relation types, action types, metric types, and optional
  concept_group scoped schemas.

Arguments:
  <kn-id>             Recommended KN selector. Alternative: --kn-id <kn-id>.
                      If omitted, falls back to deprecated saved config when present.
  <query>             Required. Natural-language query text.

Options:
  --kn-id <kn-id>, -k <kn-id>   Alternative KN selector.
  --format json|toon, -f json|toon
                              Response format requested from search_schema.
                              Default: json.
  --scope object,relation,action,metric
                              Comma-separated schema type filters.
                              Default: not sent; server default applies.
  --concept-groups <ids>       Comma-separated concept_group IDs.
                              Default: not sent; no concept_group filter.
  --concept-group <ids>        Alias of --concept-groups.
  --max <n>, -n <n>            Maximum concepts to request.
                              Default: not sent; server default applies.
  --brief                      Request brief schema output.
                              Default: not sent.
  --no-rerank                  Disable server-side rerank.
                              Default: not sent; server default applies.
  --pretty                     Pretty-print JSON output. This is the default.
                              Default: enabled.
  --help, -h                   Show this help and exit before auth/config/network checks.

MCP arguments:
  {
    "query": "<query>",
    "response_format": "json|toon",
    "search_scope": {
      "include_object_types": true,
      "include_relation_types": true,
      "include_action_types": true,
      "include_metric_types": true,
      "concept_groups": ["group_id"]
    },
    "max_concepts": 5,
    "schema_brief": true,
    "enable_rerank": false
  }

Concept group semantics:
  --concept-groups maps to search_scope.concept_groups. It limits schema discovery
  to the selected concept_group definitions and is not an instance-data filter.

Output shape:
  MCP tools/call response for search_schema. The content may be structured JSON or
  text depending on --format and server behavior.

Equivalent tool-call:
  kweaver context-loader tool-call <kn-id> search_schema --args '{"query":"需求","search_scope":{"concept_groups":["group_id"]}}'

Examples:
  kweaver context-loader search-schema d5iv6c9818p72mpje8pg "需求"
  kweaver context-loader search-schema d5iv6c9818p72mpje8pg "利润率" --scope object,metric --concept-groups finance --max 5 --brief
  kweaver context-loader search-schema --kn-id d5iv6c9818p72mpje8pg "需求" --format toon --no-rerank

Notes:
  kn-search and kn-schema-search are deprecated. Use context-loader search-schema instead.`,

  "tool-call": `kweaver context-loader tool-call

Usage:
  kweaver context-loader tool-call <kn-id> <name> --args '<json>' [--pretty]

Description:
  Call any context-loader MCP tool by name. Prefer dedicated CLI wrappers such as
  search-schema when they exist because their arguments are easier to inspect.

Arguments:
  <kn-id>             KN ID. Prefer the first positional argument.
  <name>              MCP tool name, for example search_schema.

Options:
  --kn-id <kn-id>, -k <kn-id>   Alternative KN selector.
  --args '<json>', -a '<json>'  Tool arguments as a JSON object.
  --pretty                     Pretty-print JSON output. This is the default.
  --help, -h                   Show this help and exit before auth/config/network checks.

Input JSON shape:
  --args must be a JSON object accepted by the selected MCP tool.

Output shape:
  MCP tools/call response, usually { "content": [...], "isError": false }.

Examples:
  kweaver context-loader tool-call d5iv6c9818p72mpje8pg search_schema --args '{"query":"需求"}'
  kweaver context-loader tool-call d5iv6c9818p72mpje8pg query_object_instance --args '{"query":{"ot_id":"material"}}'`,

  "query-object-instance": `kweaver context-loader query-object-instance

Usage:
  kweaver context-loader query-object-instance <kn-id> '<json>' [--pretty]

Description:
  Query object instances from a selected KN object type. This is an instance-data
  query and is separate from schema discovery.

Arguments:
  <kn-id>             KN ID. Prefer the first positional argument.
  <json>              Query payload as a JSON object.

Options:
  --kn-id <kn-id>, -k <kn-id>   Alternative KN selector.
  --pretty                     Pretty-print JSON output. This is the default.
  --help, -h                   Show this help and exit before auth/config/network checks.

Input JSON shape:
  {
    "ot_id": "object_type_id",
    "condition": {
      "property": "name",
      "operator": "contains",
      "value_from": "const",
      "value": "需求"
    },
    "limit": 20
  }

Output shape:
  MCP query_object_instance tool response, usually instance rows plus metadata.

Examples:
  kweaver context-loader query-object-instance d5iv6c9818p72mpje8pg '{"ot_id":"material","condition":{"property":"name","operator":"contains","value_from":"const","value":"铜"}}'`,

  "query-instance-subgraph": `kweaver context-loader query-instance-subgraph

Usage:
  kweaver context-loader query-instance-subgraph <kn-id> '<json>' [--pretty]

Description:
  Query a subgraph around selected object instances.

Arguments:
  <kn-id>             KN ID. Prefer the first positional argument.
  <json>              Subgraph query payload as a JSON object.

Options:
  --kn-id <kn-id>, -k <kn-id>   Alternative KN selector.
  --pretty                     Pretty-print JSON output. This is the default.
  --help, -h                   Show this help and exit before auth/config/network checks.

Input JSON shape:
  {
    "relation_type_paths": [
      {
        "rt_id": "relation_type_id",
        "from": {
          "ot_id": "source_object_type_id",
          "condition": {
            "property": "name",
            "operator": "contains",
            "value_from": "const",
            "value": "需求"
          }
        },
        "to": {
          "ot_id": "target_object_type_id"
        }
      }
    ]
  }

Output shape:
  MCP query_instance_subgraph tool response with nodes and relations.

Examples:
  kweaver context-loader query-instance-subgraph d5iv6c9818p72mpje8pg '{"relation_type_paths":[{"rt_id":"depends_on","from":{"ot_id":"requirement","condition":{"property":"name","operator":"contains","value_from":"const","value":"需求"}},"to":{"ot_id":"task"}}]}'`,

  "get-logic-properties": `kweaver context-loader get-logic-properties

Usage:
  kweaver context-loader get-logic-properties <kn-id> '<json>' [--pretty]

Description:
  Layer 3-style instance enrichment: get calculated logic property values for
  object instances.

Arguments:
  <kn-id>             KN ID. Prefer the first positional argument.
  <json>              Request payload as a JSON object.

Options:
  --kn-id <kn-id>, -k <kn-id>   Alternative KN selector.
  --pretty                     Pretty-print JSON output. This is the default.
  --help, -h                   Show this help and exit before auth/config/network checks.

Input JSON shape:
  {
    "ot_id": "object_type_id",
    "query": "natural-language query",
    "_instance_identities": [{"id": "instance_id"}],
    "properties": ["logic_property_id"],
    "additional_context": "optional context"
  }

Output shape:
  MCP get_logic_properties tool response with property values.

Examples:
  kweaver context-loader get-logic-properties d5iv6c9818p72mpje8pg '{"ot_id":"material","query":"风险评分","_instance_identities":[{"id":"m1"}],"properties":["risk_score"]}'`,

  "get-action-info": `kweaver context-loader get-action-info

Usage:
  kweaver context-loader get-action-info <kn-id> '<json>' [--pretty]

Description:
  Layer 3-style instance action inspection: get action metadata and executable
  information for selected schema or instance context.

Arguments:
  <kn-id>             KN ID. Prefer the first positional argument.
  <json>              Request payload as a JSON object.

Options:
  --kn-id <kn-id>, -k <kn-id>   Alternative KN selector.
  --pretty                     Pretty-print JSON output. This is the default.
  --help, -h                   Show this help and exit before auth/config/network checks.

Input JSON shape:
  {
    "at_id": "action_type_id",
    "_instance_identity": {"id": "instance_id"}
  }

Output shape:
  MCP get_action_info tool response.

Examples:
  kweaver context-loader get-action-info d5iv6c9818p72mpje8pg '{"at_id":"approve","_instance_identity":{"id":"r1"}}'`,

  "find-skills": `kweaver context-loader find-skills

Usage:
  kweaver context-loader find-skills <kn-id> <ot_id> [options]

Description:
  Layer 3-style instance action discovery: recall skills related to an object type.

Arguments:
  <kn-id>             KN ID. Prefer the first positional argument.
  <ot_id>             Object type ID.

Options:
  --kn-id <kn-id>, -k <kn-id>   Alternative KN selector.
  --query <text>, -q <text>     Optional skill search query.
  --top-k <n>, -n <n>           Maximum skills to return.
  --instance-identities '<json>', -i '<json>'
                                Optional JSON array of instance identities.
  --format json|toon, -f json|toon
                                Response format requested from the server.
  --pretty                     Pretty-print JSON output. This is the default.
  --help, -h                   Show this help and exit before auth/config/network checks.

Input JSON shape:
  Positional and option values are converted to:
  {
    "object_type_id": "object_type_id",
    "skill_query": "optional query",
    "top_k": 10,
    "instance_identities": [{"id": "instance_id"}],
    "response_format": "json|toon"
  }

Output shape:
  MCP find_skills tool response with matched skills.

Examples:
  kweaver context-loader find-skills d5iv6c9818p72mpje8pg requirement --query "review requirement quality" --top-k 5`,

  "kn-search": `kweaver context-loader kn-search  [deprecated]

Usage:
  kweaver context-loader kn-search <kn-id> <query> [--only-schema] [--pretty]

Description:
  [deprecated] Legacy KN semantic search wrapper.

Arguments:
  <kn-id>             KN ID. Prefer the first positional argument.
  <query>             Search query text.

Options:
  --kn-id <kn-id>, -k <kn-id>   Alternative KN selector.
  --only-schema                 Return schema-oriented results when supported.
  --pretty                     Pretty-print JSON output. This is the default.
  --help, -h                   Show this help and exit before auth/config/network checks.

Output shape:
  Legacy semantic search response.

Examples:
  kweaver context-loader search-schema d5iv6c9818p72mpje8pg "需求"

Notes:
  Use context-loader search-schema instead. kn-search is deprecated.`,

  "kn-schema-search": `kweaver context-loader kn-schema-search  [deprecated]

Usage:
  kweaver context-loader kn-schema-search <kn-id> <query> [--max <n>] [--pretty]

Description:
  [deprecated] Legacy schema search wrapper.

Arguments:
  <kn-id>             KN ID. Prefer the first positional argument.
  <query>             Search query text.

Options:
  --kn-id <kn-id>, -k <kn-id>   Alternative KN selector.
  --max <n>, -n <n>             Maximum results.
  --pretty                     Pretty-print JSON output. This is the default.
  --help, -h                   Show this help and exit before auth/config/network checks.

Output shape:
  Legacy schema search response.

Examples:
  kweaver context-loader search-schema d5iv6c9818p72mpje8pg "需求"

Notes:
  Use context-loader search-schema instead. kn-schema-search is deprecated.`,

  config: CONTEXT_LOADER_CONFIG_HELP,
};

function hasHelpFlag(args: string[]): boolean {
  return args.includes("--help") || args.includes("-h");
}

function printContextLoaderHelp(topic?: string): number {
  if (!topic || topic === "--help" || topic === "-h") {
    console.log(CONTEXT_LOADER_HELP);
    return 0;
  }
  const help = CONTEXT_LOADER_SUBCOMMAND_HELP[topic];
  if (!help) {
    console.error(`Unknown context-loader help topic: ${topic}`);
    console.error(`Available topics: ${Object.keys(CONTEXT_LOADER_SUBCOMMAND_HELP).sort().join(", ")}`);
    return 1;
  }
  console.log(help);
  return 0;
}

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
    return printContextLoaderHelp();
  }

  if (subcommand === "help") {
    return printContextLoaderHelp(rest[0]);
  }

  if (hasHelpFlag(rest)) {
    return printContextLoaderHelp(subcommand);
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
    console.log(CONTEXT_LOADER_CONFIG_HELP);
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
  type SearchSchemaIncludeField = Exclude<keyof SearchSchemaScope, "concept_groups">;
  const scope: SearchSchemaScope = {
    include_object_types: false,
    include_relation_types: false,
    include_action_types: false,
    include_metric_types: false,
  };
  const aliases: Record<string, SearchSchemaIncludeField> = {
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

function parseConceptGroups(raw: string): string[] {
  const seen = new Set<string>();
  const groups: string[] = [];
  for (const item of raw.split(",")) {
    const value = item.trim();
    if (!value || seen.has(value)) continue;
    seen.add(value);
    groups.push(value);
  }
  return groups;
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
  let conceptGroups: string[] | undefined;

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if ((arg === "--format" || arg === "-f") && args[i + 1]) {
      const value = args[i + 1];
      if (value !== "json" && value !== "toon") {
        console.error("Usage: kweaver context-loader search-schema <query> [--format json|toon] [--scope object,relation,action,metric] [--concept-groups ids] [--max N] [--brief] [--no-rerank]");
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
    } else if ((arg === "--concept-groups" || arg === "--concept-group") && args[i + 1]) {
      conceptGroups = parseConceptGroups(args[i + 1]);
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
    console.error("Usage: kweaver context-loader search-schema <query> [--format json|toon] [--scope object,relation,action,metric] [--concept-groups ids] [--max N] [--brief] [--no-rerank]");
    return 1;
  }

  if (conceptGroups !== undefined) {
    searchScope = {
      ...(searchScope ?? {}),
      concept_groups: conceptGroups,
    };
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

  console.error(DEPRECATED_KN_SEARCH_MESSAGE);
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
    console.error("Usage: kweaver context-loader kn-schema-search <kn-id> <query> [--max N]");
    return 1;
  }

  console.error(DEPRECATED_KN_SCHEMA_SEARCH_MESSAGE);
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
