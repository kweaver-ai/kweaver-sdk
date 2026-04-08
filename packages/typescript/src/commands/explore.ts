import { createInterface } from "node:readline";
import { ensureValidToken, formatHttpError, with401RefreshRetry } from "../auth/oauth.js";
import { listKnowledgeNetworks } from "../api/knowledge-networks.js";
import { resolveBusinessDomain } from "../config/store.js";

export interface ExploreOptions {
  knId: string;
  agentId: string;
  port: number;
  open: boolean;
  businessDomain: string;
}

export function parseExploreArgs(args: string[]): ExploreOptions {
  const opts: ExploreOptions = {
    knId: "",
    agentId: "",
    port: 3721,
    open: true,
    businessDomain: "",
  };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--help" || a === "-h") throw new Error("help");
    if (a === "--port" && args[i + 1]) { opts.port = Number(args[++i]); continue; }
    if (a === "--no-open") { opts.open = false; continue; }
    if (a === "--kn" && args[i + 1]) { opts.knId = args[++i]; continue; }
    if (a === "--agent" && args[i + 1]) { opts.agentId = args[++i]; continue; }
    if ((a === "-bd" || a === "--biz-domain") && args[i + 1]) { opts.businessDomain = args[++i]; continue; }
  }
  return opts;
}

function printExploreHelp(): void {
  console.log(`kweaver explore

Launch an interactive web UI for exploring KWeaver resources.

Usage:
  kweaver explore [options]

Options:
  --kn <id>          Open directly to BKN tab with specified KN
  --agent <id>       Open directly to Chat tab with specified Agent
  --port <n>         HTTP server port (default: 3721)
  --no-open          Don't auto-open browser
  -bd <value>        Business domain override
  -h, --help         Show this help
`);
}

export async function runExploreCommand(args: string[]): Promise<number> {
  let opts: ExploreOptions;
  try {
    opts = parseExploreArgs(args);
  } catch (err: any) {
    if (err?.message === "help") { printExploreHelp(); return 0; }
    throw err;
  }

  // TODO: will be implemented in subsequent tasks
  console.log("explore command not yet fully implemented");
  return 0;
}
