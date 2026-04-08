import { applyTlsEnvFromSavedTokens } from "./config/tls-env.js";
import { runAgentCommand } from "./commands/agent.js";
import { runAuthCommand } from "./commands/auth.js";
import { runKnCommand } from "./commands/bkn.js";
import { runCallCommand } from "./commands/call.js";
import { runConfigCommand } from "./commands/config.js";
import { runContextLoaderCommand } from "./commands/context-loader.js";
import { runDsCommand } from "./commands/ds.js";
import { runDataviewCommand } from "./commands/dataview.js";
import { runSkillCommand } from "./commands/skill.js";
import { runTokenCommand } from "./commands/token.js";
import { runVegaCommand } from "./commands/vega.js";

function printHelp(): void {
  console.log(`kweaver

Usage:
  kweaver --version | -V
  kweaver --help | -h

  kweaver auth <platform-url> [--alias name] [-u user] [-p pass] [--playwright] [--insecure|-k]
  kweaver auth login <platform-url>          (alias for auth <url>)
  kweaver auth login <url> --client-id ID --client-secret S --refresh-token T   (run on host without browser)
  kweaver auth whoami [platform-url|alias] [--json]
  kweaver auth export [platform-url|alias] [--json]
  kweaver auth status [platform-url|alias]
  kweaver auth list
  kweaver auth use <platform-url|alias>
  kweaver auth users [platform-url|alias]
  kweaver auth switch [platform-url|alias] --user <userId|username>
  kweaver auth logout [platform-url|alias] [--user <userId>]
  kweaver auth delete <platform-url|alias> [--user <userId>]
  kweaver token

  kweaver call <url> [-X METHOD] [-H "Name: value"] [-d BODY] [--data-raw BODY]
             [--url URL] [--pretty] [--verbose] [-bd value]
  (alias: kweaver curl ...)

  kweaver agent chat <agent_id> [-m "message"] [--version value] [--conversation-id id]
                [--stream] [--no-stream] [--verbose] [-bd value]
  kweaver agent list [--name X] [--limit N] [--offset N] [-bd value] [--pretty]
  kweaver agent get <agent_id> [-bd value] [--pretty]
  kweaver agent get-by-key <key> [-bd value] [--pretty]
  kweaver agent sessions <agent_id> [-bd value] [--limit N] [--pretty]
  kweaver agent history <conversation_id> [-bd value] [--limit N] [--pretty]
  kweaver agent create [options]
  kweaver agent update <agent_id> [options]
  kweaver agent delete <agent_id> [-bd value]
  kweaver agent publish <agent_id> [-bd value]
  kweaver agent unpublish <agent_id> [-bd value]

  kweaver ds list [--keyword X] [--type T] [-bd value] [--pretty]
  kweaver ds get <id>
  kweaver ds delete <id> [-y]
  kweaver ds tables <id> [--keyword X] [--pretty]
  kweaver ds connect <db_type> <host> <port> <database> --account X --password Y [--schema S] [--name N]

  kweaver dataview list [--datasource-id id] [--type atomic|custom] [--limit n] [-bd value] [--pretty]
  kweaver dataview find --name <name> [--exact] [--datasource-id id] [--wait] [--timeout ms] [-bd value] [--pretty]
  kweaver dataview get <id> [-bd value] [--pretty]
  kweaver dataview query <id> [--sql sql] [--limit n] [--offset n] [--need-total] [--raw-sql] [-bd value] [--pretty]
  kweaver dataview delete <id> [-y] [-bd value]

  kweaver bkn list [options]
  kweaver bkn get <kn-id> [options]
  kweaver bkn search <kn-id> <query> [--max-concepts N] [--mode M] [--pretty] [-bd value]
  kweaver bkn create [options]
  kweaver bkn create-from-ds [options]
  kweaver bkn update <kn-id> [options]
  kweaver bkn delete <kn-id> [-y]
  kweaver bkn build <kn-id> [--wait] [--no-wait] [--timeout N]
  kweaver bkn validate <directory> [--detect-encoding|--no-detect-encoding] [--source-encoding name]
  kweaver bkn export <kn-id>
  kweaver bkn stats <kn-id>
  kweaver bkn push <directory> [--branch main] [-bd value] [--detect-encoding|--no-detect-encoding] [--source-encoding name]
  kweaver bkn pull <kn-id> [directory] [--branch main] [-bd value]
  kweaver bkn object-type list|get|create|update|delete|query|properties <kn-id> ...
  kweaver bkn relation-type list|get|create|update|delete <kn-id> ...
  kweaver bkn subgraph <kn-id> <body-json>
  kweaver bkn action-type list|query|execute <kn-id> ... [--wait] [--no-wait] [--timeout N]
  kweaver bkn action-execution get <kn-id> <execution-id>
  kweaver bkn action-log list|get|cancel <kn-id> ...

  kweaver config set-bd <value>
  kweaver config list-bd
  kweaver config show

  kweaver skill list|get|register|status|delete [options]
  kweaver skill market [options]
  kweaver skill content <skill-id> [--raw] [--output file]
  kweaver skill read-file <skill-id> <rel-path> [--raw] [--output file]
  kweaver skill download|install <skill-id> [path] [options]

  kweaver vega health|stats|inspect
  kweaver vega catalog list|get|health|test-connection|discover|resources [options]
  kweaver vega resource list|get|query [options]
  kweaver vega connector-type list|get [options]

  kweaver context-loader config set|use|list|remove|show [options]
  kweaver context-loader tools|resources|templates|prompts [--cursor]
  kweaver context-loader resource <uri>
  kweaver context-loader prompt <name> [--args json]
  kweaver context-loader kn-search <query> [--only-schema]
  kweaver context-loader kn-schema-search <query> [--max N]
  kweaver context-loader query-object-instance|query-instance-subgraph|get-logic-properties|get-action-info ...
  (alias: kweaver context ...)

Commands:
  auth           Login, list, inspect, and switch saved platform auth profiles
  token          Print the current access token, refreshing it first if needed
  call (curl)    Call an API with curl-style flags and auto-injected token headers
  agent          Agent CRUD, chat, sessions, history, publish/unpublish
  ds             Manage datasources (list, get, delete, tables, connect)
  dataview|dv    List, find, get, query (SQL), delete data views (atomic / custom)
  bkn            Knowledge network (CRUD, build, validate, export, stats, push/pull,
                 object-type, relation-type, subgraph, action-type, action-execution, action-log)
  config         Per-platform configuration (business domain)
  skill          Skill registry and market (register, search, progressive read, download/install)
  vega           Vega observability (catalog, resource, connector-type, health/stats/inspect)
  context-loader Context-loader MCP (config, tools, resources, prompts, kn-search, query-*, etc.)
  help           Show this message`);
}

export async function run(argv: string[]): Promise<number> {
  applyTlsEnvFromSavedTokens();

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

  if (command === "dataview" || command === "dv") {
    return runDataviewCommand(rest);
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

  if (command === "skill") {
    return runSkillCommand(rest);
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

import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

if (fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
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
