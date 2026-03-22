import { runAgentCommand } from "./commands/agent.js";
import { runAuthCommand } from "./commands/auth.js";
import { runKnCommand } from "./commands/bkn.js";
import { runCallCommand } from "./commands/call.js";
import { runConfigCommand } from "./commands/config.js";
import { runContextLoaderCommand } from "./commands/context-loader.js";
import { runDsCommand } from "./commands/ds.js";
import { runTokenCommand } from "./commands/token.js";
import { runVegaCommand } from "./commands/vega.js";

function printHelp(): void {
  console.log(`kweaver

Usage:
  kweaver auth <platform-url>
  kweaver auth login <platform-url>
  kweaver auth <platform-url> [--alias name] [--no-open] [--host host] [--redirect-uri uri]
  kweaver auth status [platform-url]
  kweaver auth list
  kweaver auth use <platform-url>
  kweaver auth logout [platform-url]
  kweaver auth delete <platform-url>
  kweaver token
  kweaver call <url> [-X METHOD] [-H "Name: value"] [-d BODY] [--pretty] [--verbose] [-bd value]
  kweaver agent chat <agent_id> [-m "message"] [--version value] [--conversation-id id] [--stream] [--no-stream] [--verbose] [-bd value]
  kweaver agent list [options]
  kweaver agent get <agent_id> [options]
  kweaver ds list [options]
  kweaver ds get <id>
  kweaver ds connect <db_type> <host> <port> <database> --account X --password Y
  kweaver bkn list [options]
  kweaver bkn get <kn-id> [options]
  kweaver bkn search <kn-id> <query> [options]
  kweaver bkn create [options]
  kweaver bkn update <kn-id> [options]
  kweaver bkn delete <kn-id>
  kweaver config [set-bd|show]
  kweaver vega [health|stats|inspect|catalog|resource|connector-type]
  kweaver context-loader [config|kn-search|...]
  kweaver --help

Commands:
  auth           Login, list, inspect, and switch saved platform auth profiles
  token          Print the current access token, refreshing it first if needed
  call           Call an API with curl-style flags and auto-injected token headers
  ds             Manage datasources (list, get, delete, tables, connect)
  agent          Chat with a KWeaver agent (agent chat <id>), list published agents (agent list)
  bkn           Business knowledge network (list/get/create/update/delete/export/stats; object-type, subgraph, action-type, action-log)
  config         Per-platform configuration (business domain)
  vega           Vega observability platform (catalogs, resources, connector-types, health)
  context-loader Call context-loader MCP (tools, resources, prompts; kn-search, query-*, etc.)
  help           Show this message`);
}

export async function run(argv: string[]): Promise<number> {
  const [command, ...rest] = argv;

  if (command === "--version" || command === "-V" || command === "version") {
    const { createRequire } = await import("node:module");
    const require = createRequire(import.meta.url);
    const pkg = require("../package.json") as { version: string };
    console.log(pkg.version);
    return 0;
  }

  if (argv.length === 0 || !command || command === "--help" || command === "-h" || command === "help") {
    printHelp();
    return 0;
  }

  if (command === "auth") {
    return runAuthCommand(rest);
  }

  if (command === "call" || command === "curl") {
    return runCallCommand(rest);
  }

  if (command === "ds") {
    return runDsCommand(rest);
  }

  if (command === "token") {
    return runTokenCommand(rest);
  }

  if (command === "agent") {
    return runAgentCommand(rest);
  }

  if (command === "bkn") {
    return runKnCommand(rest);
  }

  if (command === "vega") {
    return runVegaCommand(rest);
  }

  if (command === "config") {
    return runConfigCommand(rest);
  }

  if (command === "context-loader" || command === "context") {
    return runContextLoaderCommand(rest);
  }

  console.error(`Unknown command: ${command}`);
  printHelp();
  return 1;
}

function safeExit(code: number): void {
  if (process.stdout.writableNeedDrain || process.stderr.writableNeedDrain) {
    const done = () => {
      if (!process.stdout.writableNeedDrain && !process.stderr.writableNeedDrain) {
        process.exit(code);
      }
    };
    process.stdout.once("drain", done);
    process.stderr.once("drain", done);
  } else {
    process.exit(code);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  run(process.argv.slice(2))
    .then((code) => {
      safeExit(code);
    })
    .catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      console.error(message);
      safeExit(1);
    });
}
