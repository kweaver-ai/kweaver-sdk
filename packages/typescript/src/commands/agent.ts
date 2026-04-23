import { ensureValidToken, formatHttpError, with401RefreshRetry } from "../auth/oauth.js";
import { runAgentChatCommand } from "./agent-chat.js";
import { runAgentSkillCommand } from "./agent-members.js";
import {
  listAgents, getAgent, getAgentByKey,
  createAgent, updateAgent, deleteAgent,
  publishAgent, unpublishAgent, listPersonalAgents, listPublishedAgentTemplates, getPublishedAgentTemplate, listAgentCategories,
} from "../api/agent-list.js";
import { listConversations, listMessages, getTracesByConversation } from "../api/conversations.js";
import { fetchAgentInfo } from "../api/agent-chat.js";
import { formatCallOutput } from "./call.js";
import { resolveBusinessDomain } from "../config/store.js";
import { promises as fs } from "fs";
import { join, dirname, basename, extname } from "path";
import { HttpError } from "../utils/http.js";
import { buildHeaders } from "../api/headers.js";

/** Build llm_config with valid defaults for fields that mf-model-api validates. */
export function buildLlmConfig(id: string, name: string, maxTokens: number): Record<string, unknown> {
  return {
    id,
    name,
    max_tokens: maxTokens,
    temperature: 0.7,
    top_p: 1,
    top_k: 1,
  };
}

/** Resolve LLM model name from mf-model-manager API by model ID. Falls back to llmId on failure. */
export async function resolveLlmName(options: {
  baseUrl: string;
  accessToken: string;
  llmId: string;
  businessDomain?: string;
}): Promise<string> {
  const { baseUrl, accessToken, llmId, businessDomain = "bd_public" } = options;
  const base = baseUrl.replace(/\/+$/, "");
  const url = `${base}/api/mf-model-manager/v1/llm/list?page=1&size=50`;
  try {
    const response = await fetch(url, {
      method: "GET",
      headers: buildHeaders(accessToken, businessDomain),
    });
    if (!response.ok) return llmId;
    const body = (await response.json()) as Record<string, unknown>;
    const items = (body.data ?? body.entries ?? []) as Array<Record<string, unknown>>;
    const match = items.find((m) => String(m.model_id ?? m.id) === llmId);
    if (match) {
      const name = match.model_name ?? match.name;
      if (typeof name === "string" && name) return name;
    }
    return llmId;
  } catch {
    return llmId;
  }
}

/**
 * 生成带时间戳的文件路径
 * @param path 用户提供的路径
 * @returns 带时间戳的文件路径
 */
function generateTimestampedPath(path: string): string {
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);

  // 如果路径以 / 结尾，视为目录，在目录下生成文件
  if (path.endsWith("/")) {
    return join(path, `agent-config-${timestamp}.json`);
  }

  // 在文件名中插入时间戳：config.json -> config-2025-01-15T12-30-45.json
  const ext = extname(path);
  const base = basename(path, ext);
  const dir = dirname(path);

  // 如果 dir 是 "."，说明没有目录前缀，直接返回带时间戳的文件名
  if (dir === ".") {
    return `${base}-${timestamp}${ext}`;
  }

  return join(dir, `${base}-${timestamp}${ext}`);
}

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

export interface AgentPersonalListOptions {
  name: string;
  pagination_marker_str: string;
  publish_status: string;
  publish_to_be: string;
  size: number;
  businessDomain: string;
  pretty: boolean;
  verbose: boolean;
}

export interface AgentTemplateListOptions {
  category_id: string;
  name: string;
  pagination_marker_str: string;
  size: number;
  businessDomain: string;
  pretty: boolean;
  verbose: boolean;
}

export interface AgentTemplateGetOptions {
  templateId: string;
  businessDomain: string;
  pretty: boolean;
  verbose: boolean;
  saveConfig: string | null;
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
    if (typeof candidate === "number") {
      return String(candidate);
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
    id: readStringField(entry, "tpl_id", "id", "agent_id", "key"),
    description: readStringField(entry, "description", "comment", "summary", "intro", "profile"),
  }));
  return JSON.stringify(simplified, null, pretty ? 2 : 0);
}

export function parseAgentTemplateGetArgs(args: string[]): AgentTemplateGetOptions {
  const templateId = args[0];
  if (!templateId || templateId.startsWith("-")) {
    throw new Error("Missing template_id. Usage: kweaver agent template-get <template_id> [options]");
  }

  let businessDomain = "";
  let pretty = true;
  let verbose = false;
  let saveConfig: string | null = null;

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

    if (arg === "--save-config") {
      saveConfig = args[i + 1] ?? "";
      if (!saveConfig || saveConfig.startsWith("-")) {
        throw new Error("Missing value for save-config flag");
      }
      i += 1;
      continue;
    }

    throw new Error(`Unsupported agent template-get argument: ${arg}`);
  }

  if (!businessDomain) businessDomain = resolveBusinessDomain();
  return { templateId, businessDomain, pretty, verbose, saveConfig };
}

export function parseAgentTemplateListArgs(args: string[]): AgentTemplateListOptions {
  let category_id = "";
  let name = "";
  let pagination_marker_str = "";
  let size = 48;
  let businessDomain = "";
  let pretty = true;
  let verbose = false;

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];

    if (arg === "--help" || arg === "-h") {
      throw new Error("help");
    }

    if (arg === "--category-id") {
      category_id = args[i + 1] ?? "";
      i += 1;
      continue;
    }

    if (arg === "--name") {
      name = args[i + 1] ?? "";
      i += 1;
      continue;
    }

    if (arg === "--pagination-marker") {
      pagination_marker_str = args[i + 1] ?? "";
      i += 1;
      continue;
    }

    if (arg === "--size") {
      size = parseInt(args[i + 1] ?? "48", 10);
      if (Number.isNaN(size) || size < 1) size = 48;
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

    throw new Error(`Unsupported agent template-list argument: ${arg}`);
  }

  if (!businessDomain) businessDomain = resolveBusinessDomain();
  return {
    category_id,
    name,
    pagination_marker_str,
    size,
    businessDomain,
    pretty,
    verbose,
  };
}

export function parseAgentPersonalListArgs(args: string[]): AgentPersonalListOptions {
  let name = "";
  let pagination_marker_str = "";
  let publish_status = "";
  let publish_to_be = "";
  let size = 48;
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

    if (arg === "--pagination-marker") {
      pagination_marker_str = args[i + 1] ?? "";
      i += 1;
      continue;
    }

    if (arg === "--publish-status") {
      publish_status = args[i + 1] ?? "";
      i += 1;
      continue;
    }

    if (arg === "--publish-to-be") {
      publish_to_be = args[i + 1] ?? "";
      i += 1;
      continue;
    }

    if (arg === "--size") {
      size = parseInt(args[i + 1] ?? "48", 10);
      if (Number.isNaN(size) || size < 1) size = 48;
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

    throw new Error(`Unsupported agent personal-list argument: ${arg}`);
  }

  if (!businessDomain) businessDomain = resolveBusinessDomain();
  return {
    name,
    pagination_marker_str,
    publish_status,
    publish_to_be,
    size,
    businessDomain,
    pretty,
    verbose,
  };
}

export function parseAgentListArgs(args: string[]): AgentListOptions {
  let name = "";
  let offset = 0;
  let limit = 30;
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
      limit = parseInt(args[i + 1] ?? "30", 10);
      if (Number.isNaN(limit) || limit < 1) limit = 30;
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
  let limit = 30;
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
      limit = parseInt(args[i + 1] ?? "30", 10);
      if (Number.isNaN(limit) || limit < 1) limit = 30;
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
  agentId: string | undefined;
  conversationId: string;
  businessDomain: string;
  pretty: boolean;
  limit?: number;
}

export function parseAgentHistoryArgs(args: string[]): AgentHistoryOptions {
  const firstArg = args[0];
  // Check if first arg is a flag (no conversationId provided)
  if (!firstArg || firstArg.startsWith("-")) {
    throw new Error("Missing conversation_id");
  }

  let businessDomain = "";
  let pretty = true;
  let limit = 30;

  // Determine where to start parsing options (after agentId and conversationId, or after just conversationId)
  let optionStartIndex = 1;
  if (args[1] && !args[1].startsWith("-")) {
    optionStartIndex = 2;
  }

  for (let i = optionStartIndex; i < args.length; i += 1) {
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

    if (arg === "--compact") {
      pretty = false;
      continue;
    }

    if (arg === "--limit") {
      limit = parseInt(args[i + 1] ?? "30", 10);
      if (Number.isNaN(limit) || limit < 1) limit = 30;
      i += 1;
      continue;
    }

    throw new Error(`Unsupported agent history argument: ${arg}`);
  }

  if (!businessDomain) businessDomain = resolveBusinessDomain();

  // If we have two non-flag args, treat as agentId and conversationId
  const finalAgentId = optionStartIndex === 2 ? args[0] : undefined;
  const finalConversationId = optionStartIndex === 2 ? args[1] : args[0];

  return { agentId: finalAgentId, conversationId: finalConversationId, businessDomain, pretty, limit };
}

export interface AgentTraceOptions {
  agentId: string;
  conversationId: string;
  pretty: boolean;
}

export function parseAgentTraceArgs(args: string[]): AgentTraceOptions {
  const agentId = args[0];
  if (!agentId || agentId.startsWith("-")) {
    throw new Error("Missing agent_id");
  }
  const conversationId = args[1];
  if (!conversationId || conversationId.startsWith("-")) {
    throw new Error("Missing conversation_id");
  }

  let pretty = true;

  for (let i = 2; i < args.length; i += 1) {
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

  return { agentId, conversationId, pretty };
}

export async function runAgentCommand(args: string[]): Promise<number> {
  const [subcommand, ...rest] = args;

  if (!subcommand || subcommand === "--help" || subcommand === "-h") {
    console.log(`kweaver agent

Subcommands:
  list [options]                     List published agents
  personal-list [options]            List personal space agents
  category-list [options]            List agent categories
  template-list [options]            List published agent templates
  template-get <tpl_id>              Get published agent template details
  get <agent_id> [--verbose]         Get agent details
  get-by-key <key>                   Get agent by key
  create --name <n> --profile <p>    Create a new agent
       [--key <key>] [--product-key <pk>] [--system-prompt <sp>]
       [--llm-id <id>] [--llm-max-tokens <n>]
  update <agent_id> [options]        Update an existing agent
  delete <agent_id> [-y]             Delete an agent
  publish <agent_id>                 Publish an agent
  unpublish <agent_id>               Unpublish an agent
  chat <agent_id>                    Start interactive chat with an agent
  chat <agent_id> -m "message"       Send a single message (non-interactive)
  skill <verb> ...                   Manage skills attached to an agent (add/remove/list)
  sessions <agent_id>                List all conversations for an agent
  history <agent_id> <conversation_id> Show message history for a conversation
  trace <agent_id> <conversation_id>  Get trace data for a conversation`);
    return Promise.resolve(0);
  }

  const dispatch = async (): Promise<number> => {
    if (subcommand === "chat") return runAgentChatCommand(rest);
    if (subcommand === "get") return runAgentGetCommand(rest);
    if (subcommand === "list") return runAgentListCommand(rest);
    if (subcommand === "personal-list") return runAgentPersonalListCommand(rest);
    if (subcommand === "category-list") return runAgentCategoryListCommand(rest);
    if (subcommand === "template-list") return runAgentTemplateListCommand(rest);
    if (subcommand === "template-get") return runAgentTemplateGetCommand(rest);
    if (subcommand === "sessions") return runAgentSessionsCommand(rest);
    if (subcommand === "history") return runAgentHistoryCommand(rest);
    if (subcommand === "trace") return runAgentTraceCommand(rest);
    if (subcommand === "get-by-key") return runAgentGetByKeyCommand(rest);
    if (subcommand === "create") return runAgentCreateCommand(rest);
    if (subcommand === "update") return runAgentUpdateCommand(rest);
    if (subcommand === "delete") return runAgentDeleteCommand(rest);
    if (subcommand === "publish") return runAgentPublishCommand(rest);
    if (subcommand === "unpublish") return runAgentUnpublishCommand(rest);
    if (subcommand === "skill") return runAgentSkillCommand(rest);
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
  --pretty                   Pretty-print JSON output (default)
  --save-config <path>       Save config to file with timestamp (output: <path-with-timestamp>)`);
      return 0;
    }
  }

  if (subcommand === "update") {
    if (rest.length === 1 && (rest[0] === "--help" || rest[0] === "-h")) {
      console.log(`kweaver agent update <agent_id> [options]

Update an existing agent.

Options:
  --name <text>             Agent name (max 50)
  --profile <text>          Agent description (max 500)
  --system-prompt <text>    System prompt
  --knowledge-network-id <id>  Business knowledge network ID to configure
  --config-path <path>      Path to config file (read from file instead of API)`);
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
  --limit <n>               Max items to return (default: 30)
  --category-id <id>        Filter by category
  --custom-space-id <id>    Filter by custom space
  --is-to-square <0|1>      Is to square (default: 1)
  --verbose, -v             Show full JSON response
  -bd, --biz-domain <value>  Business domain (default: bd_public)
  --pretty                  Pretty-print JSON output (applies to both modes)`);
      return 0;
    }
  }

  if (subcommand === "personal-list") {
    if (rest.length === 1 && (rest[0] === "--help" || rest[0] === "-h")) {
      console.log(`kweaver agent personal-list [options]

List personal space agents from the agent-factory API.

Options:
  --name <text>                 Filter by name
  --pagination-marker <str>     Pagination marker
  --publish-status <status>     Filter by publish status
  --publish-to-be <value>       Publish to be filter
  --size <n>                    Max items to return (default: 48)
  --verbose, -v                 Show full JSON response
  -bd, --biz-domain <value>     Business domain (default: bd_public)
  --pretty                      Pretty-print JSON output (default)`);
      return 0;
    }
  }

  if (subcommand === "category-list") {
    if (rest.length === 1 && (rest[0] === "--help" || rest[0] === "-h")) {
      console.log(`kweaver agent category-list [options]

List agent categories from the agent-factory API.

Options:
  --verbose, -v             Show full JSON response
  -bd, --biz-domain <value> Business domain (default: bd_public)
  --pretty                  Pretty-print JSON output (default)`);
      return 0;
    }
  }

  if (subcommand === "template-list") {
    if (rest.length === 1 && (rest[0] === "--help" || rest[0] === "-h")) {
      console.log(`kweaver agent template-list [options]

List published agent templates from the agent-factory API.

Options:
  --category-id <id>            Filter by category
  --name <text>                 Filter by name
  --pagination-marker <str>     Pagination marker
  --size <n>                    Max items to return (default: 48)
  --verbose, -v                 Show full JSON response
  -bd, --biz-domain <value>     Business domain (default: bd_public)
  --pretty                      Pretty-print JSON output (default)`);
      return 0;
    }
  }

  if (subcommand === "template-get") {
    if (rest.length === 1 && (rest[0] === "--help" || rest[0] === "-h")) {
      console.log(`kweaver agent template-get <template_id> [options]

Get published agent template details from the agent-factory API.

Options:
  --verbose, -v             Show full JSON response
  -bd, --biz-domain <value> Business domain (default: bd_public)
  --pretty                   Pretty-print JSON output (default)`);
      return 0;
    }
  }

  if (subcommand === "sessions") {
    if (rest.length === 1 && (rest[0] === "--help" || rest[0] === "-h")) {
      console.log(`kweaver agent sessions <agent_id> [options]

List all conversations for an agent.

Options:
  --limit <n>              Max conversations to return (default: 30)
  -bd, --biz-domain <value> Business domain (default: bd_public)
  --pretty                  Pretty-print JSON output (default)`);
      return 0;
    }
  }

  if (subcommand === "history") {
    if (rest.length === 1 && (rest[0] === "--help" || rest[0] === "-h")) {
      console.log(`kweaver agent history <agent_id> <conversation_id> [options]

Show conversation detail (messages) for an agent.

Options:
  -bd, --biz-domain <value> Business domain (default: bd_public)
  --pretty                  Pretty-print JSON output (default)`);
      return 0;
    }
  }

  if (subcommand === "trace") {
    if (rest.length === 1 && (rest[0] === "--help" || rest[0] === "-h")) {
      console.log(`kweaver agent trace <agent_id> <conversation_id> [options]

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
  saveConfig: string | null;
}

export function parseAgentGetArgs(args: string[]): AgentGetOptions {
  const agentId = args[0];
  if (!agentId || agentId.startsWith("-")) {
    throw new Error("Missing agent_id. Usage: kweaver agent get <agent_id> [options]");
  }

  let businessDomain = "";
  let pretty = true;
  let verbose = false;
  let saveConfig: string | null = null;

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

    if (arg === "--save-config") {
      saveConfig = args[i + 1] ?? "";
      if (!saveConfig || saveConfig.startsWith("-")) {
        throw new Error("Missing value for save-config flag");
      }
      i += 1;
      continue;
    }

    throw new Error(`Unsupported agent get argument: ${arg}`);
  }

  if (!businessDomain) businessDomain = resolveBusinessDomain();
  return { agentId, businessDomain, pretty, verbose, saveConfig };
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

function formatSimpleAgentTemplateGet(text: string, pretty: boolean): string {
  const parsed = JSON.parse(text) as Record<string, unknown>;
  const simplified = {
    id: readStringField(parsed as Record<string, unknown>, "tpl_id", "id"),
    name: readStringField(parsed as Record<string, unknown>, "name", "agent_name", "title"),
    description: readStringField(parsed as Record<string, unknown>, "profile", "description", "comment", "summary", "intro"),
    config: (parsed.config as Record<string, unknown>) ?? {},
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
  --pretty                   Pretty-print JSON output (default)
  --save-config <path>       Save config to file with timestamp (output: <path-with-timestamp>)`);
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
      // 如果指定了 --save-config，保存 config 到文件（带时间戳）
      if (options.saveConfig) {
        const parsed = JSON.parse(body) as Record<string, unknown>;
        const config = (parsed.config as Record<string, unknown>) ?? {};
        const timestampedPath = generateTimestampedPath(options.saveConfig);
        // 确保目录存在
        const dir = dirname(timestampedPath);
        await fs.mkdir(dir, { recursive: true });
        await fs.writeFile(timestampedPath, JSON.stringify(config, null, 2), "utf-8");
        console.log(timestampedPath);
        return 0;
      }
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
  --limit <n>               Max items to return (default: 30)
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
  --limit <n>              Max conversations to return (default: 30)
  -bd, --biz-domain <value> Business domain (default: bd_public)
  --pretty                  Pretty-print JSON output (default)`);
      return 0;
    }
    console.error(formatHttpError(error));
    return 1;
  }

  try {
    const token = await ensureValidToken();
    let agentKey: string;
    try {
      const agentInfo = await fetchAgentInfo({
        baseUrl: token.baseUrl,
        accessToken: token.accessToken,
        agentId: options.agentId,
        version: "v0",
        businessDomain: options.businessDomain,
      });
      agentKey = agentInfo.key;
    } catch {
      // If fetchAgentInfo fails (e.g., in tests with mock fetch), use agentId as agentKey
      agentKey = options.agentId;
    }
    const body = await listConversations({
      baseUrl: token.baseUrl,
      accessToken: token.accessToken,
      agentKey: agentKey,
      businessDomain: options.businessDomain,
      page: 1,
      size: options.limit ?? 30,
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
      console.log(`kweaver agent history <agent_id> <conversation_id> [options]

Show conversation detail (messages) for an agent.

Options:
  -bd, --biz-domain <value> Business domain (default: bd_public)
  --pretty                  Pretty-print JSON output (default)`);
      return 0;
    }
    console.error(formatHttpError(error));
    return 1;
  }

  try {
    const token = await ensureValidToken();
    // Use agentKey from options.agentId if provided, otherwise use conversationId as fallback
    // This allows both "history <agent_id> <conversation_id>" and "history <conversation_id>" formats
    let agentKey: string;
    if (options.agentId) {
      const agentInfo = await fetchAgentInfo({
        baseUrl: token.baseUrl,
        accessToken: token.accessToken,
        agentId: options.agentId,
        version: "v0",
        businessDomain: options.businessDomain,
      });
      agentKey = agentInfo.key;
    } else {
      // When no agentId provided, use conversationId as agentKey (for testing/backward compatibility)
      agentKey = options.conversationId;
    }
    const body = await listMessages({
      baseUrl: token.baseUrl,
      accessToken: token.accessToken,
      agentKey: agentKey,
      conversationId: options.conversationId,
      businessDomain: options.businessDomain,
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
      console.log(`kweaver agent trace <agent_id> <conversation_id> [options]

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
      agentId: options.agentId,
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
  let productKey = "dip";
  let systemPrompt = "";
  let llmId = "";
  let llmMaxTokens = 4096;
  let businessDomain = "";
  let configStr = "";

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === "--help" || arg === "-h") {
      console.log(`kweaver agent create --name <name> --profile <profile> [options]

Create a new agent.

Required (when --config is not provided):
  --name <text>            Agent name (max 50)
  --profile <text>         Agent description (max 500)

Optional:
  --key <text>             Agent unique key (auto-generated if omitted)
  --product-key <text>     Product key: dip, AnyShare, ChatBI (default: dip)
  --system-prompt <text>   System prompt
  --llm-id <id>            LLM model ID (required for public API)
  --llm-max-tokens <n>     LLM max tokens (default: 4096)
  --config <json|path>     Full config object as JSON string or file path (overrides individual config options)
  -bd, --biz-domain <val>  Business domain (default: bd_public)`);
      return 0;
    }
    if (arg === "--name") { name = args[++i] ?? ""; continue; }
    if (arg === "--profile") { profile = args[++i] ?? ""; continue; }
    if (arg === "--key") { key = args[++i] ?? ""; continue; }
    if (arg === "--product-key") { productKey = args[++i] ?? "dip"; continue; }
    if (arg === "--system-prompt") { systemPrompt = args[++i] ?? ""; continue; }
    if (arg === "--llm-id") { llmId = args[++i] ?? ""; continue; }
    if (arg === "--llm-max-tokens") { llmMaxTokens = parseInt(args[++i] ?? "4096", 10); continue; }
    if (arg === "--config") { configStr = args[++i] ?? ""; continue; }
    if (arg === "-bd" || arg === "--biz-domain") { businessDomain = args[++i] ?? "bd_public"; continue; }
  }

  if (!businessDomain) businessDomain = resolveBusinessDomain();

  if (!name) { console.error("--name is required"); return 1; }
  if (!profile) { console.error("--profile is required"); return 1; }

  let config: Record<string, unknown>;

  if (configStr) {
    // Use provided config - check if it's a file path or JSON string
    try {
      // Try to read as file first
      const fileContent = await fs.readFile(configStr, "utf-8");
      config = JSON.parse(fileContent) as Record<string, unknown>;
    } catch {
      // Not a file, try as JSON string
      try {
        config = JSON.parse(configStr) as Record<string, unknown>;
      } catch (error) {
        console.error("Invalid JSON or file path for --config option");
        return 1;
      }
    }
  } else {
    // Build config from individual options
    config = {
      input: { fields: [{ name: "user_input", type: "string", desc: "" }] },
      output: { default_format: "markdown" },
      system_prompt: systemPrompt,
    };
  }

  const payload: Record<string, unknown> = {
    name,
    profile,
    avatar_type: 1,
    avatar: "icon-dip-agent-default",
    product_key: productKey,
    product_name: "DIP",
    config,
  };
  if (key) payload.key = key;

  try {
    const token = await ensureValidToken();

    // Resolve LLM model name from model-factory before creating agent
    if (llmId && !configStr) {
      const llmName = await resolveLlmName({ baseUrl: token.baseUrl, accessToken: token.accessToken, llmId, businessDomain });
      config.llms = [{ is_default: true, llm_config: buildLlmConfig(llmId, llmName, llmMaxTokens) }];
    }
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
    console.error("Usage: kweaver agent update <agent_id> [--name <n>] [--profile <p>] [--system-prompt <sp>] [--knowledge-network-id <id> [--config-path <path>]]");
    return 1;
  }

  let knowledgeNetworkId: string | null = null;
  let configPath: string | null = null;

  try {
    const token = await ensureValidToken();

    let current: Record<string, unknown>;
    let configFromFile: Record<string, unknown> | null = null;

    // 如果指定了 --config-path，从文件读取配置
    if (args.includes("--config-path")) {
      const configPathIndex = args.indexOf("--config-path");
      configPath = args[configPathIndex + 1] ?? "";
      if (!configPath || configPath.startsWith("-")) {
        console.error("Missing value for --config-path flag");
        return 1;
      }
      try {
        const fileContent = await fs.readFile(configPath, "utf-8");
        configFromFile = JSON.parse(fileContent) as Record<string, unknown>;
      } catch (error) {
        console.error(`Failed to read config from ${configPath}: ${error}`);
        return 1;
      }
    }

    // 从API获取当前 agent 配置
    const currentRaw = await getAgent({
      baseUrl: token.baseUrl,
      accessToken: token.accessToken,
      agentId,
    });
    current = JSON.parse(currentRaw) as Record<string, unknown>;

    // 如果从文件读取了 config，合并到 current 中
    if (configFromFile) {
      current.config = configFromFile;
    }

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
      if (arg === "--knowledge-network-id") {
        knowledgeNetworkId = args[++i] ?? "";
        if (!knowledgeNetworkId || knowledgeNetworkId.startsWith("-")) {
          console.error("Missing value for --knowledge-network-id flag");
          return 1;
        }
        continue;
      }
    }

    // 如果指定了 --knowledge-network-id，更新 data_source.knowledge_network
    if (knowledgeNetworkId) {
      const config = (current.config ?? {}) as Record<string, unknown>;
      const dataSource = (config.data_source ?? {}) as Record<string, unknown>;
      // 获取知识网络名称（如果需要的话，可以查询BKN获取）
      const knowledgeNetwork = [
        {
          knowledge_network_id: knowledgeNetworkId,
          knowledge_network_name: "", // 可选：通过BKN API获取名称
        },
      ];
      dataSource.knowledge_network = knowledgeNetwork;
      config.data_source = dataSource;
      current.config = config;
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
    console.error("Usage: kweaver agent publish <agent_id> [--category-id <id>]");
    return 1;
  }

  let categoryId = "";

  for (let i = 1; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === "--category-id") {
      categoryId = args[i + 1] ?? "";
      i += 1;
      continue;
    }
    if (arg === "--help" || arg === "-h") {
      console.log(`kweaver agent publish <agent_id> [options]

Publish an agent.

Options:
  --category-id <id>    Category ID for the agent
  -bd, --biz-domain <value> Business domain (default: bd_public)`);
      return 0;
    }
  }

  try {
    const token = await ensureValidToken();
    const body = await publishAgent({
      baseUrl: token.baseUrl,
      accessToken: token.accessToken,
      agentId,
      categoryId,
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

// ── Personal List ─────────────────────────────────────────────────────────────

async function runAgentPersonalListCommand(args: string[]): Promise<number> {
  let options: AgentPersonalListOptions;
  try {
    options = parseAgentPersonalListArgs(args);
  } catch (error) {
    if (error instanceof Error && error.message === "help") {
      console.log(`kweaver agent personal-list [options]

List personal space agents from the agent-factory API.

Options:
  --name <text>                 Filter by name
  --pagination-marker <str>     Pagination marker
  --publish-status <status>     Filter by publish status
  --publish-to-be <value>       Publish to be filter
  --size <n>                    Max items to return (default: 48)
  --verbose, -v                 Show full JSON response
  -bd, --biz-domain <value>     Business domain (default: bd_public)
  --pretty                      Pretty-print JSON output (default)`);
      return 0;
    }
    console.error(formatHttpError(error));
    return 1;
  }

  try {
    const token = await ensureValidToken();
    const body = await listPersonalAgents({
      baseUrl: token.baseUrl,
      accessToken: token.accessToken,
      businessDomain: options.businessDomain,
      name: options.name,
      pagination_marker_str: options.pagination_marker_str,
      publish_status: options.publish_status,
      publish_to_be: options.publish_to_be,
      size: options.size,
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

// ── Template List ─────────────────────────────────────────────────────────────

async function runAgentTemplateListCommand(args: string[]): Promise<number> {
  let options: AgentTemplateListOptions;
  try {
    options = parseAgentTemplateListArgs(args);
  } catch (error) {
    if (error instanceof Error && error.message === "help") {
      console.log(`kweaver agent template-list [options]

List published agent templates from the agent-factory API.

Options:
  --category-id <id>            Filter by category
  --name <text>                 Filter by name
  --pagination-marker <str>     Pagination marker
  --size <n>                    Max items to return (default: 48)
  --verbose, -v                 Show full JSON response
  -bd, --biz-domain <value>     Business domain (default: bd_public)
  --pretty                      Pretty-print JSON output (default)`);
      return 0;
    }
    console.error(formatHttpError(error));
    return 1;
  }

  try {
    const token = await ensureValidToken();
    const body = await listPublishedAgentTemplates({
      baseUrl: token.baseUrl,
      accessToken: token.accessToken,
      businessDomain: options.businessDomain,
      category_id: options.category_id,
      name: options.name,
      pagination_marker_str: options.pagination_marker_str,
      size: options.size,
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

// ── Template Get ─────────────────────────────────────────────────────────────

async function runAgentTemplateGetCommand(args: string[]): Promise<number> {
  let options: AgentTemplateGetOptions;
  try {
    options = parseAgentTemplateGetArgs(args);
  } catch (error) {
    if (error instanceof Error && error.message === "help") {
      console.log(`kweaver agent template-get <template_id> [options]

Get published agent template details from the agent-factory API.

Options:
  --verbose, -v             Show full JSON response
  -bd, --biz-domain <value> Business domain (default: bd_public)
  --pretty                   Pretty-print JSON output (default)
  --save-config <path>       Save config to file with timestamp (output: <path-with-timestamp>)`);
      return 0;
    }
    console.error(formatHttpError(error));
    return 1;
  }

  try {
    const token = await ensureValidToken();
    const body = await getPublishedAgentTemplate({
      baseUrl: token.baseUrl,
      accessToken: token.accessToken,
      templateId: options.templateId,
      businessDomain: options.businessDomain,
    });

    if (body) {
      // 如果指定了 --save-config，保存 config 到文件（带时间戳）
      if (options.saveConfig) {
        const parsed = JSON.parse(body) as Record<string, unknown>;
        const config = (parsed.config as Record<string, unknown>) ?? {};
        const timestampedPath = generateTimestampedPath(options.saveConfig);
        // 确保目录存在
        const dir = dirname(timestampedPath);
        await fs.mkdir(dir, { recursive: true });
        await fs.writeFile(timestampedPath, JSON.stringify(config, null, 2), "utf-8");
        console.log(timestampedPath);
        return 0;
      }
      console.log(options.verbose ? formatCallOutput(body, options.pretty) : formatSimpleAgentTemplateGet(body, options.pretty));
    }
    return 0;
  } catch (error) {
    console.error(formatHttpError(error));
    return 1;
  }
}

// ── Category List ───────────────────────────────────────────────────────────

async function runAgentCategoryListCommand(args: string[]): Promise<number> {
  let businessDomain = "";
  let pretty = true;
  let verbose = false;

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];

    if (arg === "--help" || arg === "-h") {
      console.log(`kweaver agent category-list [options]

List agent categories from the agent-factory API.

Options:
  --verbose, -v             Show full JSON response
  -bd, --biz-domain <value> Business domain (default: bd_public)
  --pretty                  Pretty-print JSON output (default)`);
      return 0;
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

    throw new Error(`Unsupported agent category-list argument: ${arg}`);
  }

  if (!businessDomain) businessDomain = resolveBusinessDomain();

  try {
    const token = await ensureValidToken();
    const body = await listAgentCategories({
      baseUrl: token.baseUrl,
      accessToken: token.accessToken,
      businessDomain,
    });

    if (body) {
      console.log(verbose ? formatCallOutput(body, pretty) : formatCallOutput(body, pretty));
    }
    return 0;
  } catch (error) {
    console.error(formatHttpError(error));
    return 1;
  }
}
