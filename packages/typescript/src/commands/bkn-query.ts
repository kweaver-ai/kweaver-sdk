import { ensureValidToken, formatHttpError } from "../auth/oauth.js";
import {
  subgraph,
  actionExecutionGet,
  actionLogsList,
  actionLogGet,
  actionLogCancel,
} from "../api/ontology-query.js";
import { semanticSearch } from "../api/semantic-search.js";
import { formatCallOutput } from "./call.js";
import { resolveBusinessDomain } from "../config/store.js";
import { parseOntologyQueryFlags } from "./bkn-utils.js";

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

// ── action-log ───────────────────────────────────────────────────────────────

export async function runKnActionLogCommand(args: string[]): Promise<number> {
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

// ── search ───────────────────────────────────────────────────────────────────

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
