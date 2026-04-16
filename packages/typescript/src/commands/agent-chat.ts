import { ensureValidToken, formatHttpError } from "../auth/oauth.js";
import { fetchAgentInfo, sendChatRequest } from "../api/agent-chat.js";
import { resolveBusinessDomain } from "../config/store.js";

export interface ChatArgs {
  agentId: string;
  version: string;
  message?: string;
  conversationId?: string;
  stream?: boolean;
  verbose: boolean;
  businessDomain: string;
}

function formatCliArg(value: string): string {
  if (/^[A-Za-z0-9_./:=+-]+$/.test(value)) {
    return value;
  }

  return JSON.stringify(value);
}

export function buildContinueCommand(args: string[], conversationId: string): string {
  const filteredArgs: string[] = [];

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === "-m" || arg === "--message") {
      filteredArgs.push(arg, "{你的下一轮问题}");
      i += 1;
      continue;
    }

    if (
      arg === "--conversation-id" ||
      arg === "-cid" ||
      arg === "--conversation_id" ||
      arg === "-conversation-id" ||
      arg === "-conversation_id" ||
      arg === "--session-id"
    ) {
      i += 1;
      continue;
    }
    filteredArgs.push(arg);
  }

  return [
    "kweaver",
    "agent",
    "chat",
    ...filteredArgs.map((arg) => formatCliArg(arg)),
    "-cid",
    formatCliArg(conversationId),
  ].join(" ");
}

export function parseChatArgs(args: string[]): ChatArgs {
  let agentId: string | undefined;
  let version = "v0";
  let message: string | undefined;
  let conversationId: string | undefined;
  let stream: boolean | undefined;
  let verbose = false;
  let businessDomain = "";

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];

    if (arg === "-m" || arg === "--message") {
      message = args[i + 1];
      if (!message || message.startsWith("-")) {
        throw new Error("Missing value for message flag");
      }
      i += 1;
      continue;
    }

    if (
      arg === "--version" ||
      arg === "-version"
    ) {
      version = args[i + 1] ?? "";
      if (!version || version.startsWith("-")) {
        throw new Error("Missing value for version flag");
      }
      i += 1;
      continue;
    }

    if (
      arg === "--conversation-id" ||
      arg === "-cid" ||
      arg === "--conversation_id" ||
      arg === "-conversation-id" ||
      arg === "-conversation_id" ||
      arg === "--session-id"
    ) {
      conversationId = args[i + 1];
      if (!conversationId || conversationId.startsWith("-")) {
        throw new Error("Missing value for conversation-id flag");
      }
      i += 1;
      continue;
    }

    if (arg === "--stream") {
      stream = true;
      continue;
    }

    if (arg === "--no-stream") {
      stream = false;
      continue;
    }

    if (arg === "--verbose" || arg === "-v" || arg === "--debug") {
      verbose = true;
      continue;
    }

    if (arg === "-bd" || arg === "--biz-domain") {
      businessDomain = args[i + 1] ?? "";
      if (!businessDomain || businessDomain.startsWith("-")) {
        throw new Error("Missing value for biz-domain flag");
      }
      i += 1;
      continue;
    }

    if (!arg.startsWith("-") && !agentId) {
      agentId = arg;
      continue;
    }

    throw new Error(`Unsupported argument: ${arg}`);
  }

  if (!agentId) {
    throw new Error("Missing agent_id. Usage: kweaver agent chat <agent_id> [-m \"message\"]");
  }

  if (!businessDomain) businessDomain = resolveBusinessDomain();
  return { agentId, version, message, conversationId, stream, verbose, businessDomain };
}

export async function runAgentChatCommand(args: string[]): Promise<number> {
  const originalArgs = [...args];
  let chatArgs: ChatArgs;
  try {
    chatArgs = parseChatArgs(args);
  } catch (error) {
    console.error(formatHttpError(error));
    return 1;
  }

  let token;
  try {
    token = await ensureValidToken();
  } catch (error) {
    console.error(formatHttpError(error));
    return 1;
  }

  const isInteractive = chatArgs.message === undefined;
  const stream = chatArgs.stream ?? (isInteractive ? true : false);
  let agentInfo;

  try {
    agentInfo = await fetchAgentInfo({
      baseUrl: token.baseUrl,
      accessToken: token.accessToken,
      agentId: chatArgs.agentId,
      version: chatArgs.version,
      businessDomain: chatArgs.businessDomain,
    });
  } catch (error) {
    console.error(formatHttpError(error));
    return 1;
  }

  if (isInteractive) {
    return runTui(chatArgs, agentInfo, token);
  }

  try {
    const result = await sendChatRequest({
      baseUrl: token.baseUrl,
      accessToken: token.accessToken,
      agentId: agentInfo.id,
      agentKey: agentInfo.key,
      agentVersion: agentInfo.version,
      query: chatArgs.message ?? "",
      conversationId: chatArgs.conversationId,
      stream,
      verbose: chatArgs.verbose,
      businessDomain: chatArgs.businessDomain,
    });

    if (result.text && !stream) {
      console.log(result.text);
    }
    if (result.conversationId && chatArgs.message !== undefined) {
      console.error("");
      console.error("To continue this conversation, rerun the command with --conversation-id:");
      console.error(buildContinueCommand(originalArgs, result.conversationId));
    }
    if (result.conversationId && chatArgs.verbose) {
      console.error(`conversation_id: ${result.conversationId}`);
    }
    return 0;
  } catch (error) {
    console.error(formatHttpError(error));
    return 1;
  }
}

async function runTui(
  chatArgs: ChatArgs,
  agentInfo: { id: string; key: string; version: string },
  _token: { baseUrl: string; accessToken: string }
): Promise<number> {
  const { createElement } = await import("react");
  const { render } = await import("ink");
  const { ChatApp } = await import("../ui/ChatApp.js");
  const app = render(
    createElement(ChatApp, {
      getToken: ensureValidToken,
      agentId: agentInfo.id,
      agentKey: agentInfo.key,
      agentVersion: agentInfo.version,
      businessDomain: chatArgs.businessDomain,
      verbose: chatArgs.verbose,
      initialConversationId: chatArgs.conversationId,
      stream: chatArgs.stream ?? true,
    })
  );
  await app.waitUntilExit();
  return 0;
}
