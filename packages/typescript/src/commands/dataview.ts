import { createInterface } from "node:readline";
import { ensureValidToken, formatHttpError, with401RefreshRetry } from "../auth/oauth.js";
import {
  deleteDataView,
  findDataView,
  getDataView,
  listDataViews,
} from "../api/dataviews.js";
import { formatCallOutput } from "./call.js";
import { resolveBusinessDomain } from "../config/store.js";

function confirmYes(prompt: string): Promise<boolean> {
  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    rl.question(`${prompt} [y/N] `, (answer) => {
      rl.close();
      const trimmed = answer.trim().toLowerCase();
      resolve(trimmed === "y" || trimmed === "yes");
    });
  });
}

export async function runDataviewCommand(args: string[]): Promise<number> {
  const [subcommand, ...rest] = args;

  if (!subcommand || subcommand === "--help" || subcommand === "-h") {
    console.log(`kweaver dataview

Subcommands:
  list   [--datasource-id <id>] [--type <atomic|custom>] [--limit <n>] [-bd value] [--pretty]
  find   --name <name> [--exact] [--datasource-id <id>] [--wait] [--no-wait] [--timeout <ms>] [-bd value] [--pretty]
  get    <id> [-bd value] [--pretty]
  delete <id> [-y] [-bd value]

  list  — list all data views (no keyword search)
  find  — search by name; default fuzzy, --exact for strict match, --wait to poll`);
    return 0;
  }

  const dispatch = (): Promise<number> => {
    if (subcommand === "list") return runDataviewListCommand(rest);
    if (subcommand === "find") return runDataviewFindCommand(rest);
    if (subcommand === "get") return runDataviewGetCommand(rest);
    if (subcommand === "delete") return runDataviewDeleteCommand(rest);
    return Promise.resolve(-1);
  };

  try {
    return await with401RefreshRetry(async () => {
      const code = await dispatch();
      if (code === -1) {
        console.error(`Unknown dataview subcommand: ${subcommand}`);
        return 1;
      }
      return code;
    });
  } catch (error) {
    console.error(formatHttpError(error));
    return 1;
  }
}

function parseDataviewCommonArgs(args: string[]): {
  businessDomain: string;
  pretty: boolean;
} {
  let businessDomain = "";
  let pretty = true;
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if ((arg === "-bd" || arg === "--biz-domain") && args[i + 1]) {
      businessDomain = args[++i];
      continue;
    }
    if (arg === "--pretty") {
      pretty = true;
      continue;
    }
  }
  if (!businessDomain) businessDomain = resolveBusinessDomain();
  return { businessDomain, pretty };
}

async function runDataviewListCommand(args: string[]): Promise<number> {
  let datasourceId: string | undefined;
  let type: string | undefined;
  let limit: number | undefined;
  const { businessDomain, pretty } = parseDataviewCommonArgs(args);

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === "-bd" || arg === "--biz-domain") { i += 1; continue; }
    if (arg === "--pretty") continue;
    if (arg === "--datasource-id" && args[i + 1]) { datasourceId = args[++i]; continue; }
    if (arg === "--type" && args[i + 1]) { type = args[++i]; continue; }
    if (arg === "--limit" && args[i + 1]) {
      const n = Number.parseInt(args[++i], 10);
      if (!Number.isNaN(n)) limit = n;
      continue;
    }
  }

  const token = await ensureValidToken();
  const views = await listDataViews({
    baseUrl: token.baseUrl,
    accessToken: token.accessToken,
    businessDomain,
    datasourceId,
    type,
    limit,
  });
  console.log(formatCallOutput(JSON.stringify(views), pretty));
  return 0;
}

async function runDataviewFindCommand(args: string[]): Promise<number> {
  let datasourceId: string | undefined;
  let name: string | undefined;
  let exact = false;
  let wait = false;
  let timeoutMs = 30_000;
  const { businessDomain, pretty } = parseDataviewCommonArgs(args);

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === "-bd" || arg === "--biz-domain") { i += 1; continue; }
    if (arg === "--pretty") continue;
    if (arg === "--datasource-id" && args[i + 1]) { datasourceId = args[++i]; continue; }
    if (arg === "--name" && args[i + 1]) { name = args[++i]; continue; }
    if (arg === "--exact") { exact = true; continue; }
    if (arg === "--wait") { wait = true; continue; }
    if (arg === "--no-wait") { wait = false; continue; }
    if (arg === "--timeout" && args[i + 1]) {
      timeoutMs = Number(args[++i]);
      if (Number.isNaN(timeoutMs) || timeoutMs < 0) {
        console.error("Invalid --timeout value");
        return 1;
      }
      continue;
    }
  }

  if (!name) {
    console.error("Usage: kweaver dataview find --name <name> [--exact] [--datasource-id <id>] [--wait] [--timeout <ms>] [-bd value] [--pretty]");
    return 1;
  }

  const token = await ensureValidToken();
  const views = await findDataView({
    baseUrl: token.baseUrl,
    accessToken: token.accessToken,
    businessDomain,
    name,
    datasourceId,
    exact,
    wait,
    timeoutMs,
  });
  console.log(formatCallOutput(JSON.stringify(views), pretty));
  return 0;
}

async function runDataviewGetCommand(args: string[]): Promise<number> {
  const { businessDomain, pretty } = parseDataviewCommonArgs(args);
  let id = "";
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === "-bd" || arg === "--biz-domain") {
      i += 1;
      continue;
    }
    if (arg === "--pretty") continue;
    if (!arg.startsWith("-")) {
      id = arg;
      break;
    }
  }
  if (!id) {
    console.error("Usage: kweaver dataview get <id> [-bd value] [--pretty]");
    return 1;
  }

  const token = await ensureValidToken();
  const view = await getDataView({
    baseUrl: token.baseUrl,
    accessToken: token.accessToken,
    businessDomain,
    id,
  });
  console.log(formatCallOutput(JSON.stringify(view), pretty));
  return 0;
}

async function runDataviewDeleteCommand(args: string[]): Promise<number> {
  let id = "";
  let yes = false;
  let businessDomain = "";
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === "--yes" || arg === "-y") yes = true;
    else if ((arg === "-bd" || arg === "--biz-domain") && args[i + 1]) {
      businessDomain = args[++i];
      continue;
    } else if (!arg.startsWith("-")) id = arg;
  }
  if (!businessDomain) businessDomain = resolveBusinessDomain();
  if (!id) {
    console.error("Usage: kweaver dataview delete <id> [-y] [-bd value]");
    return 1;
  }

  if (!yes) {
    const confirmed = await confirmYes("Are you sure you want to delete this data view?");
    if (!confirmed) {
      console.error("Aborted.");
      return 1;
    }
  }

  const token = await ensureValidToken();
  await deleteDataView({
    baseUrl: token.baseUrl,
    accessToken: token.accessToken,
    businessDomain,
    id,
  });
  console.error(`Deleted ${id}`);
  return 0;
}
