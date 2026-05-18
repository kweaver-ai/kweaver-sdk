import { NO_AUTH_TOKEN } from "./config/no-auth.js";
import { applyTlsEnvFromSavedTokens } from "./config/tls-env.js";
import { runAgentCommand } from "./commands/agent.js";
import { runAuthCommand } from "./commands/auth.js";
import { runKnCommand } from "./commands/bkn.js";
import { runCallCommand } from "./commands/call.js";
import { runConfigCommand } from "./commands/config.js";
import { runContextLoaderCommand } from "./commands/context-loader.js";
import { runDataflowCommand } from "./commands/dataflow.js";
import { runDsCommand } from "./commands/ds.js";
import { runExploreCommand } from "./commands/explore.js";
import { runResourceCommand } from "./commands/resource.js";
import { runModelCommand } from "./commands/model.js";
import { runSkillCommand } from "./commands/skill.js";
import { runTokenCommand } from "./commands/token.js";
import { runToolboxCommand } from "./commands/toolbox.js";
import { runToolCommand } from "./commands/tool.js";
import { runVegaCommand } from "./commands/vega.js";
import { renderHelp } from "./help/format.js";

function printHelp(): void {
  console.log(
    renderHelp({
      tagline: "KWeaver SDK — operate KWeaver platform from CLI",
      usage: [
        "kweaver [global flags] <command> <subcommand> [flags]",
        "kweaver --version | -V",
        "kweaver --help | -h",
      ],
      sections: [
        {
          title: "AUTHENTICATION",
          items: [
            { name: "auth", desc: "Login / switch / list saved platform credentials" },
          ],
        },
        {
          title: "DECISION AGENT",
          items: [
            { name: "agent", desc: "Agent CRUD, chat, sessions, publish" },
            { name: "toolbox", desc: "Agent toolbox lifecycle" },
            { name: "tool", desc: "Tools inside toolbox" },
          ],
        },
        {
          title: "AI DATA PLATFORM",
          items: [
            { name: "bkn", desc: "Knowledge network — build, query, action, metric" },
            { name: "ds", desc: "Datasource (list, get, connect, tables)" },
            { name: "resource (res)", desc: "Resources — list, find, get, query, delete" },
            { name: "dataflow", desc: "Dataflow document workflows (run, runs, logs)" },
            { name: "vega", desc: "Vega observability — catalog, resource, query" },
            { name: "context-loader (context)", desc: "MCP/HTTP context loader (reads BKN schema/instances)" },
          ],
        },
        {
          title: "TRACE AI",
          items: [
            { name: "trace", desc: "Diagnose conversations / build eval-sets / schema validate" },
          ],
        },
        {
          title: "FOUNDATION",
          items: [
            { name: "token", desc: "Print current access token (auto-refresh)" },
            { name: "config", desc: "Per-platform business-domain config" },
            { name: "call (curl)", desc: "curl-style API call with auto-injected auth headers" },
            { name: "explore", desc: "Interactive web UI" },
            { name: "model", desc: "Model factory — LLM / small-model CRUD + chat" },
            { name: "skill", desc: "Skill registry / market" },
            { name: "help", desc: "Show help — use `help all` for full signatures" },
          ],
        },
      ],
      flags: [
        { name: "--base-url <url>", desc: "Override platform URL  (env: KWEAVER_BASE_URL)" },
        { name: "--token <value>", desc: "Override access token  (env: KWEAVER_TOKEN; disables write commands)" },
        { name: "--user <id|name>", desc: "Use specific user credentials (env: KWEAVER_USER)" },
        { name: "--pretty", desc: "Pretty-print JSON output (default)" },
        { name: "--compact", desc: "Compact JSON output (pipeline-friendly)" },
        { name: "--help, -h", desc: "Show help" },
        { name: "--version, -V", desc: "Show version" },
      ],
      environment: [
        { name: "KWEAVER_PROFILE", desc: "Isolate active-platform/user state per shell" },
        { name: "KWEAVERC_CONFIG_DIR", desc: "Override config root (~/.kweaver)" },
      ],
      examples: [
        "kweaver auth https://platform.example.com",
        "kweaver agent chat <agent_id> -m \"hello\"",
        "kweaver bkn build <kn-id> --wait",
      ],
      learnMore: [
        "Use `kweaver <command> --help` for command-specific help",
        "Use `kweaver help all` for full command signatures (migration fallback)",
        "For agents/multi-terminal: prefer `--user <id>` over `auth switch`",
      ],
    }),
  );
}

function printHelpFull(): void {
  console.log(`kweaver

Usage:
  kweaver [--base-url <url>] [--token <access-token>] [--user <userId|username>] <command> [options]
  kweaver --version | -V
  kweaver --help | -h

  kweaver auth <platform-url> [--alias name] [--no-auth] [--no-browser] [-u user] [-p pass] [--new-password <pwd>] [--http-signin] [--insecure|-k]
  kweaver auth login <platform-url>          (alias for auth <url>)
  kweaver auth login <url> --client-id ID --client-secret S --refresh-token T   (run on host without browser)
  kweaver auth change-password [<platform-url>] [-u <account>] [-o <old>] [-n <new>] [--insecure|-k]
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
             [--url URL] [--verbose] [-bd value]
  (alias: kweaver curl ...)

  kweaver agent chat <agent_id> [-m "message"] [--version value] [--conversation-id id]
                [--stream] [--no-stream] [--verbose] [-bd value]
  kweaver agent list [--name X] [--limit N] [--offset N] [-bd value]
  kweaver agent get <agent_id> [-bd value]
  kweaver agent get-by-key <key> [-bd value]
  kweaver agent sessions <agent_id> [-bd value] [--limit N]
  kweaver agent history <conversation_id> [-bd value] [--limit N]
  kweaver agent create [options]
  kweaver agent update <agent_id> [options]
  kweaver agent delete <agent_id> [-bd value]
  kweaver agent publish <agent_id> [-bd value]
  kweaver agent unpublish <agent_id> [-bd value]

  kweaver ds list [--keyword X] [--type T] [-bd value]
  kweaver ds get <id>
  kweaver ds delete <id> [-y]
  kweaver ds tables <id> [--keyword X]
  kweaver ds connect <db_type> <host> <port> <database> --account X --password Y [--schema S] [--name N]
                     [--reuse-existing|--force-new]

  kweaver dataflow templates [--json]
  kweaver dataflow create-dataset --template <name> --set "key=value" [--json] [-bd value]
  kweaver dataflow create-bkn --template <name> --set "key=value" [--json] [-bd value]
  kweaver dataflow create (--template <name> --set "key=value" | <json>) [-bd value]
  kweaver dataflow list [-bd value]
  kweaver dataflow run <dagId> (--file <path> | --url <remote-url> --name <filename>) [-bd value]
  kweaver dataflow runs <dagId> [--since <date-like>] [-bd value]
  kweaver dataflow logs <dagId> <instanceId> [--detail] [-bd value]

  kweaver model llm   list|get|add|edit|delete|test|chat|--template ...   (mf-model-manager + mf-model-api)
  kweaver model small list|get|add|edit|delete|test|embeddings|rerank|--template ...
  kweaver model --help

  kweaver resource list [--datasource-id id] [--type table|logicview] [--limit n] [-bd value]
  kweaver resource find --name <name> [--exact] [--datasource-id id] [--wait] [--timeout ms] [-bd value]
  kweaver resource get <id> [-bd value]
  kweaver resource query <id> [--limit n] [--offset n] [--need-total] [-bd value]
  kweaver resource delete <id> [-y] [-bd value]

  kweaver bkn list [options]
  kweaver bkn get <kn-id> [options]
  kweaver bkn search <kn-id> <query> [--max-concepts N] [--mode M] [-bd value]
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
  kweaver bkn metric list|get|create|search|validate|update|delete|query|dry-run <kn-id> ...
  kweaver bkn relation-type list|get|create|update|delete <kn-id> ...
  kweaver bkn subgraph <kn-id> <body-json>
  kweaver bkn action-type list|query|inputs|execute <kn-id> ... [--wait] [--no-wait] [--timeout N]
  kweaver bkn action-type execute <kn-id> <at-id> [<envelope-json>|--dynamic-params '<json>' --instance '<json>' --trigger-type <v>]
  kweaver bkn action-execution get <kn-id> <execution-id>
  kweaver bkn action-log list|get|cancel <kn-id> ...

  kweaver config set-bd <value>
  kweaver config list-bd
  kweaver config show

  kweaver skill list|get|market-get|register|status|delete [options]
  kweaver skill market [options]
  kweaver skill update-metadata|update-package|history|republish|publish-history [options]
  kweaver skill content <skill-id> [--raw] [--output file]
  kweaver skill read-file <skill-id> <rel-path> [--raw] [--output file]
  kweaver skill download|install <skill-id> [path] [options]

  kweaver toolbox create --name <n> --service-url <url> [--description <d>] [-bd value]
  kweaver toolbox list [--keyword X] [--limit N] [--offset N] [-bd value]
  kweaver toolbox publish|unpublish <box-id> [-bd value]
  kweaver toolbox delete <box-id> [-y] [-bd value]
  kweaver toolbox export <box-id> [-o <file>|-] [--type toolbox|mcp|operator]
  kweaver toolbox import <file> [--type toolbox|mcp|operator]

  kweaver tool upload --toolbox <box-id> <openapi-spec-path> [--metadata-type openapi]
  kweaver tool list --toolbox <box-id> [-bd value]
  kweaver tool enable|disable --toolbox <box-id> <tool-id>... [-bd value]
  kweaver tool execute|debug --toolbox <box-id> <tool-id>
                             [--body '<json>'|--body-file <path>]
                             [--header '<json>'] [--query '<json>'] [--path '<json>'] [--timeout <s>]

  kweaver vega health|stats|inspect
  kweaver vega catalog list|get|health|test-connection|discover|resources [options]
  kweaver vega resource list|get|query [options]
  kweaver vega query execute|sql [options]
  kweaver vega connector-type list|get [options]

  kweaver context-loader help <subcommand>
  kweaver context-loader config set|use|list|remove|show [options]                (deprecated; not supported with --token)
  kweaver context-loader tools|resources|templates|prompts <kn-id> [--cursor]
  kweaver context-loader resource <kn-id> <uri>
  kweaver context-loader prompt <kn-id> <name> [--args json]
  kweaver context-loader search-schema <kn-id> <query> [--scope object,relation,action,metric] [--concept-groups ids] [--max N]
  kweaver context-loader tool-call <kn-id> <name> --args '<json>'
  kweaver context-loader kn-search <kn-id> <query> [--only-schema]                 (deprecated; use search-schema)
  kweaver context-loader kn-schema-search <kn-id> <query> [--max N]                (deprecated; use search-schema)
  kweaver context-loader query-object-instance|query-instance-subgraph|get-logic-properties|get-action-info|find-skills <kn-id> ...
                                                          (omit <kn-id> to fall back to deprecated saved config)
  (alias: kweaver context ...)

Global options:
  --base-url <url>  Override platform base URL for this command (env: KWEAVER_BASE_URL)
  --token <value>   Override access token for this command (env: KWEAVER_TOKEN; disables write-to-disk commands)
  --user <id|name>  Use a specific user's credentials for this command, transient (env: KWEAVER_USER)

Multi-shell account isolation:
  KWEAVER_PROFILE=<name>     Scope state.json (active platform / active user) to a named
                             profile. Tokens under platforms/ are still shared, so each
                             profile reuses logins. Required for \`auth switch\` and
                             \`auth use\` (use --global to override). Name must match
                             [A-Za-z0-9_-]{1,64}.
  KWEAVERC_CONFIG_DIR=<dir>  Override the entire config root (~/.kweaver by default).
                             Use this for hard isolation (separate token store per shell).

For agents / multi-terminal scripts: prefer \`--user <id>\` (transient, no persistence)
over \`auth switch\` (persistent, requires KWEAVER_PROFILE).
  --pretty / --compact
                    Toggle pretty-printed JSON output. Supported by every
                    command that prints a JSON payload (default: pretty).

Commands:
  auth           Login, list, inspect, and switch saved platform auth profiles
  token          Print the current access token, refreshing it first if needed
  call (curl)    Call an API with curl-style flags and auto-injected token headers
  agent          Agent CRUD, chat, sessions, history, publish/unpublish
  ds             Manage datasources (list, get, delete, tables, connect)
  dataflow       Dataflow document workflows (list, run, runs, logs)
  model          Model factory: LLM/small-model CRUD (manager) and llm chat (OpenAI-compatible API)
  resource|res   List, find, get, query, delete vega-backend resources (table / logicview)
  bkn            Knowledge network (CRUD, build, validate, export, stats, push/pull,
                 object-type, relation-type, subgraph, action-type, action-execution, action-log)
  config         Per-platform configuration (business domain)
  skill          Skill registry and market (register, edit, history, progressive read, download/install)
  toolbox        Agent toolbox lifecycle (create, list, publish, delete, export, import)
  tool           Tools inside a toolbox (upload OpenAPI spec, list, enable/disable)
  vega           Vega observability (catalog, resource, query/sql, connector-type, health/stats/inspect)
  context-loader Context-loader MCP/HTTP (config, tools, resources, search-schema, tool-call, query-*, etc.)
  trace          Diagnose a single trace with rule-based analysis
  help           Show this message`);
}

export async function run(argv: string[]): Promise<number> {
  applyTlsEnvFromSavedTokens();

  const noAuthEnv = process.env.KWEAVER_NO_AUTH;
  if (
    (noAuthEnv === "1" || noAuthEnv === "true" || noAuthEnv === "yes") &&
    !process.env.KWEAVER_TOKEN
  ) {
    process.env.KWEAVER_TOKEN = NO_AUTH_TOKEN;
  }

  // Global flags consumed before subcommand dispatch.
  // Pattern follows --user (legacy): each flag, if present, is removed from argv
  // and projected into a process.env value that downstream resolvers already read.
  let filteredArgv = argv;

  function consumeFlag(flag: string): string | undefined {
    const idx = filteredArgv.indexOf(flag);
    if (idx === -1 || idx + 1 >= filteredArgv.length) return undefined;
    const value = filteredArgv[idx + 1];
    filteredArgv = [...filteredArgv.slice(0, idx), ...filteredArgv.slice(idx + 2)];
    return value;
  }

  const userVal = consumeFlag("--user");
  if (userVal) process.env.KWEAVER_USER = userVal;

  const tokenVal = consumeFlag("--token");
  const baseUrlVal = consumeFlag("--base-url");

  if (tokenVal) {
    process.env.KWEAVER_TOKEN = tokenVal;
    process.env.KWEAVER_TOKEN_SOURCE = "flag";
  }
  if (baseUrlVal) {
    process.env.KWEAVER_BASE_URL = baseUrlVal;
  }

  // --token requires a base URL from somewhere; fail fast with guidance.
  if (tokenVal && !process.env.KWEAVER_BASE_URL) {
    const { getCurrentPlatform } = await import("./config/store.js");
    if (!getCurrentPlatform()) {
      console.error(
        "--token requires a base URL. Provide one of:\n" +
          "  --base-url <url>\n" +
          "  export KWEAVER_BASE_URL=<url>\n" +
          "  kweaver auth login <url>   (save once, reuse later)",
      );
      return 1;
    }
  }

  const [command, ...rest] = filteredArgv;

  if (command === "--version" || command === "-V" || command === "version") {
    const { createRequire } = await import("node:module");
    const require = createRequire(import.meta.url);
    const pkg = require("../package.json") as { version: string };
    console.log(pkg.version);
    return 0;
  }

  if (argv.length === 0 || !command || command === "--help" || command === "-h") {
    printHelp();
    return 0;
  }

  if (command === "help") {
    const topic = rest[0];
    if (!topic) {
      printHelp();
      return 0;
    }
    if (topic === "all") {
      printHelpFull();
      return 0;
    }
    // `help <command>` → forward to `<command> --help`
    return run([...rest, "--help"]);
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

  if (command === "dataflow") {
    return runDataflowCommand(rest);
  }

  if (command === "model") {
    return runModelCommand(rest);
  }

  if (command === "resource" || command === "res") {
    return runResourceCommand(rest);
  }

  if (command === "token") {
    return runTokenCommand(rest);
  }

  if (command === "agent") {
    return runAgentCommand(rest);
  }

  if (command === "explore") {
    return runExploreCommand(rest);
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

  if (command === "toolbox") {
    return runToolboxCommand(rest);
  }

  if (command === "tool") {
    return runToolCommand(rest);
  }

  if (command === "context-loader" || command === "context") {
    return runContextLoaderCommand(rest);
  }

  if (command === "trace") {
    const { runTraceCommand } = await import("./commands/trace.js");
    return await runTraceCommand(rest);
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
