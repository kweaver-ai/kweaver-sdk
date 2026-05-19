import { ensureValidToken, formatHttpError } from "../auth/oauth.js";
import {
  subgraph,
  actionExecutionGet,
  actionLogsList,
  actionLogGet,
  actionLogCancel,
} from "../api/ontology-query.js";
import { queryRelationTypePaths, listBknResources } from "../api/bkn-backend.js";
import { semanticSearch } from "../api/semantic-search.js";
import { formatCallOutput } from "./call.js";
import { resolveBusinessDomain } from "../config/store.js";
import { parseOntologyQueryFlags } from "./bkn-utils.js";
import { renderHelp } from "../help/format.js";

// ── subgraph ─────────────────────────────────────────────────────────────────

export async function runKnSubgraphCommand(args: string[]): Promise<number> {
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
      console.log(renderHelp({
        tagline: "Query subgraph via ontology-query API. JSON body format see references/json-formats.md#subgraph.",
        usage: "kweaver bkn subgraph <kn-id> '<json>' [flags]",
        flags: [
          { name: "--pretty", desc: "Pretty-print JSON output" },
          { name: "-bd, --biz-domain <s>", desc: "Override x-business-domain" },
        ],
        inheritedFlags: "--base-url, --token, --user, --help",
        examples: [
          "kweaver bkn subgraph kn-123 '{\"source_object_type_id\":\"ot-1\"}'",
        ],
      }));
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
    // Map body shape to ontology-query subgraph query_type:
    // - relation_type_paths mode → ?query_type=relation_path
    // - source_object_type_id mode → omit query_type (default path; do not send relation_path)
    let queryType: "" | "relation_path" | undefined;
    try {
      const parsedBody = JSON.parse(body) as Record<string, unknown>;
      if (Array.isArray(parsedBody.relation_type_paths)) {
        queryType = "relation_path";
      } else if (parsedBody.source_object_type_id) {
        queryType = "";
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

// ── action-execution ─────────────────────────────────────────────────────────

export async function runKnActionExecutionCommand(args: string[]): Promise<number> {
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
      console.log(renderHelp({
        tagline: "Get action execution status.",
        usage: "kweaver bkn action-execution get <kn-id> <execution-id> [flags]",
        flags: [
          { name: "--pretty", desc: "Pretty-print JSON output" },
          { name: "-bd, --biz-domain <s>", desc: "Override x-business-domain" },
        ],
        inheritedFlags: "--base-url, --token, --user, --help",
        examples: [
          "kweaver bkn action-execution get kn-123 exec-456",
        ],
      }));
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

// ── action-log ───────────────────────────────────────────────────────────────

export async function runKnActionLogCommand(args: string[]): Promise<number> {
  const [action, ...rest] = args;
  if (!action || action === "--help" || action === "-h") {
    console.log(renderHelp({
      tagline: "List/get execution logs. cancel has side effects - only use when explicitly requested.",
      usage: [
        "kweaver bkn action-log list <kn-id> [flags]",
        "kweaver bkn action-log get <kn-id> <log-id> [flags]",
        "kweaver bkn action-log cancel <kn-id> <log-id> [flags]",
      ],
      flags: [
        { name: "--limit <n>", desc: "Max log entries (list, default: 30)" },
        { name: "--need-total <bool>", desc: "Include total count (list)" },
        { name: "--action-type-id <s>", desc: "Filter by action type id (list)" },
        { name: "--status <s>", desc: "Filter by status (list)" },
        { name: "--trigger-type <s>", desc: "Filter by trigger type (list)" },
        { name: "--search-after <s>", desc: "Pagination cursor (list)" },
        { name: "--pretty", desc: "Pretty-print JSON output" },
        { name: "-bd, --biz-domain <s>", desc: "Override x-business-domain" },
      ],
      inheritedFlags: "--base-url, --token, --user, --help",
      examples: [
        "kweaver bkn action-log list kn-123 --limit 10",
        "kweaver bkn action-log get kn-123 log-456",
      ],
    }));
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

// ── search ───────────────────────────────────────────────────────────────────

const KN_SEARCH_HELP = renderHelp({
  tagline: "Semantic search within a knowledge network — matches object/relation/action types (agent-retrieval API)",
  usage: "kweaver bkn search <kn-id> <query> [flags]",
  flags: [
    { name: "--max-concepts <n>", desc: "Max concepts to return (default: 10)" },
    { name: "--mode <mode>", desc: "Search mode (default: keyword_vector_retrieval)" },
    { name: "--pretty", desc: "Pretty-print JSON output" },
    { name: "-bd, --biz-domain <s>", desc: "Override x-business-domain" },
  ],
  inheritedFlags: "--base-url, --token, --user, --help",
  examples: [
    "kweaver bkn search kn-123 'customer churn'",
    "kweaver bkn search kn-123 'revenue by region' --max-concepts 20",
  ],
});

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

export async function runKnSearchCommand(args: string[]): Promise<number> {
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

// ── relation-type-paths ───────────────────────────────────────────────────────

export async function runKnRelationTypePathsCommand(args: string[]): Promise<number> {
  let parsed;
  try {
    parsed = parseOntologyQueryFlags(args);
  } catch (error) {
    if (error instanceof Error && error.message === "help") {
      console.log(renderHelp({
        tagline: "Query relation type paths between object types.",
        usage: "kweaver bkn relation-type-paths <kn-id> '<json>' [flags]",
        flags: [
          { name: "--pretty", desc: "Pretty-print JSON output" },
          { name: "-bd, --biz-domain <s>", desc: "Override x-business-domain" },
        ],
        inheritedFlags: "--base-url, --token, --user, --help",
        examples: [
          "kweaver bkn relation-type-paths kn-123 '{...}'",
        ],
      }));
      return 0;
    }
    throw error;
  }
  const [knId, body] = parsed.filteredArgs;

  if (!knId || !body) {
    console.log(renderHelp({
      tagline: "Query relation type paths between object types.",
      usage: "kweaver bkn relation-type-paths <kn-id> '<json>' [flags]",
      flags: [
        { name: "--pretty", desc: "Pretty-print JSON output" },
        { name: "-bd, --biz-domain <s>", desc: "Override x-business-domain" },
      ],
      inheritedFlags: "--base-url, --token, --user, --help",
      examples: [
        "kweaver bkn relation-type-paths kn-123 '{...}'",
      ],
    }));
    return knId && !body ? 1 : 0;
  }

  const token = await ensureValidToken();
  const result = await queryRelationTypePaths({
    baseUrl: token.baseUrl,
    accessToken: token.accessToken,
    knId,
    body,
    businessDomain: parsed.businessDomain,
  });
  console.log(formatCallOutput(result, parsed.pretty));
  return 0;
}

// ── resources ─────────────────────────────────────────────────────────────────

export async function runKnResourcesCommand(args: string[]): Promise<number> {
  let parsed;
  try {
    parsed = parseOntologyQueryFlags(args);
  } catch (error) {
    if (error instanceof Error && error.message === "help") {
      console.log(renderHelp({
        tagline: "List available resources.",
        usage: "kweaver bkn resources [flags]",
        flags: [
          { name: "--pretty", desc: "Pretty-print JSON output" },
          { name: "-bd, --biz-domain <s>", desc: "Override x-business-domain" },
        ],
        inheritedFlags: "--base-url, --token, --user, --help",
        examples: [
          "kweaver bkn resources --pretty",
        ],
      }));
      return 0;
    }
    throw error;
  }

  const token = await ensureValidToken();
  const result = await listBknResources({
    baseUrl: token.baseUrl,
    accessToken: token.accessToken,
    businessDomain: parsed.businessDomain,
  });
  console.log(formatCallOutput(result, parsed.pretty));
  return 0;
}
