import { ensureValidToken, formatHttpError, with401RefreshRetry } from "../auth/oauth.js";
import { runAgentChatCommand } from "./agent-chat.js";
import {
  listAgents, getAgent, getAgentByKey,
  createAgent, updateAgent, deleteAgent,
  publishAgent, unpublishAgent,
} from "../api/agent-list.js";
import { listConversations, listMessages, getTracesByConversation } from "../api/conversations.js";
import { formatCallOutput } from "./call.js";
import { resolveBusinessDomain } from "../config/store.js";

export interface AgentListOptions {
  name: string;
  offset: number;
  limit: number;
  category_id: string;
  custom_space_id: string;
  is_to_square: number;
  businessDomain: string;
  pretty: boolean;
  verbose: boolean;
}

interface SimpleListItem {
  name: string;
  id: string;
  description: string;
}

function readStringField(
  value: Record<string, unknown>,
  ...keys: string[]
): string {
  for (const key of keys) {
    const candidate = value[key];
    if (typeof candidate === "string") {
      return candidate;
    }
  }
  return "";
}

function extractListEntries(data: unknown): Record<string, unknown>[] {
  if (Array.isArray(data)) {
    return data.filter(
      (entry): entry is Record<string, unknown> =>
        typeof entry === "object" && entry !== null && !Array.isArray(entry)
    );
  }

  if (typeof data !== "object" || data === null) {
    return [];
  }

  const record = data as Record<string, unknown>;
  for (const key of ["entries", "items", "list", "records", "data"]) {
    const candidate = record[key];
    if (Array.isArray(candidate)) {
      return candidate.filter(
        (entry): entry is Record<string, unknown> =>
          typeof entry === "object" && entry !== null && !Array.isArray(entry)
      );
    }
  }

  if (typeof record.data === "object" && record.data !== null) {
    return extractListEntries(record.data);
  }

  return [];
}

export function formatSimpleAgentList(text: string, pretty: boolean): string {
  const parsed = JSON.parse(text) as unknown;
  const entries = extractListEntries(parsed);
  const simplified: SimpleListItem[] = entries.map((entry) => ({
    name: readStringField(entry, "name", "agent_name", "title"),
    id: readStringField(entry, "id", "agent_id", "key"),
    description: readStringField(entry, "description", "comment", "summary", "intro"),
  }));
  return JSON.stringify(simplified, null, pretty ? 2 : 0);
}

export function parseAgentListArgs(args: string[]): AgentListOptions {
  let name = "";
  let offset = 0;
  let limit = 50;
  let category_id = "";
  let custom_space_id = "";
  let is_to_square = 1;
  let businessDomain = "";
  let pretty = true;
  let verbose = false;

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];

    if (arg === "--help" || arg === "-h") {
      throw new Error("help");
    }

    if (arg === "--name") {
      name = args[i + 1] ?? "";
      i += 1;
      continue;
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

    if (arg === "--category-id") {
      category_id = args[i + 1] ?? "";
      i += 1;
      continue;
    }

    if (arg === "--custom-space-id") {
      custom_space_id = args[i + 1] ?? "";
      i += 1;
      continue;
    }

    if (arg === "--is-to-square") {
      is_to_square = parseInt(args[i + 1] ?? "1", 10);
      if (Number.isNaN(is_to_square)) is_to_square = 1;
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

    if (arg === "--verbose" || arg === "-v") {
      verbose = true;
      continue;
    }

    if (arg === "--simple") {
      continue;
    }

    throw new Error(`Unsupported agent list argument: ${arg}`);
  }

  if (!businessDomain) businessDomain = resolveBusinessDomain();
  return {
    name,
    offset,
    limit,
    category_id,
    custom_space_id,
    is_to_square,
    businessDomain,
    pretty,
    verbose,
  };
}

export interface AgentSessionsOptions {
  agentId: string;
  businessDomain: string;
  limit?: number;
  pretty: boolean;
}

export function parseAgentSessionsArgs(args: string[]): AgentSessionsOptions {
  const agentId = args[0];
  if (!agentId || agentId.startsWith("-")) {
    throw new Error("Missing agent_id");
  }

  let businessDomain = "";
  let limit: number | undefined;
  let pretty = true;

  for (let i = 1; i < args.length; i += 1) {
    const arg = args[i];

    if (arg === "--help" || arg === "-h") {
      throw new Error("help");
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
      limit = parseInt(args[i + 1] ?? "0", 10);
      if (Number.isNaN(limit) || limit < 1) limit = undefined;
      i += 1;
      continue;
    }

    if (arg === "--pretty") {
      pretty = true;
      continue;
    }

    if (arg === "--compact") {
      pretty = false;
      continue;
    }

    throw new Error(`Unsupported agent sessions argument: ${arg}`);
  }

  if (!businessDomain) businessDomain = resolveBusinessDomain();
  return { agentId, businessDomain, limit, pretty };
}

export interface AgentHistoryOptions {
  conversationId: string;
  businessDomain: string;
  limit?: number;
  pretty: boolean;
}

export function parseAgentHistoryArgs(args: string[]): AgentHistoryOptions {
  const conversationId = args[0];
  if (!conversationId || conversationId.startsWith("-")) {
    throw new Error("Missing conversation_id");
  }

  let businessDomain = "";
  let limit: number | undefined;
  let pretty = true;

  for (let i = 1; i < args.length; i += 1) {
    const arg = args[i];

    if (arg === "--help" || arg === "-h") {
      throw new Error("help");
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
      limit = parseInt(args[i + 1] ?? "0", 10);
      if (Number.isNaN(limit) || limit < 1) limit = undefined;
      i += 1;
      continue;
    }

    if (arg === "--pretty") {
      pretty = true;
      continue;
    }

    if (arg === "--compact") {
      pretty = false;
      continue;
    }

    throw new Error(`Unsupported agent history argument: ${arg}`);
  }

  if (!businessDomain) businessDomain = resolveBusinessDomain();
  return { conversationId, businessDomain, limit, pretty };
}

export interface AgentTraceOptions {
  conversationId: string;
  pretty: boolean;
}

export function parseAgentTraceArgs(args: string[]): AgentTraceOptions {
  const conversationId = args[0];
  if (!conversationId || conversationId.startsWith("-")) {
    throw new Error("Missing conversation_id");
  }

  let pretty = true;

  for (let i = 1; i < args.length; i += 1) {
    const arg = args[i];

    if (arg === "--help" || arg === "-h") {
      throw new Error("help");
    }

    if (arg === "--pretty") {
      pretty = true;
      continue;
    }

    if (arg === "--compact") {
      pretty = false;
      continue;
    }

    throw new Error(`Unsupported agent trace argument: ${arg}`);
  }

  return { conversationId, pretty };
}

export async function runAgentCommand(args: string[]): Promise<number> {
  const [subcommand, ...rest] = args;

  if (!subcommand || subcommand === "--help" || subcommand === "-h") {
    console.log(`kweaver agent

Subcommands:
  list [options]                     List published agents
  get <agent_id> [--verbose]         Get agent details
  get-by-key <key>                   Get agent by key
  create --name <n> --profile <p>    Create a new agent
       [--key <key>] [--product-key <pk>] [--system-prompt <sp>]
       [--llm-id <id>] [--llm-max-tokens <n>]
  update <agent_id> --name <n> ...   Update an existing agent
  delete <agent_id> [-y]             Delete an agent
  publish <agent_id>                 Publish an agent
  unpublish <agent_id>               Unpublish an agent
  chat <agent_id>                    Start interactive chat with an agent
  chat <agent_id> -m "message"       Send a single message (non-interactive)
  sessions <agent_id>                List all conversations for an agent
  history <conversation_id>          Show message history for a conversation
  trace <conversation_id>            Get trace data for a conversation`);
    return Promise.resolve(0);
  }

  const dispatch = async (): Promise<number> => {
    if (subcommand === "chat") return runAgentChatCommand(rest);
    if (subcommand === "get") return runAgentGetCommand(rest);
    if (subcommand === "list") return runAgentListCommand(rest);
    if (subcommand === "sessions") return runAgentSessionsCommand(rest);
    if (subcommand === "history") return runAgentHistoryCommand(rest);
    if (subcommand === "trace") return runAgentTraceCommand(rest);
    if (subcommand === "get-by-key") return runAgentGetByKeyCommand(rest);
    if (subcommand === "create") return runAgentCreateCommand(rest);
    if (subcommand === "update") return runAgentUpdateCommand(rest);
    if (subcommand === "delete") return runAgentDeleteCommand(rest);
    if (subcommand === "publish") return runAgentPublishCommand(rest);
    if (subcommand === "unpublish") return runAgentUnpublishCommand(rest);
    return -1;
  };

  // Show subcommand-specific help inline (no retry needed)
  if (subcommand === "chat") {
    if (rest.length === 1 && (rest[0] === "--help" || rest[0] === "-h")) {
      console.log(`kweaver agent chat <agent_id> [-m "message"] [options]

Interactive mode (default when -m is omitted):
  kweaver agent chat <agent_id>
  Type your message and press Enter. Type 'exit', 'quit', or 'q' to quit.

Non-interactive mode:
  kweaver agent chat <agent_id> -m "your message"
  kweaver agent chat <agent_id> -m "continue" --conversation-id <id>

Options:
  -m, --message <text>       Single message (non-interactive)
  --conversation-id <id>     Continue existing conversation
  -cid <id>                  Short alias for --conversation-id
  --session-id <id>          Alias for --conversation-id
  -conversation_id <id>      Compatibility alias for reference examples
  --version <value>          Agent version used to resolve the agent key (default: v0)
  --stream                   Enable streaming (default in interactive)
  --no-stream                Disable streaming (default with -m)
  --verbose, -v              Print request details to stderr
  -bd, --biz-domain <value>  Override x-business-domain (default: bd_public)`);
      return Promise.resolve(0);
    }
    return runAgentChatCommand(rest);
  }

  if (subcommand === "get") {
    if (rest.length === 1 && (rest[0] === "--help" || rest[0] === "-h")) {
      console.log(`kweaver agent get <agent_id> [options]

Get agent details from the agent-factory API.

Options:
  --verbose, -v             Show full JSON response
  -bd, --biz-domain <value>  Business domain (default: bd_public)
  --pretty                   Pretty-print JSON output (default)`);
      return 0;
    }
  }

  if (subcommand === "list") {
    if (rest.length === 1 && (rest[0] === "--help" || rest[0] === "-h")) {
      console.log(`kweaver agent list [options]

List published agents from the agent-factory API.

Options:
  --name <text>             Filter by name
  --offset <n>              Pagination offset (default: 0)
  --limit <n>               Max items to return (default: 50)
  --category-id <id>        Filter by category
  --custom-space-id <id>    Filter by custom space
  --is-to-square <0|1>      Is to square (default: 1)
  --verbose, -v             Show full JSON response
  -bd, --biz-domain <value>  Business domain (default: bd_public)
  --pretty                  Pretty-print JSON output (applies to both modes)`);
      return 0;
    }
  }

  if (subcommand === "sessions") {
    if (rest.length === 1 && (rest[0] === "--help" || rest[0] === "-h")) {
      console.log(`kweaver agent sessions <agent_id> [options]

List all conversations for an agent.

Options:
  --limit <n>              Max conversations to return
  -bd, --biz-domain <value> Business domain (default: bd_public)
  --pretty                  Pretty-print JSON output (default)`);
      return 0;
    }
  }

  if (subcommand === "history") {
    if (rest.length === 1 && (rest[0] === "--help" || rest[0] === "-h")) {
      console.log(`kweaver agent history <conversation_id> [options]

Show message history for a conversation.

Options:
  --limit <n>              Max messages to return
  -bd, --biz-domain <value> Business domain (default: bd_public)
  --pretty                  Pretty-print JSON output (default)`);
      return 0;
    }
  }

  if (subcommand === "trace") {
    if (rest.length === 1 && (rest[0] === "--help" || rest[0] === "-h")) {
      console.log(`kweaver agent trace <conversation_id> [options]

Get trace data for a conversation.

Options:
  --pretty                  Pretty-print JSON output (default)
  --compact                 Compact JSON output`);
      return 0;
    }
  }

  try {
    return await with401RefreshRetry(async () => {
      const code = await dispatch();
      if (code === -1) {
        console.error(`Unknown agent subcommand: ${subcommand}`);
        return 1;
      }
      return code;
    });
  } catch (error) {
    console.error(formatHttpError(error));
    return 1;
  }
}

export interface AgentGetOptions {
  agentId: string;
  businessDomain: string;
  pretty: boolean;
  verbose: boolean;
}

export function parseAgentGetArgs(args: string[]): AgentGetOptions {
  const agentId = args[0];
  if (!agentId || agentId.startsWith("-")) {
    throw new Error("Missing agent_id. Usage: kweaver agent get <agent_id> [options]");
  }

  let businessDomain = "";
  let pretty = true;
  let verbose = false;

  for (let i = 1; i < args.length; i += 1) {
    const arg = args[i];

    if (arg === "--help" || arg === "-h") {
      throw new Error("help");
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

    if (arg === "--verbose" || arg === "-v") {
      verbose = true;
      continue;
    }

    throw new Error(`Unsupported agent get argument: ${arg}`);
  }

  if (!businessDomain) businessDomain = resolveBusinessDomain();
  return { agentId, businessDomain, pretty, verbose };
}

function formatSimpleAgentGet(text: string, pretty: boolean): string {
  const parsed = JSON.parse(text) as Record<string, unknown>;
  const config = (parsed.config as Record<string, unknown>) ?? {};
  const ds = (config.data_source as Record<string, unknown>) ?? {};
  const kg = (ds.kg as Array<Record<string, unknown>>) ?? [];
  const knIds = (parsed.kn_ids as string[]) ?? kg.map((k) => String(k.kg_id ?? "")).filter(Boolean);
  const simplified = {
    id: parsed.id,
    name: parsed.name,
    description: parsed.profile ?? parsed.description ?? "",
    status: parsed.status,
    kn_ids: knIds,
  };
  return JSON.stringify(simplified, null, pretty ? 2 : 0);
}

async function runAgentGetCommand(args: string[]): Promise<number> {
  let options: AgentGetOptions;
  try {
    options = parseAgentGetArgs(args);
  } catch (error) {
    if (error instanceof Error && error.message === "help") {
      console.log(`kweaver agent get <agent_id> [options]

Get agent details from the agent-factory API.

Options:
  --verbose, -v             Show full JSON response
  -bd, --biz-domain <value>  Business domain (default: bd_public)
  --pretty                   Pretty-print JSON output (default)`);
      return 0;
    }
    console.error(formatHttpError(error));
    return 1;
  }

  try {
    const token = await ensureValidToken();
    const body = await getAgent({
      baseUrl: token.baseUrl,
      accessToken: token.accessToken,
      agentId: options.agentId,
      businessDomain: options.businessDomain,
    });

    if (body) {
      console.log(
        options.verbose ? formatCallOutput(body, options.pretty) : formatSimpleAgentGet(body, options.pretty)
      );
    }
    return 0;
  } catch (error) {
    console.error(formatHttpError(error));
    return 1;
  }
}

async function runAgentListCommand(args: string[]): Promise<number> {
  let options: AgentListOptions;
  try {
    options = parseAgentListArgs(args);
  } catch (error) {
    if (error instanceof Error && error.message === "help") {
      console.log(`kweaver agent list [options]

List published agents from the agent-factory API.

Options:
  --name <text>             Filter by name
  --offset <n>              Pagination offset (default: 0)
  --limit <n>               Max items to return (default: 50)
  --category-id <id>        Filter by category
  --custom-space-id <id>    Filter by custom space
  --is-to-square <0|1>      Is to square (default: 1)
  --verbose, -v             Show full JSON response
  -bd, --biz-domain <value>  Business domain (default: bd_public)
  --pretty                  Pretty-print JSON output (applies to both modes)`);
      return 0;
    }
    console.error(formatHttpError(error));
    return 1;
  }

  try {
    const token = await ensureValidToken();
    const body = await listAgents({
      baseUrl: token.baseUrl,
      accessToken: token.accessToken,
      businessDomain: options.businessDomain,
      name: options.name,
      offset: options.offset,
      limit: options.limit,
      category_id: options.category_id,
      custom_space_id: options.custom_space_id,
      is_to_square: options.is_to_square,
    });

    if (body) {
      console.log(options.verbose ? formatCallOutput(body, options.pretty) : formatSimpleAgentList(body, options.pretty));
    }
    return 0;
  } catch (error) {
    console.error(formatHttpError(error));
    return 1;
  }
}

async function runAgentSessionsCommand(args: string[]): Promise<number> {
  let options: AgentSessionsOptions;
  try {
    options = parseAgentSessionsArgs(args);
  } catch (error) {
    if (error instanceof Error && error.message === "help") {
      console.log(`kweaver agent sessions <agent_id> [options]

List all conversations for an agent.

Options:
  --limit <n>              Max conversations to return
  -bd, --biz-domain <value> Business domain (default: bd_public)
  --pretty                  Pretty-print JSON output (default)`);
      return 0;
    }
    console.error(formatHttpError(error));
    return 1;
  }

  try {
    const token = await ensureValidToken();
    const body = await listConversations({
      baseUrl: token.baseUrl,
      accessToken: token.accessToken,
      agentId: options.agentId,
      businessDomain: options.businessDomain,
      limit: options.limit,
    });
    console.log(formatCallOutput(body, options.pretty));
    return 0;
  } catch (error) {
    console.error(formatHttpError(error));
    return 1;
  }
}

async function runAgentHistoryCommand(args: string[]): Promise<number> {
  let options: AgentHistoryOptions;
  try {
    options = parseAgentHistoryArgs(args);
  } catch (error) {
    if (error instanceof Error && error.message === "help") {
      console.log(`kweaver agent history <conversation_id> [options]

Show message history for a conversation.

Options:
  --limit <n>              Max messages to return
  -bd, --biz-domain <value> Business domain (default: bd_public)
  --pretty                  Pretty-print JSON output (default)`);
      return 0;
    }
    console.error(formatHttpError(error));
    return 1;
  }

  try {
    const token = await ensureValidToken();
    const body = await listMessages({
      baseUrl: token.baseUrl,
      accessToken: token.accessToken,
      conversationId: options.conversationId,
      businessDomain: options.businessDomain,
      limit: options.limit,
    });
    console.log(formatCallOutput(body, options.pretty));
    return 0;
  } catch (error) {
    console.error(formatHttpError(error));
    return 1;
  }
}

async function runAgentTraceCommand(args: string[]): Promise<number> {
  let options: AgentTraceOptions;
  try {
    options = parseAgentTraceArgs(args);
  } catch (error) {
    if (error instanceof Error && error.message === "help") {
      console.log(`kweaver agent trace <conversation_id> [options]

Get trace data for a conversation.

Options:
  --pretty                  Pretty-print JSON output (default)
  --compact                 Compact JSON output`);
      return 0;
    }
    console.error(formatHttpError(error));
    return 1;
  }

  try {
    const token = await ensureValidToken();
    const body = await getTracesByConversation({
      baseUrl: token.baseUrl,
      accessToken: token.accessToken,
      conversationId: options.conversationId,
    });
    console.log(formatCallOutput(body, options.pretty));
    return 0;
  } catch (error) {
    console.error(formatHttpError(error));
    return 1;
  }
}

// ── Get by key ───────────────────────────────────────────────────────────────

async function runAgentGetByKeyCommand(args: string[]): Promise<number> {
  const key = args[0];
  if (!key || key.startsWith("-")) {
    console.error("Usage: kweaver agent get-by-key <key>");
    return 1;
  }
  try {
    const token = await ensureValidToken();
    const body = await getAgentByKey({
      baseUrl: token.baseUrl,
      accessToken: token.accessToken,
      key,
    });
    console.log(formatCallOutput(body, true));
    return 0;
  } catch (error) {
    console.error(formatHttpError(error));
    return 1;
  }
}

// ── Create ───────────────────────────────────────────────────────────────────

async function runAgentCreateCommand(args: string[]): Promise<number> {
  let name = "";
  let profile = "";
  let key = "";
  let productKey = "DIP";
  let systemPrompt = "";
  let llmId = "";
  let llmMaxTokens = 4096;
  let businessDomain = "";

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === "--help" || arg === "-h") {
      console.log(`kweaver agent create --name <name> --profile <profile> [options]

Create a new agent.

Required:
  --name <text>            Agent name (max 50)
  --profile <text>         Agent description (max 500)

Optional:
  --key <text>             Agent unique key (auto-generated if omitted)
  --product-key <text>     Product key: DIP, AnyShare, ChatBI (default: DIP)
  --system-prompt <text>   System prompt
  --llm-id <id>            LLM model ID (required for public API)
  --llm-max-tokens <n>     LLM max tokens (default: 4096)
  -bd, --biz-domain <val>  Business domain (default: bd_public)`);
      return 0;
    }
    if (arg === "--name") { name = args[++i] ?? ""; continue; }
    if (arg === "--profile") { profile = args[++i] ?? ""; continue; }
    if (arg === "--key") { key = args[++i] ?? ""; continue; }
    if (arg === "--product-key") { productKey = args[++i] ?? "DIP"; continue; }
    if (arg === "--system-prompt") { systemPrompt = args[++i] ?? ""; continue; }
    if (arg === "--llm-id") { llmId = args[++i] ?? ""; continue; }
    if (arg === "--llm-max-tokens") { llmMaxTokens = parseInt(args[++i] ?? "4096", 10); continue; }
    if (arg === "-bd" || arg === "--biz-domain") { businessDomain = args[++i] ?? "bd_public"; continue; }
  }

  if (!businessDomain) businessDomain = resolveBusinessDomain();

  if (!name) { console.error("--name is required"); return 1; }
  if (!profile) { console.error("--profile is required"); return 1; }

  const config: Record<string, unknown> = {
    input: { fields: [{ name: "user_input", type: "string", desc: "" }] },
    output: { default_format: "markdown" },
    system_prompt: systemPrompt,
  };
  if (llmId) {
    config.llms = [{ is_default: true, llm_config: { id: llmId, name: llmId, max_tokens: llmMaxTokens } }];
  }

  const payload: Record<string, unknown> = {
    name,
    profile,
    avatar_type: 1,
    avatar: "icon-dip-agent-default",
    product_key: productKey,
    config,
  };
  if (key) payload.key = key;

  try {
    const token = await ensureValidToken();
    const body = await createAgent({
      baseUrl: token.baseUrl,
      accessToken: token.accessToken,
      businessDomain,
      body: JSON.stringify(payload),
    });
    console.log(body);
    return 0;
  } catch (error) {
    console.error(formatHttpError(error));
    return 1;
  }
}

// ── Update ───────────────────────────────────────────────────────────────────

async function runAgentUpdateCommand(args: string[]): Promise<number> {
  const agentId = args[0];
  if (!agentId || agentId.startsWith("-")) {
    console.error("Usage: kweaver agent update <agent_id> [--name <n>] [--profile <p>] [--system-prompt <sp>]");
    return 1;
  }

  try {
    const token = await ensureValidToken();
    const currentRaw = await getAgent({
      baseUrl: token.baseUrl,
      accessToken: token.accessToken,
      agentId,
    });
    const current = JSON.parse(currentRaw) as Record<string, unknown>;

    for (let i = 1; i < args.length; i += 1) {
      const arg = args[i];
      if (arg === "--name") { current.name = args[++i] ?? current.name; continue; }
      if (arg === "--profile") { current.profile = args[++i] ?? current.profile; continue; }
      if (arg === "--system-prompt") {
        const config = (current.config ?? {}) as Record<string, unknown>;
        config.system_prompt = args[++i] ?? "";
        current.config = config;
        continue;
      }
    }

    const body = await updateAgent({
      baseUrl: token.baseUrl,
      accessToken: token.accessToken,
      agentId,
      body: JSON.stringify({
        name: current.name,
        profile: current.profile,
        avatar_type: current.avatar_type,
        avatar: current.avatar,
        product_key: current.product_key,
        config: current.config,
      }),
    });
    if (body) console.log(body);
    else console.log("Updated.");
    return 0;
  } catch (error) {
    console.error(formatHttpError(error));
    return 1;
  }
}

// ── Delete ───────────────────────────────────────────────────────────────────

async function runAgentDeleteCommand(args: string[]): Promise<number> {
  const agentId = args[0];
  if (!agentId || agentId.startsWith("-")) {
    console.error("Usage: kweaver agent delete <agent_id> [-y]");
    return 1;
  }

  const autoConfirm = args.includes("-y") || args.includes("--yes");
  if (!autoConfirm) {
    process.stdout.write(`Delete agent ${agentId}? [y/N] `);
    const answer = await new Promise<string>((resolve) => {
      process.stdin.setEncoding("utf8");
      process.stdin.once("data", (data) => resolve(String(data).trim().toLowerCase()));
    });
    if (answer !== "y" && answer !== "yes") {
      console.log("Cancelled.");
      return 0;
    }
  }

  try {
    const token = await ensureValidToken();
    await deleteAgent({
      baseUrl: token.baseUrl,
      accessToken: token.accessToken,
      agentId,
    });
    console.log(`Deleted agent ${agentId}.`);
    return 0;
  } catch (error) {
    console.error(formatHttpError(error));
    return 1;
  }
}

// ── Publish ──────────────────────────────────────────────────────────────────

async function runAgentPublishCommand(args: string[]): Promise<number> {
  const agentId = args[0];
  if (!agentId || agentId.startsWith("-")) {
    console.error("Usage: kweaver agent publish <agent_id>");
    return 1;
  }

  try {
    const token = await ensureValidToken();
    const body = await publishAgent({
      baseUrl: token.baseUrl,
      accessToken: token.accessToken,
      agentId,
      body: JSON.stringify({ agent_id: agentId }),
    });
    console.log(body);
    return 0;
  } catch (error) {
    console.error(formatHttpError(error));
    return 1;
  }
}

// ── Unpublish ────────────────────────────────────────────────────────────────

async function runAgentUnpublishCommand(args: string[]): Promise<number> {
  const agentId = args[0];
  if (!agentId || agentId.startsWith("-")) {
    console.error("Usage: kweaver agent unpublish <agent_id>");
    return 1;
  }

  try {
    const token = await ensureValidToken();
    await unpublishAgent({
      baseUrl: token.baseUrl,
      accessToken: token.accessToken,
      agentId,
    });
    console.log(`Unpublished agent ${agentId}.`);
    return 0;
  } catch (error) {
    console.error(formatHttpError(error));
    return 1;
  }
}
