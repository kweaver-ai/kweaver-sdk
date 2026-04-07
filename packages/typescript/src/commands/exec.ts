import { ensureValidToken, formatHttpError, with401RefreshRetry } from "../auth/oauth.js";
import { formatCallOutput } from "./call.js";
import { resolveBusinessDomain } from "../config/store.js";
import {
  listOperators,
  getOperator,
  registerOperator,
  editOperator,
  deleteOperator,
  updateOperatorStatus,
  debugOperator,
  listOperatorHistory,
  listOperatorMarket,
  getOperatorMarket,
  listOperatorCategories,
  registerInternalOperator,
} from "../api/execution-factory/operator.js";
import {
  listToolBoxes,
  getToolBox,
  createToolBox,
  updateToolBox,
  deleteToolBox,
  updateToolBoxStatus,
  listTools,
  getTool,
  createTool,
  updateTool,
  updateToolStatus,
  deleteTool,
  batchDeleteTools,
  convertOperatorToTool,
  listToolBoxMarket,
  getToolBoxMarket,
  listToolBoxCategories,
  createInternalToolBox,
  toolProxy,
  debugTool,
  executeFunction,
  aiGenerateFunction,
  listPromptTemplates,
  installDependencies,
  getDependencyVersions,
} from "../api/execution-factory/toolbox.js";
import {
  listMCPServers,
  getMCPServer,
  registerMCPServer,
  updateMCPServer,
  deleteMCPServer,
  updateMCPServerStatus,
  parseMCPSSERequest,
  debugMCPTool,
  listMCPMarket,
  getMCPMarket,
  listMCPCategories,
  mcpProxyCallTool,
  mcpProxyListTools,
} from "../api/execution-factory/mcp.js";
import { exportData, importData } from "../api/execution-factory/impex.js";
import { promises as fs } from "fs";

const EXEC_HELP = `kweaver exec - Execution Factory Commands

Subcommands:
  operator <command>    Operator management
  toolbox <command>     Toolbox management
  mcp <command>         MCP server management
  impex <command>       Import/Export operations

Use 'kweaver exec <subcommand> --help' for more information.`;

const OPERATOR_HELP = `kweaver exec operator - Operator Management

Subcommands:
  list [options]                    List operators
  get <operator_id> [options]       Get operator details
  register [options]                Register a new operator
  edit <operator_id> <version> [options]  Edit operator
  delete [options]                  Delete operators
  status [options]                  Update operator status
  debug [options]                   Debug operator
  history <operator_id> [options]   List operator history
  market [options]                  List operators in market
  market-get <operator_id>          Get operator from market
  categories                        List operator categories
  internal-register [options]       Register internal operator

Options:
  -bd, --biz-domain <value>  Business domain (default: bd_public)
  --pretty                    Pretty-print JSON output (default)
  --compact                   Compact JSON output`;

const TOOLBOX_HELP = `kweaver exec toolbox - Toolbox Management

Subcommands:
  list [options]                    List toolboxes
  get <box_id> [options]            Get toolbox details
  create [options]                  Create a new toolbox
  update <box_id> [options]         Update toolbox
  delete <box_id>                   Delete toolbox
  status <box_id> [options]         Update toolbox status
  tool-list <box_id> [options]      List tools in toolbox
  tool-get <box_id> <tool_id>       Get tool details
  tool-create <box_id> [options]    Create tool in toolbox
  tool-update <box_id> <tool_id> [options]  Update tool
  tool-status <box_id> [options]    Update tool status
  tool-delete <box_id> <tool_id>    Delete tool
  tool-batch-delete <box_id> [options]  Batch delete tools
  convert [options]                 Convert operator to tool
  market [options]                  List toolboxes in market
  market-get <box_id>               Get toolbox from market
  categories                        List toolbox categories
  proxy <box_id> <tool_id> [options]  Tool proxy call
  debug <box_id> <tool_id> [options]  Debug tool
  function-execute [options]        Execute function
  function-ai-generate [options]    AI generate function
  prompt-templates                  List prompt templates
  dependencies-install [options]    Install dependencies
  dependencies-versions <package>   Get dependency versions

Options:
  -bd, --biz-domain <value>  Business domain (default: bd_public)
  --pretty                    Pretty-print JSON output (default)
  --compact                   Compact JSON output`;

const MCP_HELP = `kweaver exec mcp - MCP Server Management

Subcommands:
  list [options]                    List MCP servers
  get <mcp_id> [options]            Get MCP server details
  create [options]                  Register a new MCP server
  update <mcp_id> [options]         Update MCP server
  delete <mcp_id>                   Delete MCP server
  status <mcp_id> [options]         Update MCP server status
  parse-sse [options]               Parse SSE request
  debug <mcp_id> <tool_name> [options]  Debug MCP tool
  market [options]                  List MCP servers in market
  market-get <mcp_id>               Get MCP server from market
  categories                        List MCP categories
  proxy-call <mcp_id> [options]     Proxy call tool
  proxy-list <mcp_id>               Proxy list tools

Options:
  -bd, --biz-domain <value>  Business domain (default: bd_public)
  --pretty                    Pretty-print JSON output (default)
  --compact                   Compact JSON output`;

const IMPEX_HELP = `kweaver exec impex - Import/Export Operations

Subcommands:
  export <type> <id> [options]     Export single component by type and id
  import <type> [options]           Import data of specified type

Arguments:
  type                              Component type: operator, toolbox, or mcp
  id                                Component ID to export

Options:
  -bd, --biz-domain <value>  Business domain (default: bd_public)
  -f, --file <path>         Import from ADP file (multipart/form-data)
  --pretty                    Pretty-print JSON output (default)
  --compact                   Compact JSON output`;

function parseCommonArgs(args: string[]): { businessDomain: string; pretty: boolean; remaining: string[]; filePath?: string } {
  let businessDomain = "";
  let pretty = true;
  let filePath: string | undefined;
  const remaining: string[] = [];

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];

    if (arg === "-bd" || arg === "--biz-domain") {
      businessDomain = args[i + 1] ?? "bd_public";
      i += 1;
      continue;
    }

    if (arg === "-f" || arg === "--file") {
      filePath = args[i + 1];
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

    remaining.push(arg);
  }

  if (!businessDomain) businessDomain = resolveBusinessDomain();
  return { businessDomain, pretty, remaining, filePath };
}

export async function runExecCommand(args: string[]): Promise<number> {
  const [subcommand, ...rest] = args;

  if (!subcommand || subcommand === "--help" || subcommand === "-h") {
    console.log(EXEC_HELP);
    return 0;
  }

  try {
    return await with401RefreshRetry(async () => {
      if (subcommand === "operator") return runOperatorCommand(rest);
      if (subcommand === "toolbox") return runToolboxCommand(rest);
      if (subcommand === "mcp") return runMcpCommand(rest);
      if (subcommand === "impex") return runImpexCommand(rest);
      console.error(`Unknown exec subcommand: ${subcommand}`);
      return 1;
    });
  } catch (error) {
    console.error(formatHttpError(error));
    return 1;
  }
}

async function runOperatorCommand(args: string[]): Promise<number> {
  const [cmd, ...rest] = args;

  if (!cmd || cmd === "--help" || cmd === "-h") {
    console.log(OPERATOR_HELP);
    return 0;
  }

  const { businessDomain, pretty, remaining } = parseCommonArgs(rest);
  const token = await ensureValidToken();

  switch (cmd) {
    case "list": {
      const opts = parseListOptions(remaining);
      const body = await listOperators({
        baseUrl: token.baseUrl,
        accessToken: token.accessToken,
        businessDomain,
        ...opts,
      });
      console.log(formatCallOutput(body, pretty));
      return 0;
    }

    case "get": {
      const operatorId = remaining[0];
      if (!operatorId) {
        console.error("Missing operator_id");
        return 1;
      }
      const version = remaining[1];
      const body = await getOperator({
        baseUrl: token.baseUrl,
        accessToken: token.accessToken,
        businessDomain,
        operatorId,
        version,
      });
      console.log(formatCallOutput(body, pretty));
      return 0;
    }

    case "register": {
      const body = await readBodyFromFileOrArg(remaining);
      const result = await registerOperator({
        baseUrl: token.baseUrl,
        accessToken: token.accessToken,
        businessDomain,
        body: JSON.parse(body),
      });
      console.log(formatCallOutput(result, pretty));
      return 0;
    }

    case "edit": {
      const operatorId = remaining[0];
      const version = remaining[1];
      if (!operatorId || !version) {
        console.error("Missing operator_id or version");
        return 1;
      }
      const body = await readBodyFromFileOrArg(remaining.slice(2));
      const result = await editOperator({
        baseUrl: token.baseUrl,
        accessToken: token.accessToken,
        businessDomain,
        operatorId,
        version,
        body: JSON.parse(body),
      });
      console.log(formatCallOutput(result, pretty));
      return 0;
    }

    case "delete": {
      const body = await readBodyFromFileOrArg(remaining);
      const result = await deleteOperator({
        baseUrl: token.baseUrl,
        accessToken: token.accessToken,
        businessDomain,
        body: JSON.parse(body),
      });
      console.log(formatCallOutput(result, pretty));
      return 0;
    }

    case "status": {
      const body = await readBodyFromFileOrArg(remaining);
      const result = await updateOperatorStatus({
        baseUrl: token.baseUrl,
        accessToken: token.accessToken,
        businessDomain,
        body: JSON.parse(body),
      });
      console.log(formatCallOutput(result, pretty));
      return 0;
    }

    case "debug": {
      const body = await readBodyFromFileOrArg(remaining);
      const result = await debugOperator({
        baseUrl: token.baseUrl,
        accessToken: token.accessToken,
        businessDomain,
        body: JSON.parse(body),
      });
      console.log(formatCallOutput(result, pretty));
      return 0;
    }

    case "history": {
      const operatorId = remaining[0];
      if (!operatorId) {
        console.error("Missing operator_id");
        return 1;
      }
      const opts = parseListOptions(remaining.slice(1));
      const body = await listOperatorHistory({
        baseUrl: token.baseUrl,
        accessToken: token.accessToken,
        businessDomain,
        operatorId,
        ...opts,
      });
      console.log(formatCallOutput(body, pretty));
      return 0;
    }

    case "market": {
      const opts = parseListOptions(remaining);
      const body = await listOperatorMarket({
        baseUrl: token.baseUrl,
        accessToken: token.accessToken,
        businessDomain,
        ...opts,
      });
      console.log(formatCallOutput(body, pretty));
      return 0;
    }

    case "market-get": {
      const operatorId = remaining[0];
      if (!operatorId) {
        console.error("Missing operator_id");
        return 1;
      }
      const body = await getOperatorMarket({
        baseUrl: token.baseUrl,
        accessToken: token.accessToken,
        businessDomain,
        operatorId,
      });
      console.log(formatCallOutput(body, pretty));
      return 0;
    }

    case "categories": {
      const body = await listOperatorCategories({
        baseUrl: token.baseUrl,
        accessToken: token.accessToken,
        businessDomain,
      });
      console.log(formatCallOutput(body, pretty));
      return 0;
    }

    case "internal-register": {
      const body = await readBodyFromFileOrArg(remaining);
      const result = await registerInternalOperator({
        baseUrl: token.baseUrl,
        accessToken: token.accessToken,
        businessDomain,
        body: JSON.parse(body),
      });
      console.log(formatCallOutput(result, pretty));
      return 0;
    }

    default:
      console.error(`Unknown operator subcommand: ${cmd}`);
      return 1;
  }
}

async function runToolboxCommand(args: string[]): Promise<number> {
  const [cmd, ...rest] = args;

  if (!cmd || cmd === "--help" || cmd === "-h") {
    console.log(TOOLBOX_HELP);
    return 0;
  }

  const { businessDomain, pretty, remaining } = parseCommonArgs(rest);
  const token = await ensureValidToken();

  switch (cmd) {
    case "list": {
      const opts = parseListOptions(remaining);
      const body = await listToolBoxes({
        baseUrl: token.baseUrl,
        accessToken: token.accessToken,
        businessDomain,
        ...opts,
      });
      console.log(formatCallOutput(body, pretty));
      return 0;
    }

    case "get": {
      const boxId = remaining[0];
      if (!boxId) {
        console.error("Missing box_id");
        return 1;
      }
      const body = await getToolBox({
        baseUrl: token.baseUrl,
        accessToken: token.accessToken,
        businessDomain,
        boxId,
      });
      console.log(formatCallOutput(body, pretty));
      return 0;
    }

    case "create": {
      const body = await readBodyFromFileOrArg(remaining);
      const result = await createToolBox({
        baseUrl: token.baseUrl,
        accessToken: token.accessToken,
        businessDomain,
        body: JSON.parse(body),
      });
      console.log(formatCallOutput(result, pretty));
      return 0;
    }

    case "update": {
      const boxId = remaining[0];
      if (!boxId) {
        console.error("Missing box_id");
        return 1;
      }
      const body = await readBodyFromFileOrArg(remaining.slice(1));
      const result = await updateToolBox({
        baseUrl: token.baseUrl,
        accessToken: token.accessToken,
        businessDomain,
        boxId,
        body: JSON.parse(body),
      });
      console.log(formatCallOutput(result, pretty));
      return 0;
    }

    case "delete": {
      const boxId = remaining[0];
      if (!boxId) {
        console.error("Missing box_id");
        return 1;
      }
      const body = await deleteToolBox({
        baseUrl: token.baseUrl,
        accessToken: token.accessToken,
        businessDomain,
        boxId,
      });
      console.log(formatCallOutput(body, pretty));
      return 0;
    }

    case "status": {
      const boxId = remaining[0];
      if (!boxId) {
        console.error("Missing box_id");
        return 1;
      }
      const status = remaining[1];
      if (!status) {
        console.error("Missing status");
        return 1;
      }
      const body = await updateToolBoxStatus({
        baseUrl: token.baseUrl,
        accessToken: token.accessToken,
        businessDomain,
        boxId,
        body: { status: status as "unpublish" | "published" | "offline" },
      });
      console.log(formatCallOutput(body, pretty));
      return 0;
    }

    case "tool-list": {
      const boxId = remaining[0];
      if (!boxId) {
        console.error("Missing box_id");
        return 1;
      }
      const opts = parseListOptions(remaining.slice(1));
      const body = await listTools({
        baseUrl: token.baseUrl,
        accessToken: token.accessToken,
        businessDomain,
        boxId,
        ...opts,
      });
      console.log(formatCallOutput(body, pretty));
      return 0;
    }

    case "tool-get": {
      const boxId = remaining[0];
      const toolId = remaining[1];
      if (!boxId || !toolId) {
        console.error("Missing box_id or tool_id");
        return 1;
      }
      const boxBody = await getToolBox({
        baseUrl: token.baseUrl,
        accessToken: token.accessToken,
        businessDomain,
        boxId,
      });
      const boxData = JSON.parse(boxBody);
      const boxSvcUrl = boxData.box_svc_url;
      if (!boxSvcUrl) {
        console.error("tool-box service URL not found in response");
        return 1;
      }
      const body = await getTool({
        baseUrl: boxSvcUrl,
        accessToken: token.accessToken,
        businessDomain,
        boxId,
        toolId,
      });
      console.log(formatCallOutput(body, pretty));
      return 0;
    }

    case "tool-create": {
      const boxId = remaining[0];
      if (!boxId) {
        console.error("Missing box_id");
        return 1;
      }
      const body = await readBodyFromFileOrArg(remaining.slice(1));
      const result = await createTool({
        baseUrl: token.baseUrl,
        accessToken: token.accessToken,
        businessDomain,
        boxId,
        body: JSON.parse(body),
      });
      console.log(formatCallOutput(result, pretty));
      return 0;
    }

    case "tool-update": {
      const boxId = remaining[0];
      const toolId = remaining[1];
      if (!boxId || !toolId) {
        console.error("Missing box_id or tool_id");
        return 1;
      }
      const body = await readBodyFromFileOrArg(remaining.slice(2));
      const result = await updateTool({
        baseUrl: token.baseUrl,
        accessToken: token.accessToken,
        businessDomain,
        boxId,
        toolId,
        body: JSON.parse(body),
      });
      console.log(formatCallOutput(result, pretty));
      return 0;
    }

    case "tool-status": {
      const boxId = remaining[0];
      if (!boxId) {
        console.error("Missing box_id");
        return 1;
      }
      const body = await readBodyFromFileOrArg(remaining.slice(1));
      const result = await updateToolStatus({
        baseUrl: token.baseUrl,
        accessToken: token.accessToken,
        businessDomain,
        boxId,
        body: JSON.parse(body),
      });
      console.log(formatCallOutput(result, pretty));
      return 0;
    }

    case "tool-delete": {
      const boxId = remaining[0];
      const toolId = remaining[1];
      if (!boxId || !toolId) {
        console.error("Missing box_id or tool_id");
        return 1;
      }
      const body = await deleteTool({
        baseUrl: token.baseUrl,
        accessToken: token.accessToken,
        businessDomain,
        boxId,
        toolId,
      });
      console.log(formatCallOutput(body, pretty));
      return 0;
    }

    case "tool-batch-delete": {
      const boxId = remaining[0];
      if (!boxId) {
        console.error("Missing box_id");
        return 1;
      }
      const body = await readBodyFromFileOrArg(remaining.slice(1));
      const result = await batchDeleteTools({
        baseUrl: token.baseUrl,
        accessToken: token.accessToken,
        businessDomain,
        boxId,
        body: JSON.parse(body),
      });
      console.log(formatCallOutput(result, pretty));
      return 0;
    }

    case "convert": {
      const body = await readBodyFromFileOrArg(remaining);
      const result = await convertOperatorToTool({
        baseUrl: token.baseUrl,
        accessToken: token.accessToken,
        businessDomain,
        body: JSON.parse(body),
      });
      console.log(formatCallOutput(result, pretty));
      return 0;
    }

    case "market": {
      const opts = parseListOptions(remaining);
      const body = await listToolBoxMarket({
        baseUrl: token.baseUrl,
        accessToken: token.accessToken,
        businessDomain,
        ...opts,
      });
      console.log(formatCallOutput(body, pretty));
      return 0;
    }

    case "market-get": {
      const boxId = remaining[0];
      if (!boxId) {
        console.error("Missing box_id");
        return 1;
      }
      const body = await getToolBoxMarket({
        baseUrl: token.baseUrl,
        accessToken: token.accessToken,
        businessDomain,
        boxId,
      });
      console.log(formatCallOutput(body, pretty));
      return 0;
    }

    case "categories": {
      const body = await listToolBoxCategories({
        baseUrl: token.baseUrl,
        accessToken: token.accessToken,
        businessDomain,
      });
      console.log(formatCallOutput(body, pretty));
      return 0;
    }

    case "internal-create": {
      const body = await readBodyFromFileOrArg(remaining);
      const result = await createInternalToolBox({
        baseUrl: token.baseUrl,
        accessToken: token.accessToken,
        businessDomain,
        body: JSON.parse(body),
      });
      console.log(formatCallOutput(result, pretty));
      return 0;
    }

    case "proxy": {
      const boxId = remaining[0];
      const toolId = remaining[1];
      if (!boxId || !toolId) {
        console.error("Missing box_id or tool_id");
        return 1;
      }
      const body = await readBodyFromFileOrArg(remaining.slice(2));
      const result = await toolProxy({
        baseUrl: token.baseUrl,
        accessToken: token.accessToken,
        businessDomain,
        boxId,
        toolId,
        body: JSON.parse(body),
      });
      console.log(formatCallOutput(result, pretty));
      return 0;
    }

    case "debug": {
      const boxId = remaining[0];
      const toolId = remaining[1];
      if (!boxId || !toolId) {
        console.error("Missing box_id or tool_id");
        return 1;
      }
      const body = await readBodyFromFileOrArg(remaining.slice(2));
      const result = await debugTool({
        baseUrl: token.baseUrl,
        accessToken: token.accessToken,
        businessDomain,
        boxId,
        toolId,
        body: JSON.parse(body),
      });
      console.log(formatCallOutput(result, pretty));
      return 0;
    }

    case "function-execute": {
      const body = await readBodyFromFileOrArg(remaining);
      const result = await executeFunction({
        baseUrl: token.baseUrl,
        accessToken: token.accessToken,
        businessDomain,
        body: JSON.parse(body),
      });
      console.log(formatCallOutput(result, pretty));
      return 0;
    }

    case "function-ai-generate": {
      const body = await readBodyFromFileOrArg(remaining);
      const result = await aiGenerateFunction({
        baseUrl: token.baseUrl,
        accessToken: token.accessToken,
        businessDomain,
        body: JSON.parse(body),
      });
      console.log(formatCallOutput(result, pretty));
      return 0;
    }

    case "prompt-templates": {
      const body = await listPromptTemplates({
        baseUrl: token.baseUrl,
        accessToken: token.accessToken,
        businessDomain,
      });
      console.log(formatCallOutput(body, pretty));
      return 0;
    }

    case "dependencies-install": {
      const body = await readBodyFromFileOrArg(remaining);
      const result = await installDependencies({
        baseUrl: token.baseUrl,
        accessToken: token.accessToken,
        businessDomain,
        body: JSON.parse(body),
      });
      console.log(formatCallOutput(result, pretty));
      return 0;
    }

    case "dependencies-versions": {
      const packageName = remaining[0];
      if (!packageName) {
        console.error("Missing package name");
        return 1;
      }
      const body = await getDependencyVersions({
        baseUrl: token.baseUrl,
        accessToken: token.accessToken,
        businessDomain,
        packageName,
      });
      console.log(formatCallOutput(body, pretty));
      return 0;
    }

    default:
      console.error(`Unknown toolbox subcommand: ${cmd}`);
      return 1;
  }
}

async function runMcpCommand(args: string[]): Promise<number> {
  const [cmd, ...rest] = args;

  if (!cmd || cmd === "--help" || cmd === "-h") {
    console.log(MCP_HELP);
    return 0;
  }

  const { businessDomain, pretty, remaining } = parseCommonArgs(rest);
  const token = await ensureValidToken();

  switch (cmd) {
    case "list": {
      const opts = parseListOptions(remaining);
      const body = await listMCPServers({
        baseUrl: token.baseUrl,
        accessToken: token.accessToken,
        businessDomain,
        ...opts,
      });
      console.log(formatCallOutput(body, pretty));
      return 0;
    }

    case "get": {
      const mcpId = remaining[0];
      if (!mcpId) {
        console.error("Missing mcp_id");
        return 1;
      }
      const body = await getMCPServer({
        baseUrl: token.baseUrl,
        accessToken: token.accessToken,
        businessDomain,
        mcpId,
      });
      console.log(formatCallOutput(body, pretty));
      return 0;
    }

    case "create": {
      const body = await readBodyFromFileOrArg(remaining);
      const result = await registerMCPServer({
        baseUrl: token.baseUrl,
        accessToken: token.accessToken,
        businessDomain,
        body: JSON.parse(body),
      });
      console.log(formatCallOutput(result, pretty));
      return 0;
    }

    case "update": {
      const mcpId = remaining[0];
      if (!mcpId) {
        console.error("Missing mcp_id");
        return 1;
      }
      const body = await readBodyFromFileOrArg(remaining.slice(1));
      const result = await updateMCPServer({
        baseUrl: token.baseUrl,
        accessToken: token.accessToken,
        businessDomain,
        mcpId,
        body: JSON.parse(body),
      });
      console.log(formatCallOutput(result, pretty));
      return 0;
    }

    case "delete": {
      const mcpId = remaining[0];
      if (!mcpId) {
        console.error("Missing mcp_id");
        return 1;
      }
      const body = await deleteMCPServer({
        baseUrl: token.baseUrl,
        accessToken: token.accessToken,
        businessDomain,
        mcpId,
      });
      console.log(formatCallOutput(body, pretty));
      return 0;
    }

    case "status": {
      const mcpId = remaining[0];
      const status = remaining[1];
      if (!mcpId || !status) {
        console.error("Missing mcp_id or status");
        return 1;
      }
      const body = await updateMCPServerStatus({
        baseUrl: token.baseUrl,
        accessToken: token.accessToken,
        businessDomain,
        mcpId,
        status: status as "unpublish" | "published" | "offline",
      });
      console.log(formatCallOutput(body, pretty));
      return 0;
    }

    case "parse-sse": {
      const body = await readBodyFromFileOrArg(remaining);
      const result = await parseMCPSSERequest({
        baseUrl: token.baseUrl,
        accessToken: token.accessToken,
        businessDomain,
        body: JSON.parse(body),
      });
      console.log(formatCallOutput(result, pretty));
      return 0;
    }

    case "debug": {
      const mcpId = remaining[0];
      const toolName = remaining[1];
      if (!mcpId || !toolName) {
        console.error("Missing mcp_id or tool_name");
        return 1;
      }
      const body = await readBodyFromFileOrArg(remaining.slice(2));
      const result = await debugMCPTool({
        baseUrl: token.baseUrl,
        accessToken: token.accessToken,
        businessDomain,
        mcpId,
        toolName,
        body: JSON.parse(body),
      });
      console.log(formatCallOutput(result, pretty));
      return 0;
    }

    case "market": {
      const opts = parseListOptions(remaining);
      const body = await listMCPMarket({
        baseUrl: token.baseUrl,
        accessToken: token.accessToken,
        businessDomain,
        ...opts,
      });
      console.log(formatCallOutput(body, pretty));
      return 0;
    }

    case "market-get": {
      const mcpId = remaining[0];
      if (!mcpId) {
        console.error("Missing mcp_id");
        return 1;
      }
      const body = await getMCPMarket({
        baseUrl: token.baseUrl,
        accessToken: token.accessToken,
        businessDomain,
        mcpId,
      });
      console.log(formatCallOutput(body, pretty));
      return 0;
    }

    case "categories": {
      const body = await listMCPCategories({
        baseUrl: token.baseUrl,
        accessToken: token.accessToken,
        businessDomain,
      });
      console.log(formatCallOutput(body, pretty));
      return 0;
    }

    case "proxy-call": {
      const mcpId = remaining[0];
      if (!mcpId) {
        console.error("Missing mcp_id");
        return 1;
      }
      const body = await readBodyFromFileOrArg(remaining.slice(1));
      const result = await mcpProxyCallTool({
        baseUrl: token.baseUrl,
        accessToken: token.accessToken,
        businessDomain,
        mcpId,
        body: JSON.parse(body),
      });
      console.log(formatCallOutput(result, pretty));
      return 0;
    }

    case "proxy-list": {
      const mcpId = remaining[0];
      if (!mcpId) {
        console.error("Missing mcp_id");
        return 1;
      }
      const body = await mcpProxyListTools({
        baseUrl: token.baseUrl,
        accessToken: token.accessToken,
        businessDomain,
        mcpId,
      });
      console.log(formatCallOutput(body, pretty));
      return 0;
    }

    default:
      console.error(`Unknown mcp subcommand: ${cmd}`);
      return 1;
  }
}

async function runImpexCommand(args: string[]): Promise<number> {
  const [cmd, ...rest] = args;

  if (!cmd || cmd === "--help" || cmd === "-h") {
    console.log(IMPEX_HELP);
    return 0;
  }

  const { businessDomain, pretty, remaining, filePath } = parseCommonArgs(rest);
  const token = await ensureValidToken();

  switch (cmd) {
    case "export": {
      const [type, id, ...rest] = remaining;
      if (!type || !id) {
        console.error("Usage: kweaver exec impex export <type> <id>");
        return 1;
      }
      if (!["operator", "toolbox", "mcp"].includes(type)) {
        console.error("Type must be one of: operator, toolbox, mcp");
        return 1;
      }

      const body = await exportData({
        baseUrl: token.baseUrl,
        accessToken: token.accessToken,
        businessDomain,
        type: type as "operator" | "toolbox" | "mcp",
        id,
      });
      console.log(formatCallOutput(body, pretty));
      return 0;
    }

    case "import": {
      const [type, ...rest] = remaining;
      if (!type) {
        console.error("Usage: kweaver exec impex import <type>");
        return 1;
      }
      if (!["operator", "toolbox", "mcp"].includes(type)) {
        console.error("Type must be one of: operator, toolbox, mcp");
        return 1;
      }
      if (filePath) {
        const result = await importData({
          baseUrl: token.baseUrl,
          accessToken: token.accessToken,
          businessDomain,
          type: type as "operator" | "toolbox" | "mcp",
          filePath,
        });
        console.log(formatCallOutput(result, pretty));
        return 0;
      }
      const body = await readBodyFromFileOrArg(rest);
      const result = await importData({
        baseUrl: token.baseUrl,
        accessToken: token.accessToken,
        businessDomain,
        type: type as "operator" | "toolbox" | "mcp",
        body: JSON.parse(body),
      });
      console.log(formatCallOutput(result, pretty));
      return 0;
    }

    default:
      console.error(`Unknown impex subcommand: ${cmd}`);
      return 1;
  }
}

function parseListOptions(args: string[]): Record<string, unknown> {
  const opts: Record<string, unknown> = {};

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];

    if (arg === "--page") {
      opts.page = parseInt(args[++i] ?? "1", 10);
      continue;
    }

    if (arg === "--page-size" || arg === "--limit") {
      opts.page_size = parseInt(args[++i] ?? "30", 10);
      continue;
    }

    if (arg === "--name") {
      opts.name = args[++i];
      continue;
    }

    if (arg === "--status") {
      opts.status = args[++i];
      continue;
    }

    if (arg === "--category") {
      opts.category = args[++i];
      continue;
    }

    if (arg === "--source") {
      opts.source = args[++i];
      continue;
    }

    if (arg === "--create-user") {
      opts.create_user = args[++i];
      continue;
    }

    if (arg === "--id") {
      opts.operator_id = args[++i];
      opts.box_id = args[i];
      opts.mcp_id = args[i];
      continue;
    }

    if (arg === "--metadata-type") {
      opts.metadata_type = args[++i];
      continue;
    }
  }

  return opts;
}

async function readBodyFromFileOrArg(args: string[]): Promise<string> {
  if (args.length === 0) {
    throw new Error("Missing body argument. Provide JSON string or file path starting with @");
  }

  const input = args[0];

  if (input.startsWith("@")) {
    const filePath = input.slice(1);
    return fs.readFile(filePath, "utf-8");
  }

  if (input === "-" || args.length === 1) {
    return input;
  }

  return args.join(" ");
}
